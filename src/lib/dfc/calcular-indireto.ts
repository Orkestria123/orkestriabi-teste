// Cálculo da DFC pelo MÉTODO INDIRETO (CPC 03) — Etapa 2.
//
// Fonte: estrutura fixa (src/lib/dfc/estrutura.ts) + configuração do contador
// (dfc_config.conta_caixa e dfc_linha_contas.contas/operacao) + saldos
// (saldos_abertura + saldos_mensais) + Lucro Líquido vindo do motor da DRE.
//
// CONVENÇÃO DE SINAL
// ------------------
// Todos os saldos patrimoniais são mantidos em (débitos − créditos):
//   ativo com saldo devedor → positivo; passivo/PL com saldo credor → negativo.
// Com essa convenção, o efeito no caixa de QUALQUER conta patrimonial é
// sempre o INVERSO da sua variação:
//   efeito_caixa = −(saldo_final − saldo_inicial)
//   • ativo operacional aumenta (clientes/estoques)  → efeito negativo (consome caixa)
//   • passivo operacional aumenta (fornecedores)     → variação D−C negativa → efeito positivo
//   • imobilizado aumenta (compra)                   → efeito negativo
//   • empréstimo aumenta (captação)                  → efeito positivo
// que é exatamente a regra do enunciado do CPC 03 (ativo = inverso, passivo = igual).

import { supabase } from "@/integrations/supabase/client";
import {
  descendeDe,
  dividir,
  getMascaraConfig,
  MASCARA_DEFAULT,
  type MascaraConfig,
} from "@/lib/mascara/interpretar";
import { buildStatementFromDiario } from "@/lib/diario/build-statements";
import { DFC_LINHAS, type DfcLinhaDef, type DfcOperacao } from "@/lib/dfc/estrutura";

export type Agrupador = "mes" | "trimestre" | "semestre" | "ano";
export type VisaoDfc = "contabil" | "gerencial";

export interface DfcColuna {
  key: string;
  label: string;
  /** primeiro mês do bucket (YYYY-MM-DD) */
  inicio: string;
  /** último mês do bucket (YYYY-MM-DD) */
  fim: string;
  meses: string[];
}

export interface DfcLinhaCalc {
  key: string;
  label: string;
  bloco: DfcLinhaDef["bloco"];
  calculada: boolean;
  origemDRE: boolean;
  /** true quando a linha precisa de contas e o contador ainda não vinculou nenhuma */
  semContas: boolean;
  operacao: DfcOperacao;
  /** classificações vinculadas */
  contas: string[];
  valores: Record<string, number>;
}

export interface DfcValidacaoCol {
  caixaInicial: number;
  caixaFinalCalculado: number;
  caixaFinalBP: number;
  diferenca: number;
}

export interface DfcResultado {
  colunas: DfcColuna[];
  linhas: DfcLinhaCalc[];
  validacao: Record<string, DfcValidacaoCol>;
  /** total do recorte inteiro (todas as colunas) */
  totais: Record<string, number>;
  validacaoTotal: DfcValidacaoCol;
  temConfig: boolean;
  semContasCaixa: boolean;
}

// ---------------------------------------------------------------- helpers

interface PlanoRow {
  codigo: string;
  classificacao: string;
  descricao: string | null;
}
interface SaldoRow {
  conta_codigo: string;
  competencia: string;
  total_debitos: number;
  total_creditos: number;
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

async function fetchPlanoPorCodigos(companyId: string, codigos: string[]): Promise<PlanoRow[]> {
  const uniq = Array.from(new Set(codigos.filter(Boolean)));
  const out: PlanoRow[] = [];
  const CHUNK = 400;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("plano_contas")
      .select("codigo, classificacao, descricao")
      .eq("company_id", companyId)
      .in("codigo", uniq.slice(i, i + CHUNK));
    if (error) throw error;
    out.push(...((data ?? []) as PlanoRow[]));
  }
  return out;
}

