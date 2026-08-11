// Cálculo da DFC pelo MÉTODO DIRETO (CPC 03) — Etapa 3.
//
// Só o BLOCO OPERACIONAL muda em relação ao indireto: Investimento,
// Financiamento e Fechamento são reaproveitados do motor da Etapa 2.
//
// OPÇÃO A — por contrapartida de caixa (usada aqui, pois o diário permite
// rastrear a partida dobrada através de (lote, grupo_lancamento, data)):
//   • para cada partida que envolve uma conta de Caixa/Disponível, o efeito no
//     caixa (débito − crédito da perna de caixa) é rateado entre as pernas de
//     contrapartida, proporcionalmente ao valor de cada uma;
//   • cada contrapartida é atribuída à linha do direto cujas contas a contêm
//     (Clientes → Recebimentos, Fornecedores → Pagamentos, etc.);
//   • contrapartidas que pertencem a Investimento/Financiamento são ignoradas
//     no bloco operacional (já aparecem nos blocos 2 e 3);
//   • transferências entre contas de caixa se anulam e são descartadas;
//   • o que sobra cai em "(-) Outros Pagamentos Operacionais".
//
// Sinal: o efeito no caixa já vem assinado (entrada positiva, saída negativa),
// então as linhas de pagamento aparecem naturalmente negativas.

import { supabase } from "@/integrations/supabase/client";
import {
  descendeDe,
  getMascaraConfig,
  MASCARA_DEFAULT,
  type MascaraConfig,
} from "@/lib/mascara/interpretar";
import { DFC_LINHAS, type DfcOperacao } from "@/lib/dfc/estrutura";
import {
  calcularDfcIndireto,
  buildColunasDfc,
  type Agrupador,
  type DfcLinhaCalc,
  type DfcResultado,
  type DfcValidacaoCol,
  type VisaoDfc,
} from "@/lib/dfc/calcular-indireto";

export interface DfcResultadoDireto extends DfcResultado {
  /** Caixa operacional pelo indireto, por coluna — para conferência cruzada */
  opIndireto: Record<string, number>;
  /** direto − indireto no caixa operacional, por coluna */
  diffOperacional: Record<string, number>;
  opIndiretoTotal: number;
  diffOperacionalTotal: number;
}

interface LancRow {
  conta_codigo: string;
  competencia: string;
  data: string;
  lote: string | null;
  grupo_lancamento: string | null;
  debito: number;
  credito: number;
}

async function paginate<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; from < 500_000; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchPlanoPorCodigos(companyId: string, codigos: string[]) {
  const uniq = Array.from(new Set(codigos.filter(Boolean)));
  const out: { codigo: string; classificacao: string }[] = [];
  const CHUNK = 400;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("plano_contas")
      .select("codigo, classificacao")
      .eq("company_id", companyId)
      .in("codigo", uniq.slice(i, i + CHUNK));
    if (error) throw error;
    out.push(...((data ?? []) as any[]));
  }
  return out;
}

