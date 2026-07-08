// Fetch consolidado (via RPC) para alimentar o engine de indicadores por empresa.
// A RPC devolve apenas o subconjunto útil do plano (estruturais + participantes
// com movimento), evitando baixar 100k+ contas de clientes/fornecedores.
//
// `useDemoValues` traz também a DRE já calculada pelo mesmo motor das
// demonstrações — usada para resolver termos de fórmula com origem
// "demonstracao" (Receita Líquida, EBIT, Lucro Líquido, …).
//
// Etapa 6 (Visão Gerencial): os hooks aceitam `visao`. Em "gerencial", o ctx
// recebe contas gerenciais virtuais + saldos virtuais derivados dos ajustes,
// para que todo o resolver (BP e DRE) reflita a ótica gerencial sem duplicar
// lógica. Em "comparativo", devolvemos os DOIS conjuntos (contábil e gerencial)
// para o card de indicador mostrar lado a lado.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMascaraConfig, grupoDe, type MascaraConfig } from "@/lib/mascara/interpretar";
import {
  buildContext,
  type EngineContext,
  type PlanoRowEng,
  type SaldoRow,
  type ResolverLinha,
} from "@/lib/indicadores/engine";
import { buildStatementFromDiario } from "@/lib/diario/build-statements";
import {
  getAjustesGerenciais,
  contasGerenciaisToPlanoVirtual,
} from "@/lib/gerencial/ajustes";
import { resolverLinha as resolverLinhaCatalogo, keyDre, type DemoDre } from "@/lib/indicadores/linhas";
import type { Visao } from "@/hooks/use-visao-gerencial";

interface SnapshotRaw {
  plano: any[];
  saldos: any[];
  aberturas: any[];
}

