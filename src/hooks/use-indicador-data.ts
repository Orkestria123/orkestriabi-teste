// Fetch consolidado (via RPC) para alimentar o engine de indicadores por empresa.
// A RPC devolve apenas o subconjunto útil do plano (estruturais + participantes
// com movimento), evitando baixar 100k+ contas de clientes/fornecedores.
//
// `useDemoValues` traz também a DRE já calculada pelo mesmo motor das
// demonstrações — usada para resolver termos de fórmula com origem
// "demonstracao" (Receita Líquida, EBIT, Lucro Líquido, …).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMascaraConfig } from "@/lib/mascara/interpretar";
import {
  buildContext,
  type EngineContext,
  type PlanoRowEng,
  type SaldoRow,
  type ResolverLinha,
} from "@/lib/indicadores/engine";
import { buildStatementFromDiario } from "@/lib/diario/build-statements";
import { resolverLinha as resolverLinhaCatalogo, keyDre, type DemoDre } from "@/lib/indicadores/linhas";

export function useIndicadorData(
  tenantId: string | undefined,
  companyId: string | undefined,
) {
  return useQuery({
    queryKey: ["indic-engine-data", tenantId, companyId],
    enabled: !!tenantId && !!companyId,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<EngineContext> => {
      const mascara = await getMascaraConfig({ tenantId: tenantId!, companyId: companyId! });

      const { data, error } = await supabase.rpc("indicador_snapshot" as any, {
        _company_id: companyId!,
      });
      if (error) throw new Error(error.message);

      const snap = (data ?? {}) as {
        plano?: any[];
        saldos?: any[];
        aberturas?: any[];
      };

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

      const saldos: SaldoRow[] = [];
      for (const s of snap.saldos ?? []) {
        const cls = codigoToClass.get(s.conta_codigo);
        if (!cls) continue;
        saldos.push({
          conta_codigo: cls,
          competencia: s.competencia,
          total_debitos: Number(s.total_debitos) || 0,
          total_creditos: Number(s.total_creditos) || 0,
        });
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

      return buildContext({ plano: planoEng, saldos, aberturas, mascara });
    },
  });
}

/**
 * Traz os valores da DRE (mesmo motor das demonstrações) para os períodos
 * pedidos + devolve um resolver pronto para o engine de indicadores.
 * Se `periodos` estiver vazio, retorna resolver que só funciona para BP.
 */
export function useDemoValues(
  tenantId: string | undefined,
  companyId: string | undefined,
  periodos: string[],
) {
  const key = periodos.slice().sort().join(",");
  return useQuery({
    queryKey: ["indic-demo-dre", tenantId, companyId, key],
    enabled: !!tenantId && !!companyId,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<DemoDre> => {
      if (!periodos || periodos.length === 0) return new Map();
      // Descobre o modoGlobal do tenant (plano_contas por empresa vs global)
      const { data: t } = await supabase
        .from("tenants")
        .select("plano_contas_modo")
        .eq("id", tenantId!)
        .maybeSingle();
      const modoGlobal = ((t as any)?.plano_contas_modo ?? "empresa") === "global";
      try {
        const rows = await buildStatementFromDiario(
          companyId!,
          tenantId!,
          modoGlobal,
          "DRE",
          periodos,
        );
        const map: DemoDre = new Map();
        for (const r of rows) {
          map.set(keyDre(r.descricao, r.periodo), Number(r.valor) || 0);
        }
        return map;
      } catch (e) {
        console.warn("[useDemoValues] falha ao montar DRE:", e);
        return new Map();
      }
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
