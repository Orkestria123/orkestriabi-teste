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
import { criarAcumulador } from "@/lib/diario/acumulador";
import {
  getAjustesGerenciais,
  contasGerenciaisToPlanoVirtual,
} from "@/lib/gerencial/ajustes";
import { resolverLinha as resolverLinhaCatalogo, indexarDemoDre, type DemoDre } from "@/lib/indicadores/linhas";
import { getEstruturaPadrao, type PapelEstrutura } from "@/lib/plano/estrutura";
import type { Visao } from "@/hooks/use-visao-gerencial";
import { getModoGlobal } from "@/lib/plano/escopo";

interface SnapshotRaw {
  plano: any[];
  saldos: any[];
  aberturas: any[];
}

export async function fetchSnapshot(companyId: string): Promise<SnapshotRaw> {
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
export async function buildCtxForVisao(
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
      codigo: p.codigo,
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

  // Abertura: DUAS deduplicações diferentes, que estavam confundidas.
  //
  //   por CONTA        a mesma conta pode ter abertura em várias datas
  //                    (reimportação) — vale a mais recente
  //   por CLASSIFICAÇÃO contas DIFERENTES dividem a mesma classificação —
  //                    aí é para SOMAR, não escolher uma
  //
  // O código antigo aplicava a regra da conta na chave da classificação:
  // ficava com a abertura de UMA conta e jogava fora a das outras. No
  // plano do escritório 113.097 clientes moram em 1.01.02.01.01.01 — o
  // Ativo saía com a abertura de um cliente só. É por isso que o total
  // do Ativo não batia.
  // É a mesma sequência do motor das demonstrações (getAberturas +
  // acumulador), de propósito: Balanço e indicador têm que partir do
  // mesmo saldo inicial. Era aqui que eles divergiam.
  //
  // 1) soma por (conta, data) — com de-para várias contas de origem caem
  //    na mesma conta do Padrão, e aí é soma, não substituição;
  const porContaData = new Map<string, number>();
  for (const r of snap.aberturas ?? []) {
    const k = `${r.conta_codigo}|${String(r.data_referencia ?? "")}`;
    porContaData.set(k, (porContaData.get(k) ?? 0) + (Number(r.saldo) || 0));
  }
  // 2) por conta, vale a data mais recente (reimportação da abertura);
  const ultimaPorConta = new Map<string, { data: string; saldo: number }>();
  for (const [k, saldo] of porContaData) {
    const i = k.lastIndexOf("|");
    const cod = k.slice(0, i);
    const data = k.slice(i + 1);
    const atual = ultimaPorConta.get(cod);
    if (!atual || data > atual.data) ultimaPorConta.set(cod, { data, saldo });
  }
  // 3) soma por CLASSIFICAÇÃO.
  const aberturas = new Map<string, number>();
  for (const [cod, { saldo }] of ultimaPorConta) {
    const cls = codigoToClass.get(cod);
    if (!cls) continue;
    aberturas.set(cls, (aberturas.get(cls) ?? 0) + saldo);
  }

  // Modo gerencial: injeta contas virtuais + saldos derivados dos ajustes.
  let movimentosGerenciais: { conta_codigo: string; competencia: string; movimento: number }[] = [];
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
        codigo: vp.codigo,
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
      const clsD = codigoToClass.get(a.conta_debito) ?? a.debito.classificacao;
      const clsC = codigoToClass.get(a.conta_credito) ?? a.credito.classificacao;
      push(clsD, a.competencia, a.valor, 0);
      push(clsC, a.competencia, 0, a.valor);
      movimentosGerenciais.push(
        { conta_codigo: a.conta_debito, competencia: a.competencia, movimento: a.valor },
        { conta_codigo: a.conta_credito, competencia: a.competencia, movimento: -a.valor },
      );
    }
  }

  // ---- saldo patrimonial acumulado, PELO MESMO acumulador do Balanço ----
  //
  // Este é o ponto em que o indicador divergia do Balanço. O motor das
  // demonstrações passa por `criarAcumulador`, que soma só o movimento
  // POSTERIOR à data da abertura — porque a abertura já embute o
  // histórico até ela. O indicador somava a abertura mais TODO o
  // movimento até o período, contando o passado duas vezes.
  //
  // Numa base com abertura em 31/12 e movimento a partir de janeiro os
  // dois davam igual, e por isso passou despercebido. Numa base com
  // abertura no meio da série o Ativo quase dobra.
  //
  // O acúmulo é feito por CONTA (é assim que a abertura existe) e só
  // depois somado por classificação — mesma ordem do Balanço.
  const acumulador = criarAcumulador(
    [
      ...(snap.saldos ?? []).map((s: any) => ({
        conta_codigo: String(s.conta_codigo),
        competencia: String(s.competencia),
        movimento: (Number(s.total_debitos) || 0) - (Number(s.total_creditos) || 0),
      })),
      ...movimentosGerenciais,
    ],
    // Aberturas JÁ agregadas por (conta, data) — `porContaData` acima.
    // Sem isso, no de-para duas contas de origem que caem na mesma conta
    // do Padrão na mesma data viram uma só: o acumulador escolhe a
    // última em vez de somar, e some o saldo da outra. É a mesma
    // agregação que `getAberturas` faz antes de entregar ao motor.
    [...porContaData].map(([k, saldo]) => {
      const i = k.lastIndexOf("|");
      return {
        conta_codigo: k.slice(0, i),
        data_referencia: k.slice(i + 1),
        saldo,
      };
    }),
  );

  const periodos = Array.from(
    new Set((snap.saldos ?? []).map((s: any) => String(s.competencia))),
  ).sort() as string[];

  // Contas de cada classificação, para somar sob demanda.
  const contasPorClasse = new Map<string, string[]>();
  for (const conta of acumulador.contas()) {
    const cls = codigoToClass.get(conta);
    if (!cls) continue;
    const arr = contasPorClasse.get(cls);
    if (arr) arr.push(conta);
    else contasPorClasse.set(cls, [conta]);
  }

  // Classificações que só existem no gerencial (contas virtuais) não têm
  // abertura contábil: o saldo delas é a soma dos ajustes até o período.
  const virtualPorClasse = new Map<string, Map<string, number>>();
  if (visao === "gerencial") {
    for (const s of saldosAgg.values()) {
      const cls = s.conta_codigo; // no agregado a chave é a classificação
      if (contasPorClasse.has(cls)) continue;
      let m = virtualPorClasse.get(cls);
      if (!m) { m = new Map(); virtualPorClasse.set(cls, m); }
      m.set(s.competencia,
        (m.get(s.competencia) ?? 0) + (Number(s.total_debitos) || 0) - (Number(s.total_creditos) || 0));
    }
  }

  const memo = new Map<string, number>();
  const saldoAcumuladoDC = (cls: string, periodo: string): number | null => {
    const k = `${cls}|${periodo}`;
    const cache = memo.get(k);
    if (cache !== undefined) return cache;

    const contas = contasPorClasse.get(cls);
    if (contas) {
      const ate = fimDoMes(periodo);
      let t = 0;
      for (const c of contas) t += acumulador.saldoAte(c, ate);
      memo.set(k, t);
      return t;
    }
    const virt = virtualPorClasse.get(cls);
    if (virt) {
      let t = 0;
      for (const [comp, v] of virt) if (comp <= periodo) t += v;
      memo.set(k, t);
      return t;
    }
    return null;   // classificação desconhecida: o motor usa o caminho antigo
  };

  const saldosPorCodigo = new Map<string, Map<string, SaldoRow>>();
  for (const s of snap.saldos ?? []) {
    const cod = String(s.conta_codigo ?? "");
    if (!cod) continue;
    let m = saldosPorCodigo.get(cod);
    if (!m) {
      m = new Map();
      saldosPorCodigo.set(cod, m);
    }
    const comp = String(s.competencia);
    const cur = m.get(comp);
    if (cur) {
      cur.total_debitos += Number(s.total_debitos) || 0;
      cur.total_creditos += Number(s.total_creditos) || 0;
    } else {
      m.set(comp, {
        conta_codigo: cod,
        competencia: comp,
        total_debitos: Number(s.total_debitos) || 0,
        total_creditos: Number(s.total_creditos) || 0,
      });
    }
  }
  for (const g of movimentosGerenciais) {
    const d = g.movimento > 0 ? g.movimento : 0;
    const c = g.movimento < 0 ? -g.movimento : 0;
    const cod = g.conta_codigo;
    let m = saldosPorCodigo.get(cod);
    if (!m) {
      m = new Map();
      saldosPorCodigo.set(cod, m);
    }
    const cur = m.get(g.competencia);
    if (cur) {
      cur.total_debitos += d;
      cur.total_creditos += c;
    } else {
      m.set(g.competencia, {
        conta_codigo: cod,
        competencia: g.competencia,
        total_debitos: d,
        total_creditos: c,
      });
    }
  }

  return buildContext({
    plano: planoEng,
    saldos: Array.from(saldosAgg.values()),
    aberturas,
    mascara,
    saldoAcumuladoDC,
    saldosPorCodigo,
  });
}