async function fetchSnapshot(companyId: string): Promise<SnapshotRaw> {
  const { data, error } = await supabase.rpc("indicador_snapshot" as any, {
    _company_id: companyId,
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as SnapshotRaw;
}

/**
 * Monta um EngineContext contábil OU gerencial a partir do snapshot bruto.
 * O modo gerencial injeta contas gerenciais virtuais (como folhas dentro
 * dos grupos pais) e saldos virtuais derivados dos ajustes (débito/crédito
 * na respectiva conta com competência = período do ajuste). O engine trata
 * automaticamente BP (acumulado) e DRE (movimento do período).
 */
async function buildCtxForVisao(
  companyId: string,
  tenantId: string,
  snap: SnapshotRaw,
  mascara: MascaraConfig,
  visao: "contabil" | "gerencial",
): Promise<EngineContext> {
  const codigoToClass = new Map<string, string>();
  const planoEng: PlanoRowEng[] = (snap.plano ?? []).map((p: any) => {
    codigoToClass.set(p.codigo, p.classificacao);
    return {
      classificacao: p.classificacao,
      descricao: p.descricao,
      natureza: p.natureza,
      is_sintetica: p.is_sintetica,
      is_participante: p.is_participante,
    };
  });

  // Chave (classificacao|competencia) → saldo agregado (permite somar
  // movimento contábil + ajustes gerenciais no mesmo período/conta).
  const saldosAgg = new Map<string, SaldoRow>();
  const push = (cls: string, competencia: string, d: number, c: number) => {
    const k = `${cls}|${competencia}`;
    const cur = saldosAgg.get(k);
    if (cur) {
      cur.total_debitos += d;
      cur.total_creditos += c;
    } else {
      saldosAgg.set(k, {
        conta_codigo: cls,
        competencia,
        total_debitos: d,
        total_creditos: c,
      });
    }
  };
  for (const s of snap.saldos ?? []) {
    const cls = codigoToClass.get(s.conta_codigo);
    if (!cls) continue;
    push(cls, s.competencia, Number(s.total_debitos) || 0, Number(s.total_creditos) || 0);
  }

  const aberturas = new Map<string, number>();
  const seen = new Set<string>();
  const abertOrdenado = [...(snap.aberturas ?? [])].sort((a: any, b: any) =>
    String(b.data_referencia).localeCompare(String(a.data_referencia)),
  );
  for (const r of abertOrdenado) {
    const cls = codigoToClass.get(r.conta_codigo);
    if (!cls || seen.has(cls)) continue;
    seen.add(cls);
    aberturas.set(cls, Number(r.saldo) || 0);
  }

  // Modo gerencial: injeta contas virtuais + saldos derivados dos ajustes.
  if (visao === "gerencial") {
    const ger = await getAjustesGerenciais(companyId, tenantId);
    const sep = mascara.separador || ".";
    const virtualPlano = contasGerenciaisToPlanoVirtual(ger.contasGerenciais, sep);
    for (const vp of virtualPlano) {
      const grupo = grupoDe(vp.classificacao, mascara);
      const natureza =
        grupo === "passivo" || grupo === "pl" || grupo === "receita" || grupo === "resultado"
          ? "C"
          : "D";
      planoEng.push({
        classificacao: vp.classificacao,
        descricao: vp.descricao,
        natureza,
        is_sintetica: false,
        is_participante: false,
      });
      codigoToClass.set(vp.codigo, vp.classificacao);
    }
    for (const a of ger.ajustes) {
      if (!a.debito || !a.credito) continue;
      push(a.debito.classificacao, a.competencia, a.valor, 0);
      push(a.credito.classificacao, a.competencia, 0, a.valor);
    }
  }

  return buildContext({
    plano: planoEng,
    saldos: Array.from(saldosAgg.values()),
    aberturas,
    mascara,
  });
}

/**
 * Ctx do engine. Em `comparativo`, retorna { contabil, gerencial } com os dois.
 * Em modo simples retorna diretamente o ctx (backward compatible com callers
 * antigos, como o painel de admin, que passam `visao` implícito = "contabil").
 */
export type IndicadorCtx =
  | EngineContext
  | { contabil: EngineContext; gerencial: EngineContext };

export function useIndicadorData(
  tenantId: string | undefined,
  companyId: string | undefined,
  visao: Visao = "contabil",
) {
  return useQuery({
    queryKey: ["indic-engine-data", tenantId, companyId, visao],
    enabled: !!tenantId && !!companyId,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<IndicadorCtx> => {
      const mascara = await getMascaraConfig({ tenantId: tenantId!, companyId: companyId! });
      const snap = await fetchSnapshot(companyId!);
      if (visao === "comparativo") {
        const [contabil, gerencial] = await Promise.all([
          buildCtxForVisao(companyId!, tenantId!, snap, mascara, "contabil"),
          buildCtxForVisao(companyId!, tenantId!, snap, mascara, "gerencial"),
        ]);
        return { contabil, gerencial };
      }
      return buildCtxForVisao(companyId!, tenantId!, snap, mascara, visao);
    },
  });
}

/**
 * DRE por período (para termos com origem "demonstracao"). Em comparativo,
 * devolve as duas DREs.
 */
export type DemoValues =
  | DemoDre
  | { contabil: DemoDre; gerencial: DemoDre };

export function useDemoValues(
  tenantId: string | undefined,
  companyId: string | undefined,
  periodos: string[],
  visao: Visao = "contabil",
) {
  const key = periodos.slice().sort().join(",");
  return useQuery({
    queryKey: ["indic-demo-dre", tenantId, companyId, key, visao],
    enabled: !!tenantId && !!companyId,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<DemoValues> => {
      if (!periodos || periodos.length === 0) {
        return visao === "comparativo"
          ? { contabil: new Map(), gerencial: new Map() }
          : (new Map() as DemoDre);
      }
      const { data: t } = await supabase
        .from("tenants")
        .select("plano_contas_modo")
        .eq("id", tenantId!)
        .maybeSingle();
      const modoGlobal = ((t as any)?.plano_contas_modo ?? "empresa") === "global";
      const build = async (modo: "contabil" | "gerencial"): Promise<DemoDre> => {
        try {
          const rows = await buildStatementFromDiario(
            companyId!,
            tenantId!,
            modoGlobal,
            "DRE",
            periodos,
            modo,
          );
          const map: DemoDre = new Map();
          for (const r of rows) {
            map.set(keyDre(r.descricao, r.periodo), Number(r.valor) || 0);
          }
          return map;
        } catch (e) {
          console.warn(`[useDemoValues:${modo}] falha ao montar DRE:`, e);
          return new Map();
        }
      };
      if (visao === "comparativo") {
        const [contabil, gerencial] = await Promise.all([build("contabil"), build("gerencial")]);
        return { contabil, gerencial };
      }
      return build(visao);
    },
  });
}

/** Cria um `ResolverLinha` para o motor de indicadores. */
export function criarResolverLinha(
  ctx: EngineContext | undefined,
  demoDre: DemoDre | undefined,
): ResolverLinha {
  return (linha: string, periodo: string) => {
    if (!ctx) return null;
    return resolverLinhaCatalogo(linha, periodo, ctx, demoDre);
  };
}

// Type guards úteis para os consumidores.
export function isCtxPair(
  c: IndicadorCtx | undefined,
): c is { contabil: EngineContext; gerencial: EngineContext } {
  return !!c && (c as any).contabil !== undefined && (c as any).gerencial !== undefined;
}
export function isDemoPair(
  d: DemoValues | undefined,
): d is { contabil: DemoDre; gerencial: DemoDre } {
  return !!d && (d as any).contabil !== undefined && (d as any).gerencial !== undefined;
}