export async function calcularDfcDireto(params: {
  companyId: string;
  periodos: string[];
  agrupador: Agrupador;
  visao: VisaoDfc;
}): Promise<DfcResultadoDireto> {
  const { companyId, periodos, agrupador } = params;
  const colunas = buildColunasDfc(periodos, agrupador);

  const ind = await calcularDfcIndireto(params);

  const vazio: DfcResultadoDireto = {
    ...ind,
    colunas: [],
    linhas: [],
    opIndireto: {},
    diffOperacional: {},
    opIndiretoTotal: 0,
    diffOperacionalTotal: 0,
  };
  if (colunas.length === 0) return vazio;

  // ---- máscara + configuração
  const { data: comp } = await supabase
    .from("companies")
    .select("id, tenant_id")
    .eq("id", companyId)
    .maybeSingle();
  if (!comp) return vazio;
  const tenantId = (comp as any).tenant_id as string;
  const mascara: MascaraConfig =
    (await getMascaraConfig({ tenantId, companyId })) ?? MASCARA_DEFAULT;

  const [cfgRes, linhasRes] = await Promise.all([
    supabase.from("dfc_config" as any).select("*").eq("company_id", companyId).maybeSingle(),
    supabase.from("dfc_linha_contas" as any).select("*").eq("company_id", companyId),
  ]);
  const contasCaixa = (((cfgRes.data as any)?.conta_caixa as string[]) ?? []).filter(Boolean);
  const cfgLinhas = new Map<string, { contas: string[]; operacao: DfcOperacao }>();
  for (const l of ((linhasRes.data as any[]) ?? [])) {
    cfgLinhas.set(`${l.metodo}::${l.linha}`, {
      contas: ((l.contas as string[]) ?? []).filter(Boolean),
      operacao: (l.operacao as DfcOperacao) ?? "soma",
    });
  }

  // ---- lançamentos do recorte
  const meses = Array.from(new Set(periodos)).sort();
  const mesesSet = new Set(meses);
  const lancs = await paginate<LancRow>((from, to) =>
    supabase
      .from("lancamentos_diario")
      .select("conta_codigo, competencia, data, lote, grupo_lancamento, debito, credito")
      .eq("company_id", companyId)
      .gte("competencia", meses[0])
      .lte("competencia", meses[meses.length - 1])
      .order("competencia")
      .order("id")
      .range(from, to),
  );

  const plano = await fetchPlanoPorCodigos(
    companyId,
    lancs.map((l) => l.conta_codigo),
  );
  const classPorCodigo = new Map<string, string>();
  for (const p of plano) classPorCodigo.set(p.codigo, p.classificacao);

  const codigosDe = (classificacoes: string[]): Set<string> => {
    const out = new Set<string>();
    if (classificacoes.length === 0) return out;
    for (const [codigo, classificacao] of classPorCodigo) {
      if (classificacoes.some((c) => descendeDe(classificacao, c, mascara))) out.add(codigo);
    }
    return out;
  };

  const caixaSet = codigosDe(contasCaixa);

  // linhas operacionais do método direto (configuráveis) + fallback "outros"
  const defsDiretas = DFC_LINHAS.filter(
    (d) => d.metodo === "direto" && d.bloco === "operacional",
  ).sort((a, b) => a.ordem - b.ordem);
  const FALLBACK = "op_dir_outros_pagamentos";

  const contasPorLinha = new Map<string, Set<string>>();
  for (const d of defsDiretas) {
    if (d.calculada) continue;
    contasPorLinha.set(d.key, codigosDe(cfgLinhas.get(`direto::${d.key}`)?.contas ?? []));
  }

  // contas de investimento/financiamento (vindas do indireto) — fora do operacional
  const contasInvFin = new Set<string>();
  for (const l of ind.linhas) {
    if (l.bloco !== "investimento" && l.bloco !== "financiamento") continue;
    for (const c of codigosDe(l.contas)) contasInvFin.add(c);
  }

  // ---- rateio por partida
  const acumulado = new Map<string, Map<string, number>>(); // linha -> competencia -> valor
  const add = (linha: string, comp: string, v: number) => {
    if (!v) return;
    const m = acumulado.get(linha) ?? new Map<string, number>();
    m.set(comp, (m.get(comp) ?? 0) + v);
    acumulado.set(linha, m);
  };

  const grupos = new Map<string, LancRow[]>();
  for (const r of lancs) {
    if (!mesesSet.has(r.competencia)) continue;
    const k = `${r.lote ?? ""}|${r.grupo_lancamento ?? ""}|${r.data}`;
    const arr = grupos.get(k);
    if (arr) arr.push(r);
    else grupos.set(k, [r]);
  }

  const linhaDaConta = (codigo: string): string | null => {
    for (const [key, set] of contasPorLinha) {
      if (key === FALLBACK) continue;
      if (set.has(codigo)) return key;
    }
    return null;
  };

  for (const rows of grupos.values()) {
    const caixaLegs = rows.filter((r) => caixaSet.has(r.conta_codigo));
    if (caixaLegs.length === 0) continue;
    const outros = rows.filter((r) => !caixaSet.has(r.conta_codigo));
    if (outros.length === 0) continue; // transferência entre caixas: se anula

    const efeitoCaixa = caixaLegs.reduce(
      (a, r) => a + (Number(r.debito) || 0) - (Number(r.credito) || 0),
      0,
    );
    if (Math.abs(efeitoCaixa) < 0.005) continue;

    // peso de cada contrapartida = valor da perna no mesmo sentido do caixa
    const pesos = outros.map((r) => -((Number(r.debito) || 0) - (Number(r.credito) || 0)));
    const somaPesos = pesos.reduce((a, p) => a + Math.abs(p), 0);
    if (somaPesos < 0.005) continue;

    outros.forEach((r, i) => {
      const share = efeitoCaixa * (Math.abs(pesos[i]) / somaPesos);
      if (contasInvFin.has(r.conta_codigo)) return; // vai nos blocos 2/3
      const key = linhaDaConta(r.conta_codigo) ?? FALLBACK;
      add(key, r.competencia, share);
    });
  }

  // ---- montagem das linhas
  const indPorKey = new Map(ind.linhas.map((l) => [l.key, l]));
  const linhas: DfcLinhaCalc[] = [];

  for (const d of defsDiretas) {
    const cfg = cfgLinhas.get(`direto::${d.key}`);
    linhas.push({
      key: d.key,
      label: d.label,
      bloco: "operacional",
      calculada: !!d.calculada,
      origemDRE: false,
      semContas: !d.calculada && (cfg?.contas.length ?? 0) === 0 && d.key !== FALLBACK,
      operacao: cfg?.operacao ?? d.operacaoPadrao,
      contas: cfg?.contas ?? [],
      valores: {},
    });
  }
  for (const l of ind.linhas) {
    if (l.bloco === "operacional") continue;
    linhas.push({ ...l, valores: {} });
  }

  const linhaPorKey = new Map(linhas.map((l) => [l.key, l]));
  const set = (key: string, col: string, v: number) => {
    const l = linhaPorKey.get(key);
    if (l) l.valores[col] = v;
  };

  const validacao: Record<string, DfcValidacaoCol> = {};
  const opIndireto: Record<string, number> = {};
  const diffOperacional: Record<string, number> = {};

  for (const col of colunas) {
    let operacional = 0;
    for (const d of defsDiretas) {
      if (d.calculada) continue;
      const m = acumulado.get(d.key);
      const v = m ? col.meses.reduce((a, mes) => a + (m.get(mes) ?? 0), 0) : 0;
      set(d.key, col.key, v);
      operacional += v;
    }
    set("op_dir_total", col.key, operacional);

    const investimento = indPorKey.get("inv_total")?.valores[col.key] ?? 0;
    const financiamento = indPorKey.get("fin_total")?.valores[col.key] ?? 0;
    for (const l of linhas) {
      if (l.bloco === "investimento" || l.bloco === "financiamento") {
        l.valores[col.key] = indPorKey.get(l.key)?.valores[col.key] ?? 0;
      }
    }

    const variacao = operacional + investimento + financiamento;
    const caixaInicial = ind.validacao[col.key]?.caixaInicial ?? 0;
    const caixaFinalCalculado = caixaInicial + variacao;
    const caixaFinalBP = ind.validacao[col.key]?.caixaFinalBP ?? 0;

    set("fech_variacao_caixa", col.key, variacao);
    set("fech_caixa_inicial", col.key, caixaInicial);
    set("fech_caixa_final", col.key, caixaFinalCalculado);

    validacao[col.key] = {
      caixaInicial,
      caixaFinalCalculado,
      caixaFinalBP,
      diferenca: caixaFinalBP - caixaFinalCalculado,
    };

    opIndireto[col.key] = indPorKey.get("op_ind_total")?.valores[col.key] ?? 0;
    diffOperacional[col.key] = operacional - opIndireto[col.key];
  }

  // ---- coluna TOTAL
  const totais: Record<string, number> = {};
  const primeira = colunas[0];
  const ultima = colunas[colunas.length - 1];
  for (const l of linhas) {
    if (l.key === "fech_caixa_inicial") totais[l.key] = validacao[primeira.key].caixaInicial;
    else totais[l.key] = colunas.reduce((a, c) => a + (l.valores[c.key] ?? 0), 0);
  }
  const varTotal = colunas.reduce(
    (a, c) => a + (linhaPorKey.get("fech_variacao_caixa")?.valores[c.key] ?? 0),
    0,
  );
  totais["fech_caixa_final"] = validacao[primeira.key].caixaInicial + varTotal;

  const validacaoTotal: DfcValidacaoCol = {
    caixaInicial: validacao[primeira.key].caixaInicial,
    caixaFinalCalculado: totais["fech_caixa_final"],
    caixaFinalBP: validacao[ultima.key].caixaFinalBP,
    diferenca: validacao[ultima.key].caixaFinalBP - totais["fech_caixa_final"],
  };

  const opIndiretoTotal = colunas.reduce((a, c) => a + (opIndireto[c.key] ?? 0), 0);
  const opDiretoTotal = totais["op_dir_total"] ?? 0;

  return {
    colunas,
    linhas,
    validacao,
    totais,
    validacaoTotal,
    temConfig: ind.temConfig,
    semContasCaixa: contasCaixa.length === 0,
    opIndireto,
    diffOperacional,
    opIndiretoTotal,
    diffOperacionalTotal: opDiretoTotal - opIndiretoTotal,
  };
}