function isApuracao(classificacao: string, mascara: MascaraConfig): boolean {
  return dividir(classificacao, mascara)
    .slice(1)
    .some((p) => p === "98" || p === "99");
}

/** Último dia do mês anterior a `p` (p = 'YYYY-MM-01'). */
function fimDoMesAnterior(p: string): string {
  const d = new Date(p + "T00:00:00Z");
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

const MES_ABBR = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function buildColunasDfc(periodos: string[], agrupador: Agrupador): DfcColuna[] {
  const ord = Array.from(new Set(periodos)).sort();
  const buckets = new Map<string, { label: string; meses: string[] }>();
  for (const p of ord) {
    const ano = p.slice(0, 4);
    const mes = Number(p.slice(5, 7));
    let key = p;
    let label = `${MES_ABBR[mes - 1]}/${ano.slice(2)}`;
    if (agrupador === "trimestre") {
      const t = Math.ceil(mes / 3);
      key = `${ano}-T${t}`;
      label = `${t}º Tri/${ano.slice(2)}`;
    } else if (agrupador === "semestre") {
      const s = mes <= 6 ? 1 : 2;
      key = `${ano}-S${s}`;
      label = `${s}º Sem/${ano.slice(2)}`;
    } else if (agrupador === "ano") {
      key = ano;
      label = ano;
    }
    const cur = buckets.get(key) ?? { label, meses: [] };
    cur.meses.push(p);
    buckets.set(key, cur);
  }
  return Array.from(buckets.entries()).map(([key, b]) => ({
    key,
    label: b.label,
    inicio: b.meses[0],
    fim: b.meses[b.meses.length - 1],
    meses: b.meses,
  }));
}

// ---------------------------------------------------------------- engine

export async function calcularDfcIndireto(params: {
  companyId: string;
  periodos: string[];
  agrupador: Agrupador;
  visao: VisaoDfc;
}): Promise<DfcResultado> {
  const { companyId, periodos, agrupador, visao } = params;
  const colunas = buildColunasDfc(periodos, agrupador);
  const vazio: DfcResultado = {
    colunas: [],
    linhas: [],
    validacao: {},
    totais: {},
    validacaoTotal: { caixaInicial: 0, caixaFinalCalculado: 0, caixaFinalBP: 0, diferenca: 0 },
    temConfig: false,
    semContasCaixa: true,
  };
  if (colunas.length === 0) return vazio;

  // ---- metadados da empresa
  const { data: comp } = await supabase
    .from("companies")
    .select("id, tenant_id")
    .eq("id", companyId)
    .maybeSingle();
  if (!comp) return vazio;
  const tenantId = (comp as any).tenant_id as string;
  const { data: tenant } = await supabase
    .from("tenants")
    .select("plano_contas_modo")
    .eq("id", tenantId)
    .maybeSingle();
  const modoGlobal = ((tenant as any)?.plano_contas_modo ?? "empresa") === "global";
  const mascara = (await getMascaraConfig({ tenantId, companyId })) ?? MASCARA_DEFAULT;

  // ---- configuração da DFC
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

  // ---- dados: saldos + plano
  const fimRecorte = colunas[colunas.length - 1].fim;
  const [saldos, aberturas] = await Promise.all([
    paginate<SaldoRow>((from, to) =>
      supabase
        .from("saldos_mensais")
        .select("conta_codigo, competencia, total_debitos, total_creditos")
        .eq("company_id", companyId)
        .lte("competencia", fimRecorte)
        .order("competencia")
        .order("conta_codigo")
        .range(from, to),
    ),
    paginate<any>((from, to) =>
      supabase
        .from("saldos_abertura")
        .select("conta_codigo, data_referencia, saldo")
        .eq("company_id", companyId)
        .order("data_referencia", { ascending: false })
        .range(from, to),
    ),
  ]);

  const codigos = new Set<string>();
  saldos.forEach((s) => codigos.add(s.conta_codigo));
  aberturas.forEach((a: any) => codigos.add(a.conta_codigo));
  const plano = await fetchPlanoPorCodigos(companyId, Array.from(codigos));
  const classPorCodigo = new Map<string, string>();
  for (const p of plano) classPorCodigo.set(p.codigo, p.classificacao);

  // abertura: mais recente por conta
  const aberturaPorCodigo = new Map<string, number>();
  for (const a of aberturas as any[]) {
    if (!aberturaPorCodigo.has(a.conta_codigo)) {
      aberturaPorCodigo.set(a.conta_codigo, Number(a.saldo) || 0);
    }
  }

  // movimento (D−C) por conta/competência
  const movPorConta = new Map<string, Map<string, number>>();
  for (const s of saldos) {
    const m = movPorConta.get(s.conta_codigo) ?? new Map<string, number>();
    m.set(
      s.competencia,
      (m.get(s.competencia) ?? 0) +
        (Number(s.total_debitos) || 0) -
        (Number(s.total_creditos) || 0),
    );
    movPorConta.set(s.conta_codigo, m);
  }

  /** contas (códigos) cuja classificação descende de alguma das classificações dadas */
  const resolverContas = (classificacoes: string[]): string[] => {
    if (classificacoes.length === 0) return [];
    const out: string[] = [];
    for (const [codigo, classificacao] of classPorCodigo) {
      if (isApuracao(classificacao, mascara)) continue;
      if (classificacoes.some((c) => descendeDe(classificacao, c, mascara))) out.push(codigo);
    }
    return out;
  };

  const contasCache = new Map<string, string[]>();
  const contasDe = (classificacoes: string[]): string[] => {
    const k = classificacoes.join("|");
    let v = contasCache.get(k);
    if (!v) {
      v = resolverContas(classificacoes);
      contasCache.set(k, v);
    }
    return v;
  };

  /** saldo acumulado (D−C) das contas até o fim do mês `ate` (inclusive) */
  const saldoAte = (codigosContas: string[], ate: string): number => {
    let total = 0;
    for (const cod of codigosContas) {
      total += aberturaPorCodigo.get(cod) ?? 0;
      const m = movPorConta.get(cod);
      if (!m) continue;
      for (const [comp, v] of m) if (comp <= ate) total += v;
    }
    return total;
  };

  /** movimento (D−C) das contas dentro do bucket de meses */
  const movimentoNoBucket = (codigosContas: string[], meses: string[]): number => {
    const set = new Set(meses);
    let total = 0;
    for (const cod of codigosContas) {
      const m = movPorConta.get(cod);
      if (!m) continue;
      for (const [comp, v] of m) if (set.has(comp)) total += v;
    }
    return total;
  };

  // ---- Lucro Líquido (DRE, na visão selecionada)
  const dre = await buildStatementFromDiario(
    companyId,
    tenantId,
    modoGlobal,
    "DRE",
    Array.from(new Set(periodos)).sort(),
    visao,
  );
  const lucroPorMes = new Map<string, number>();
  for (const r of dre) {
    if (r.descricao === "(=) Lucro Líquido do Exercício") {
      lucroPorMes.set(r.periodo, Number(r.valor) || 0);
    }
  }

  // ---- linhas do método indireto + blocos comuns
  const defs = DFC_LINHAS.filter(
    (d) =>
      (d.metodo === "indireto" || d.metodo === "ambos") &&
      (d.bloco !== "operacional" || d.metodo === "indireto"),
  ).sort((a, b) => {
    const ordBloco: Record<string, number> = {
      operacional: 1,
      investimento: 2,
      financiamento: 3,
      fechamento: 4,
    };
    return ordBloco[a.bloco] - ordBloco[b.bloco] || a.ordem - b.ordem;
  });

  const linhas: DfcLinhaCalc[] = defs.map((d) => {
    const cfg = cfgLinhas.get(`${d.metodo}::${d.key}`);
    return {
      key: d.key,
      label: d.label,
      bloco: d.bloco,
      calculada: !!d.calculada,
      origemDRE: !!d.origemDRE,
      semContas: !d.calculada && !d.origemDRE && (cfg?.contas.length ?? 0) === 0,
      operacao: cfg?.operacao ?? d.operacaoPadrao,
      contas: cfg?.contas ?? [],
      valores: {},
    };
  });
  const linhaPorKey = new Map(linhas.map((l) => [l.key, l]));
  const set = (key: string, col: string, v: number) => {
    const l = linhaPorKey.get(key);
    if (l) l.valores[col] = v;
  };

  const contasCaixaCodigos = contasDe(contasCaixa);
  const validacao: Record<string, DfcValidacaoCol> = {};

  for (const col of colunas) {
    const iniRef = fimDoMesAnterior(col.inicio);
    const fimRef = col.fim;

    // ---- Bloco 1 — operacional
    const lucro = col.meses.reduce((a, m) => a + (lucroPorMes.get(m) ?? 0), 0);
    set("op_ind_lucro_liquido", col.key, lucro);

    let operacional = lucro;
    for (const l of linhas) {
      if (l.calculada || l.origemDRE) continue;
      const codigosContas = contasDe(l.contas);
      let valor = 0;
      if (l.operacao === "variacao") {
        // efeito no caixa = −(saldo_final − saldo_inicial), na convenção D−C
        valor = -(saldoAte(codigosContas, fimRef) - saldoAte(codigosContas, iniRef));
      } else {
        const mov = movimentoNoBucket(codigosContas, col.meses);
        valor = l.operacao === "subtrai" ? -mov : mov;
      }
      l.valores[col.key] = valor;
      if (l.bloco === "operacional") operacional += valor;
    }

    const investimento = linhas
      .filter((l) => l.bloco === "investimento" && !l.calculada)
      .reduce((a, l) => a + (l.valores[col.key] ?? 0), 0);
    const financiamento = linhas
      .filter((l) => l.bloco === "financiamento" && !l.calculada)
      .reduce((a, l) => a + (l.valores[col.key] ?? 0), 0);

    set("op_ind_total", col.key, operacional);
    set("inv_total", col.key, investimento);
    set("fin_total", col.key, financiamento);

    const variacao = operacional + investimento + financiamento;
    const caixaInicial = saldoAte(contasCaixaCodigos, iniRef);
    const caixaFinalCalculado = caixaInicial + variacao;
    const caixaFinalBP = saldoAte(contasCaixaCodigos, fimRef);

    set("fech_variacao_caixa", col.key, variacao);
    set("fech_caixa_inicial", col.key, caixaInicial);
    set("fech_caixa_final", col.key, caixaFinalCalculado);

    validacao[col.key] = {
      caixaInicial,
      caixaFinalCalculado,
      caixaFinalBP,
      diferenca: caixaFinalBP - caixaFinalCalculado,
    };
  }

  // ---- coluna TOTAL do recorte
  const totais: Record<string, number> = {};
  const primeira = colunas[0];
  const ultima = colunas[colunas.length - 1];
  for (const l of linhas) {
    if (l.key === "fech_caixa_inicial") {
      totais[l.key] = validacao[primeira.key].caixaInicial;
    } else if (l.key === "fech_caixa_final") {
      totais[l.key] = validacao[ultima.key].caixaFinalCalculado;
    } else {
      totais[l.key] = colunas.reduce((a, c) => a + (l.valores[c.key] ?? 0), 0);
    }
  }
  // Caixa final do recorte = inicial do 1º + soma das variações
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

  return {
    colunas,
    linhas,
    validacao,
    totais,
    validacaoTotal,
    temConfig: cfgLinhas.size > 0 || contasCaixa.length > 0,
    semContasCaixa: contasCaixa.length === 0,
  };
}