/** Último dia do mês de uma competência YYYY-MM-01. */
function fimDoMes(competencia: string): string {
  const [a, m] = competencia.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${a}-${String(m).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`;
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
    enabled: !!tenantId && !!companyId && periodos.length > 0,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<DemoValues> => {
      if (!periodos || periodos.length === 0) {
        return visao === "comparativo"
          ? { contabil: new Map(), gerencial: new Map() }
          : (new Map() as DemoDre);
      }
      const { modoGlobal } = await getModoGlobal(companyId!);  // AJUSTE 02: escopo por empresa
      const estrutura = await getEstruturaPadrao();
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
          return indexarDemoDre(rows, estrutura);
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
/**
 * Carrega o `estrutura_padrao` como query, para o resolvedor NUNCA
 * depender de o cache já estar quente.
 *
 * O resolvedor é síncrono e a estrutura é assíncrona. Enquanto ela não
 * chegava, o cálculo caía num caminho alternativo que devolvia OUTRO
 * número (Ativo Total saía 1,9× maior). Agora só existe um caminho, e
 * este hook garante que a tela recalcule quando a estrutura chega.
 */
export function useEstruturaPadrao() {
  return useQuery({
    queryKey: ["estrutura-padrao"],
    queryFn: () => getEstruturaPadrao(),
    staleTime: 10 * 60_000,
  });
}

export function criarResolverLinha(
  ctx: EngineContext | undefined,
  demoDre: DemoDre | undefined,
  estrutura?: PapelEstrutura[],
): ResolverLinha {
  return (linha: string, periodo: string) => {
    if (!ctx) return null;
    return resolverLinhaCatalogo(linha, periodo, ctx, demoDre, estrutura);
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
