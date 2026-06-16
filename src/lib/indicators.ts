// Indicadores financeiros calculados a partir das demonstrações
// já montadas (FlatRow[] de DRE / BP_ATIVO / BP_PASSIVO), garantindo
// que usem exatamente os mesmos números da DRE e do Balanço.

export interface FlatRow {
  linha_ordem: number;
  descricao: string;
  codigo_conta: string | null;
  nivel: number;
  is_subtotal: boolean;
  periodo: string;
  valor: number;
}

export interface ContaOrigem {
  codigo: string;
  descricao: string;
  classificacao: string;
  valor: number;
}

export interface ValorComOrigem {
  valor: number;
  contas: ContaOrigem[];
}

export type Categoria = "Liquidez" | "Endividamento" | "Rentabilidade" | "Atividade";
export type Formato = "ratio" | "percent" | "days" | "money";
export type Faixa = "otimo" | "bom" | "atencao" | "critico";

export interface SeriePonto {
  periodo: string;
  valor: number | null;
}

export interface IndicadorCompleto {
  key: string;
  label: string;
  categoria: Categoria;
  formato: Formato;
  formulaTexto: string;
  numeradorLabel: string;
  denominadorLabel?: string;

  valor_atual: number | null;
  valor_anterior: number | null;
  variacao_pct: number | null;
  serie: SeriePonto[];

  faixa: Faixa;
  menorEMelhor: boolean;
  leitura_empresario: string;
  referencia: string;

  numerador: ValorComOrigem;
  denominador: ValorComOrigem;
}

// ---------- helpers de extração das demonstrações ----------

function rowsByPeriod(rows: FlatRow[]): Map<string, FlatRow[]> {
  const m = new Map<string, FlatRow[]>();
  for (const r of rows) {
    if (!m.has(r.periodo)) m.set(r.periodo, []);
    m.get(r.periodo)!.push(r);
  }
  for (const [, v] of m) v.sort((a, b) => a.linha_ordem - b.linha_ordem);
  return m;
}

function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Encontra um subtotal (nivel 0) pela descrição. Retorna o valor e
 * as contas analíticas (nivel > 0) que ficam logo abaixo dele até o
 * próximo nivel 0.
 */
function findSubtotal(rows: FlatRow[], keywords: string[]): ValorComOrigem {
  const kws = keywords.map(norm);
  const subtotals = rows
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) => r.is_subtotal);
  let pickIdx = -1;
  let pickValor = 0;
  for (const { r, idx } of subtotals) {
    const d = norm(r.descricao);
    if (kws.some((kw) => d.includes(kw))) {
      pickIdx = idx;
      pickValor = r.valor;
      break;
    }
  }
  if (pickIdx < 0) return { valor: 0, contas: [] };
  const contas: ContaOrigem[] = [];
  for (let i = pickIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.is_subtotal) break;
    if (!r.codigo_conta) continue;
    contas.push({
      codigo: r.codigo_conta,
      descricao: r.descricao,
      classificacao: r.codigo_conta,
      valor: r.valor,
    });
  }
  return { valor: pickValor, contas };
}

/**
 * Soma rows (analíticas) cuja descricao contém a keyword.
 * Útil para extrair Estoques, Disponível, Imobilizado, etc.
 */
function sumByKeyword(rows: FlatRow[], keywords: string[]): ValorComOrigem {
  const kws = keywords.map(norm);
  const contas: ContaOrigem[] = [];
  let valor = 0;
  for (const r of rows) {
    if (r.is_subtotal) continue;
    if (!r.codigo_conta) continue;
    const d = norm(r.descricao);
    if (kws.some((kw) => d.includes(kw))) {
      valor += r.valor;
      contas.push({
        codigo: r.codigo_conta,
        descricao: r.descricao,
        classificacao: r.codigo_conta,
        valor: r.valor,
      });
    }
  }
  return { valor, contas };
}

/** Soma de rows analíticas cujo codigo_conta começa com um dos prefixos. */
function sumByPrefix(rows: FlatRow[], prefixes: string[]): ValorComOrigem {
  const contas: ContaOrigem[] = [];
  let valor = 0;
  for (const r of rows) {
    if (r.is_subtotal) continue;
    if (!r.codigo_conta) continue;
    if (prefixes.some((p) => r.codigo_conta === p || r.codigo_conta!.startsWith(p + "."))) {
      valor += r.valor;
      contas.push({
        codigo: r.codigo_conta,
        descricao: r.descricao,
        classificacao: r.codigo_conta,
        valor: r.valor,
      });
    }
  }
  return { valor, contas };
}

// ---------- valores-base por período ----------

export interface BasePeriodo {
  // DRE
  receita_bruta: ValorComOrigem;
  receita_liquida: ValorComOrigem;
  lucro_bruto: ValorComOrigem;
  ebit: ValorComOrigem;
  lucro_liquido: ValorComOrigem;
  depreciacao: ValorComOrigem;
  ebitda: ValorComOrigem;
  custos: ValorComOrigem;
  // BP Ativo
  ativo_total: ValorComOrigem;
  ativo_circulante: ValorComOrigem;
  ativo_nao_circulante: ValorComOrigem;
  estoques: ValorComOrigem;
  disponivel: ValorComOrigem;
  contas_receber: ValorComOrigem;
  realizavel_lp: ValorComOrigem;
  imobilizado: ValorComOrigem;
  // BP Passivo
  passivo_total: ValorComOrigem;
  passivo_circulante: ValorComOrigem;
  passivo_nao_circulante: ValorComOrigem;
  patrimonio_liquido: ValorComOrigem;
  fornecedores: ValorComOrigem;
  emprestimos: ValorComOrigem;
}

const KW_DEP = ["deprec", "amortiz", "exaust"];
const KW_EST = ["estoque"];
const KW_CAIXA = ["caixa", "banco", "disponivel", "equivalente"];
const KW_RECEBER = ["clientes", "duplicatas a receber", "contas a receber"];
const KW_IMOB = ["imobilizado"];
const KW_FORN = ["fornecedor"];
const KW_EMP = ["emprestimo", "financiamento"];

function extrairBase(
  dre: FlatRow[],
  bpAtivo: FlatRow[],
  bpPassivo: FlatRow[],
): BasePeriodo {
  const receita_bruta = findSubtotal(dre, ["receita bruta"]);
  const receita_liquida = findSubtotal(dre, ["receita liquida"]);
  const lucro_bruto = findSubtotal(dre, ["lucro bruto"]);
  const ebit = findSubtotal(dre, ["resultado operacional", "ebit"]);
  const lucro_liquido = findSubtotal(dre, ["lucro liquido", "prejuizo"]);
  const custos = sumByKeyword(dre, ["custo"]);
  const depreciacao = sumByKeyword(dre, KW_DEP);
  // Recalcula valor de depreciação como soma absoluta (já em FlatRow é negativo)
  depreciacao.valor = depreciacao.contas.reduce(
    (a, c) => a + Math.abs(c.valor),
    0,
  );
  const ebitda: ValorComOrigem = {
    valor: ebit.valor + depreciacao.valor,
    contas: [...ebit.contas, ...depreciacao.contas],
  };

  const ativo_total = findSubtotal(bpAtivo, ["total do ativo"]);
  const ativo_circulante = findSubtotal(bpAtivo, ["ativo circulante"]);
  const ativo_nao_circulante = findSubtotal(bpAtivo, ["ativo nao circulante"]);
  const realizavel_lp = findSubtotal(bpAtivo, ["realizavel a longo"]);
  const estoques = sumByKeyword(bpAtivo, KW_EST);
  const disponivel = sumByKeyword(bpAtivo, KW_CAIXA);
  const contas_receber = sumByKeyword(bpAtivo, KW_RECEBER);
  const imobilizado = sumByKeyword(bpAtivo, KW_IMOB);

  const passivo_total = findSubtotal(bpPassivo, [
    "total do passivo",
    "passivo + pl",
  ]);
  const passivo_circulante = findSubtotal(bpPassivo, ["passivo circulante"]);
  const passivo_nao_circulante = findSubtotal(bpPassivo, [
    "passivo nao circulante",
    "exigivel a longo",
  ]);
  const patrimonio_liquido = findSubtotal(bpPassivo, [
    "patrimonio liquido",
  ]);
  const fornecedores = sumByKeyword(bpPassivo, KW_FORN);
  const emprestimos = sumByKeyword(bpPassivo, KW_EMP);

  return {
    receita_bruta, receita_liquida, lucro_bruto, ebit, lucro_liquido,
    depreciacao, ebitda, custos,
    ativo_total, ativo_circulante, ativo_nao_circulante,
    estoques, disponivel, contas_receber, realizavel_lp, imobilizado,
    passivo_total, passivo_circulante, passivo_nao_circulante,
    patrimonio_liquido, fornecedores, emprestimos,
  };
}

function basePorPeriodo(
  dre: FlatRow[], bpA: FlatRow[], bpP: FlatRow[],
  periodos: string[],
): Map<string, BasePeriodo> {
  const dreM = rowsByPeriod(dre);
  const aM = rowsByPeriod(bpA);
  const pM = rowsByPeriod(bpP);
  const out = new Map<string, BasePeriodo>();
  for (const p of periodos) {
    out.set(p, extrairBase(dreM.get(p) ?? [], aM.get(p) ?? [], pM.get(p) ?? []));
  }
  return out;
}

// ---------- faixas e leituras ----------

const FAIXA_COR_TOKEN: Record<Faixa, string> = {
  otimo: "var(--success)",
  bom: "oklch(0.70 0.14 145)",
  atencao: "var(--warning)",
  critico: "var(--destructive)",
};

export function corFaixa(f: Faixa): string {
  return FAIXA_COR_TOKEN[f];
}

function faixaMaiorMelhor(v: number, t: [number, number, number]): Faixa {
  if (v >= t[0]) return "otimo";
  if (v >= t[1]) return "bom";
  if (v >= t[2]) return "atencao";
  return "critico";
}
function faixaMenorMelhor(v: number, t: [number, number, number]): Faixa {
  if (v <= t[0]) return "otimo";
  if (v <= t[1]) return "bom";
  if (v <= t[2]) return "atencao";
  return "critico";
}

function safeDiv(a: number, b: number): number | null {
  if (!b || !isFinite(b)) return null;
  const v = a / b;
  return isFinite(v) ? v : null;
}

function fmtN(v: number, casas = 2): string {
  return v.toFixed(casas).replace(".", ",");
}

interface CalcCtx {
  key: string;
  label: string;
  categoria: Categoria;
  formato: Formato;
  formulaTexto: string;
  numeradorLabel: string;
  denominadorLabel?: string;
  menorEMelhor?: boolean;
  // por período → numerador, denominador, valor
  numeradorOf: (b: BasePeriodo) => ValorComOrigem;
  denominadorOf?: (b: BasePeriodo) => ValorComOrigem;
  // permite cálculos especiais (override do simples num/den)
  computeOf?: (b: BasePeriodo) => number | null;
  faixaOf: (v: number) => Faixa;
  leituraOf: (v: number, b: BasePeriodo) => string;
  referencia: string;
}

const DEFS: CalcCtx[] = [
  // ------------------ LIQUIDEZ ------------------
  {
    key: "lc", label: "Liquidez Corrente",
    categoria: "Liquidez", formato: "ratio",
    formulaTexto: "Ativo Circulante / Passivo Circulante",
    numeradorLabel: "Ativo Circulante",
    denominadorLabel: "Passivo Circulante",
    numeradorOf: (b) => b.ativo_circulante,
    denominadorOf: (b) => b.passivo_circulante,
    faixaOf: (v) => faixaMaiorMelhor(v, [1.5, 1.0, 0.8]),
    leituraOf: (v) =>
      v >= 1
        ? `Para cada R$ 1,00 de dívida de curto prazo, a empresa tem R$ ${fmtN(v)} disponível — situação confortável.`
        : `Cada R$ 1,00 de dívida de curto prazo é coberto por apenas R$ ${fmtN(v)} — atenção ao caixa.`,
    referencia: "Ideal acima de 1,0 — acima de 1,5 é confortável",
  },
  {
    key: "ls", label: "Liquidez Seca",
    categoria: "Liquidez", formato: "ratio",
    formulaTexto: "(Ativo Circulante − Estoques) / Passivo Circulante",
    numeradorLabel: "Ativo Circulante − Estoques",
    denominadorLabel: "Passivo Circulante",
    numeradorOf: (b) => ({
      valor: b.ativo_circulante.valor - b.estoques.valor,
      contas: [...b.ativo_circulante.contas, ...b.estoques.contas.map((c) => ({ ...c, valor: -c.valor }))],
    }),
    denominadorOf: (b) => b.passivo_circulante,
    faixaOf: (v) => faixaMaiorMelhor(v, [1.0, 0.8, 0.5]),
    leituraOf: (v) =>
      `Sem contar com estoques, a empresa cobre ${fmtN(v * 100, 0)}% das dívidas de curto prazo.`,
    referencia: "Ideal acima de 0,8",
  },
  {
    key: "li", label: "Liquidez Imediata",
    categoria: "Liquidez", formato: "ratio",
    formulaTexto: "Disponível / Passivo Circulante",
    numeradorLabel: "Caixa e Equivalentes",
    denominadorLabel: "Passivo Circulante",
    numeradorOf: (b) => b.disponivel,
    denominadorOf: (b) => b.passivo_circulante,
    faixaOf: (v) => faixaMaiorMelhor(v, [0.4, 0.2, 0.1]),
    leituraOf: (v) =>
      `Apenas com caixa e bancos, ${fmtN(v * 100, 0)}% das dívidas de curto prazo já estão cobertas.`,
    referencia: "Acima de 0,2 indica boa folga imediata",
  },
  {
    key: "lg", label: "Liquidez Geral",
    categoria: "Liquidez", formato: "ratio",
    formulaTexto: "(AC + RLP) / (PC + Exigível LP)",
    numeradorLabel: "AC + Realizável LP",
    denominadorLabel: "PC + Exigível LP",
    numeradorOf: (b) => ({
      valor: b.ativo_circulante.valor + b.realizavel_lp.valor,
      contas: [...b.ativo_circulante.contas, ...b.realizavel_lp.contas],
    }),
    denominadorOf: (b) => ({
      valor: b.passivo_circulante.valor + b.passivo_nao_circulante.valor,
      contas: [...b.passivo_circulante.contas, ...b.passivo_nao_circulante.contas],
    }),
    faixaOf: (v) => faixaMaiorMelhor(v, [1.2, 1.0, 0.8]),
    leituraOf: (v) =>
      `Considerando todos os prazos, há R$ ${fmtN(v)} de ativos para cada R$ 1,00 de dívidas totais.`,
    referencia: "Ideal acima de 1,0",
  },

  // ------------------ ENDIVIDAMENTO ------------------
  {
    key: "endiv", label: "Endividamento Geral",
    categoria: "Endividamento", formato: "percent",
    formulaTexto: "(PC + Exigível LP) / Ativo Total × 100",
    numeradorLabel: "Passivo Total (PC + ELP)",
    denominadorLabel: "Ativo Total",
    menorEMelhor: true,
    numeradorOf: (b) => ({
      valor: b.passivo_circulante.valor + b.passivo_nao_circulante.valor,
      contas: [...b.passivo_circulante.contas, ...b.passivo_nao_circulante.contas],
    }),
    denominadorOf: (b) => b.ativo_total,
    computeOf: (b) => {
      const d = safeDiv(
        b.passivo_circulante.valor + b.passivo_nao_circulante.valor,
        b.ativo_total.valor,
      );
      return d == null ? null : d * 100;
    },
    faixaOf: (v) => faixaMenorMelhor(v, [40, 60, 75]),
    leituraOf: (v) =>
      `${fmtN(v, 0)}% dos ativos da empresa são financiados por dívidas. O restante é capital próprio.`,
    referencia: "Abaixo de 60% indica estrutura equilibrada",
  },
  {
    key: "compEnd", label: "Composição do Endividamento",
    categoria: "Endividamento", formato: "percent",
    formulaTexto: "Passivo Circulante / (PC + Exigível LP) × 100",
    numeradorLabel: "Passivo Circulante",
    denominadorLabel: "Passivo Total",
    menorEMelhor: true,
    numeradorOf: (b) => b.passivo_circulante,
    denominadorOf: (b) => ({
      valor: b.passivo_circulante.valor + b.passivo_nao_circulante.valor,
      contas: [...b.passivo_circulante.contas, ...b.passivo_nao_circulante.contas],
    }),
    computeOf: (b) => {
      const d = safeDiv(
        b.passivo_circulante.valor,
        b.passivo_circulante.valor + b.passivo_nao_circulante.valor,
      );
      return d == null ? null : d * 100;
    },
    faixaOf: (v) => faixaMenorMelhor(v, [40, 60, 75]),
    leituraOf: (v) =>
      `${fmtN(v, 0)}% das dívidas vencem no curto prazo (até 12 meses).`,
    referencia: "Menor concentração no curto prazo = menor pressão de caixa",
  },
  {
    key: "imobPL", label: "Imobilização do Patrimônio Líquido",
    categoria: "Endividamento", formato: "percent",
    formulaTexto: "Imobilizado / Patrimônio Líquido × 100",
    numeradorLabel: "Imobilizado",
    denominadorLabel: "Patrimônio Líquido",
    menorEMelhor: true,
    numeradorOf: (b) => b.imobilizado,
    denominadorOf: (b) => b.patrimonio_liquido,
    computeOf: (b) => {
      const d = safeDiv(b.imobilizado.valor, b.patrimonio_liquido.valor);
      return d == null ? null : d * 100;
    },
    faixaOf: (v) => faixaMenorMelhor(v, [50, 80, 100]),
    leituraOf: (v) =>
      `${fmtN(v, 0)}% do capital próprio está imobilizado em máquinas, imóveis e equipamentos.`,
    referencia: "Abaixo de 100% — o resto financia capital de giro",
  },
  {
    key: "divEbitda", label: "Dívida Líquida / EBITDA",
    categoria: "Endividamento", formato: "ratio",
    formulaTexto: "(Empréstimos − Caixa) / EBITDA",
    numeradorLabel: "Dívida Líquida",
    denominadorLabel: "EBITDA",
    menorEMelhor: true,
    numeradorOf: (b) => ({
      valor: b.emprestimos.valor - b.disponivel.valor,
      contas: [...b.emprestimos.contas, ...b.disponivel.contas.map((c) => ({ ...c, valor: -c.valor }))],
    }),
    denominadorOf: (b) => b.ebitda,
    computeOf: (b) =>
      safeDiv(b.emprestimos.valor - b.disponivel.valor, b.ebitda.valor),
    faixaOf: (v) => faixaMenorMelhor(v, [1.5, 3.0, 4.5]),
    leituraOf: (v) =>
      v >= 0
        ? `Levaria ${fmtN(v)} anos de geração de EBITDA para quitar a dívida líquida.`
        : `A empresa tem mais caixa do que dívida — posição confortável.`,
    referencia: "Abaixo de 3x é saudável",
  },

  // ------------------ RENTABILIDADE ------------------
  {
    key: "margBruta", label: "Margem Bruta",
    categoria: "Rentabilidade", formato: "percent",
    formulaTexto: "Lucro Bruto / Receita Líquida × 100",
    numeradorLabel: "Lucro Bruto",
    denominadorLabel: "Receita Líquida",
    numeradorOf: (b) => b.lucro_bruto,
    denominadorOf: (b) => b.receita_liquida,
    computeOf: (b) => {
      const d = safeDiv(b.lucro_bruto.valor, b.receita_liquida.valor);
      return d == null ? null : d * 100;
    },
    faixaOf: (v) => faixaMaiorMelhor(v, [30, 20, 10]),
    leituraOf: (v) =>
      `De cada R$ 100 vendidos, R$ ${fmtN(v)} sobram após os custos diretos.`,
    referencia: "Varia muito por setor — comércio: 20-30%, serviços: 40%+",
  },
  {
    key: "margLiq", label: "Margem Líquida",
    categoria: "Rentabilidade", formato: "percent",
    formulaTexto: "Lucro Líquido / Receita Líquida × 100",
    numeradorLabel: "Lucro Líquido",
    denominadorLabel: "Receita Líquida",
    numeradorOf: (b) => b.lucro_liquido,
    denominadorOf: (b) => b.receita_liquida,
    computeOf: (b) => {
      const d = safeDiv(b.lucro_liquido.valor, b.receita_liquida.valor);
      return d == null ? null : d * 100;
    },
    faixaOf: (v) => faixaMaiorMelhor(v, [15, 8, 3]),
    leituraOf: (v) =>
      v >= 0
        ? `De cada R$ 100 vendidos, R$ ${fmtN(v)} viraram lucro líquido.`
        : `Prejuízo: cada R$ 100 vendidos geraram R$ ${fmtN(Math.abs(v))} de perda.`,
    referencia: "Acima de 8% costuma ser saudável",
  },
  {
    key: "margEbitda", label: "Margem EBITDA",
    categoria: "Rentabilidade", formato: "percent",
    formulaTexto: "EBITDA / Receita Líquida × 100",
    numeradorLabel: "EBITDA",
    denominadorLabel: "Receita Líquida",
    numeradorOf: (b) => b.ebitda,
    denominadorOf: (b) => b.receita_liquida,
    computeOf: (b) => {
      const d = safeDiv(b.ebitda.valor, b.receita_liquida.valor);
      return d == null ? null : d * 100;
    },
    faixaOf: (v) => faixaMaiorMelhor(v, [20, 12, 5]),
    leituraOf: (v) =>
      `A operação gera ${fmtN(v)}% de caixa antes de juros, impostos e depreciação.`,
    referencia: "Indica eficiência operacional pura",
  },
  {
    key: "roa", label: "ROA — Retorno sobre Ativo",
    categoria: "Rentabilidade", formato: "percent",
    formulaTexto: "Lucro Líquido / Ativo Total × 100",
    numeradorLabel: "Lucro Líquido",
    denominadorLabel: "Ativo Total",
    numeradorOf: (b) => b.lucro_liquido,
    denominadorOf: (b) => b.ativo_total,
    computeOf: (b) => {
      const d = safeDiv(b.lucro_liquido.valor, b.ativo_total.valor);
      return d == null ? null : d * 100;
    },
    faixaOf: (v) => faixaMaiorMelhor(v, [10, 5, 2]),
    leituraOf: (v) =>
      `Cada R$ 100 investidos em ativos geraram R$ ${fmtN(v)} de lucro no período.`,
    referencia: "Acima de 5% é considerado bom",
  },
  {
    key: "roe", label: "ROE — Retorno sobre Patrimônio",
    categoria: "Rentabilidade", formato: "percent",
    formulaTexto: "Lucro Líquido / Patrimônio Líquido × 100",
    numeradorLabel: "Lucro Líquido",
    denominadorLabel: "Patrimônio Líquido",
    numeradorOf: (b) => b.lucro_liquido,
    denominadorOf: (b) => b.patrimonio_liquido,
    computeOf: (b) => {
      const d = safeDiv(b.lucro_liquido.valor, b.patrimonio_liquido.valor);
      return d == null ? null : d * 100;
    },
    faixaOf: (v) => faixaMaiorMelhor(v, [15, 10, 5]),
    leituraOf: (v) =>
      `O capital investido pelos sócios rendeu ${fmtN(v, 1)}% no período.`,
    referencia: "Comparar com a Selic — acima dela, supera a renda fixa",
  },

  // ------------------ ATIVIDADE ------------------
  {
    key: "giroAtivo", label: "Giro do Ativo",
    categoria: "Atividade", formato: "ratio",
    formulaTexto: "Receita Líquida / Ativo Total",
    numeradorLabel: "Receita Líquida",
    denominadorLabel: "Ativo Total",
    numeradorOf: (b) => b.receita_liquida,
    denominadorOf: (b) => b.ativo_total,
    computeOf: (b) => safeDiv(b.receita_liquida.valor, b.ativo_total.valor),
    faixaOf: (v) => faixaMaiorMelhor(v, [1.5, 1.0, 0.5]),
    leituraOf: (v) =>
      `Cada R$ 1,00 de ativos gerou R$ ${fmtN(v)} de receita no período.`,
    referencia: "Quanto maior, mais eficiente o uso dos ativos",
  },
  {
    key: "pmr", label: "Prazo Médio de Recebimento",
    categoria: "Atividade", formato: "days",
    formulaTexto: "(Contas a Receber / Receita Bruta) × 30",
    numeradorLabel: "Contas a Receber",
    denominadorLabel: "Receita Bruta",
    menorEMelhor: true,
    numeradorOf: (b) => b.contas_receber,
    denominadorOf: (b) => b.receita_bruta,
    computeOf: (b) => {
      const d = safeDiv(b.contas_receber.valor, b.receita_bruta.valor);
      return d == null ? null : d * 30;
    },
    faixaOf: (v) => faixaMenorMelhor(v, [30, 45, 60]),
    leituraOf: (v) =>
      `A empresa demora em média ${fmtN(v, 0)} dias para receber dos clientes.`,
    referencia: "Quanto menor, melhor o ciclo de caixa",
  },
  {
    key: "pmp", label: "Prazo Médio de Pagamento",
    categoria: "Atividade", formato: "days",
    formulaTexto: "(Fornecedores / Custos) × 30",
    numeradorLabel: "Fornecedores",
    denominadorLabel: "Custos",
    numeradorOf: (b) => b.fornecedores,
    denominadorOf: (b) => b.custos,
    computeOf: (b) => {
      const d = safeDiv(b.fornecedores.valor, b.custos.valor);
      return d == null ? null : d * 30;
    },
    faixaOf: (v) => faixaMaiorMelhor(v, [45, 30, 15]),
    leituraOf: (v) =>
      `A empresa paga seus fornecedores em média a cada ${fmtN(v, 0)} dias.`,
    referencia: "Prazos maiores aliviam o caixa",
  },
  {
    key: "ciclo", label: "Ciclo Financeiro",
    categoria: "Atividade", formato: "days",
    formulaTexto: "PMR − PMP",
    numeradorLabel: "PMR",
    denominadorLabel: "PMP",
    menorEMelhor: true,
    numeradorOf: (b) => b.contas_receber,
    denominadorOf: (b) => b.fornecedores,
    computeOf: (b) => {
      const pmr = safeDiv(b.contas_receber.valor, b.receita_bruta.valor);
      const pmp = safeDiv(b.fornecedores.valor, b.custos.valor);
      if (pmr == null || pmp == null) return null;
      return (pmr - pmp) * 30;
    },
    faixaOf: (v) => faixaMenorMelhor(v, [0, 15, 30]),
    leituraOf: (v) =>
      v <= 0
        ? `Ciclo negativo: a empresa recebe antes de pagar — excelente para o caixa.`
        : `A empresa precisa financiar ${fmtN(v, 0)} dias entre pagar fornecedores e receber dos clientes.`,
    referencia: "Quanto menor (ou negativo), melhor",
  },
];

// ---------- formatadores ----------

export function formatIndicador(v: number | null, fmt: Formato): string {
  if (v == null || !isFinite(v)) return "—";
  if (fmt === "percent") return `${fmtN(v, 1)}%`;
  if (fmt === "days") return `${Math.round(v)} dias`;
  if (fmt === "ratio") return fmtN(v, 2);
  // money
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------- montagem final ----------

function baseVazia(): BasePeriodo {
  const z: ValorComOrigem = { valor: 0, contas: [] };
  return {
    receita_bruta: z, receita_liquida: z, lucro_bruto: z, ebit: z, lucro_liquido: z,
    depreciacao: z, ebitda: z, custos: z,
    ativo_total: z, ativo_circulante: z, ativo_nao_circulante: z,
    estoques: z, disponivel: z, contas_receber: z, realizavel_lp: z, imobilizado: z,
    passivo_total: z, passivo_circulante: z, passivo_nao_circulante: z,
    patrimonio_liquido: z, fornecedores: z, emprestimos: z,
  };
}

export function computeIndicadoresCompletos(
  dre: FlatRow[],
  bpAtivo: FlatRow[],
  bpPassivo: FlatRow[],
  periodos: string[],
): IndicadorCompleto[] {
  const periodosOrd = [...periodos].sort();
  if (periodosOrd.length === 0) return [];
  const baseMap = basePorPeriodo(dre, bpAtivo, bpPassivo, periodosOrd);

  const out: IndicadorCompleto[] = [];
  for (const def of DEFS) {
    const serie: SeriePonto[] = periodosOrd.map((p) => {
      const b = baseMap.get(p);
      if (!b) return { periodo: p, valor: null };
      const v = def.computeOf
        ? def.computeOf(b)
        : safeDiv(def.numeradorOf(b).valor, def.denominadorOf?.(b).valor ?? 0);
      return { periodo: p, valor: v };
    });

    const valor_atual = serie.length > 0 ? serie[serie.length - 1].valor : null;
    const valor_anterior = serie.length > 1 ? serie[serie.length - 2].valor : null;
    const variacao_pct =
      valor_atual != null && valor_anterior != null && valor_anterior !== 0
        ? ((valor_atual - valor_anterior) / Math.abs(valor_anterior)) * 100
        : null;

    const baseUlt = baseMap.get(periodosOrd[periodosOrd.length - 1]) ?? baseVazia();
    const numerador = def.numeradorOf(baseUlt);
    const denominador = def.denominadorOf?.(baseUlt) ?? { valor: 0, contas: [] };
    const faixa: Faixa =
      valor_atual == null ? "atencao" : def.faixaOf(valor_atual);
    const leitura =
      valor_atual == null
        ? "Sem dados suficientes para calcular este indicador no período."
        : def.leituraOf(valor_atual, baseUlt);

    out.push({
      key: def.key,
      label: def.label,
      categoria: def.categoria,
      formato: def.formato,
      formulaTexto: def.formulaTexto,
      numeradorLabel: def.numeradorLabel,
      denominadorLabel: def.denominadorLabel,
      valor_atual,
      valor_anterior,
      variacao_pct,
      serie,
      faixa,
      menorEMelhor: !!def.menorEMelhor,
      leitura_empresario: leitura,
      referencia: def.referencia,
      numerador,
      denominador,
    });
  }
  return out;
}


/** Score de saúde 0-100 a partir das faixas. */
export function calcularScore(ind: IndicadorCompleto[]): number {
  if (ind.length === 0) return 0;
  const valido = ind.filter((i) => i.valor_atual != null);
  if (valido.length === 0) return 0;
  const peso: Record<Faixa, number> = { otimo: 100, bom: 75, atencao: 45, critico: 15 };
  const soma = valido.reduce((a, i) => a + peso[i.faixa], 0);
  return Math.round(soma / valido.length);
}

export function gerarDestaques(
  ind: IndicadorCompleto[],
): { positivo: boolean; texto: string }[] {
  const out: { positivo: boolean; texto: string }[] = [];
  const comVariacao = ind.filter(
    (i) => i.variacao_pct != null && Math.abs(i.variacao_pct) >= 5,
  );
  // Maiores variações (boas e ruins)
  const ordenadas = [...comVariacao].sort(
    (a, b) => Math.abs(b.variacao_pct!) - Math.abs(a.variacao_pct!),
  );
  for (const i of ordenadas.slice(0, 3)) {
    const subiu = i.variacao_pct! > 0;
    const positivo = i.menorEMelhor ? !subiu : subiu;
    const dir = subiu ? "subiu" : "caiu";
    out.push({
      positivo,
      texto: `${i.label} ${dir} ${fmtN(Math.abs(i.variacao_pct!), 1)}% vs período anterior`,
    });
  }
  const criticos = ind.filter((i) => i.faixa === "critico");
  if (criticos.length > 0) {
    out.push({
      positivo: false,
      texto: `${criticos.length} indicador(es) em situação crítica — priorize ${criticos[0].label.toLowerCase()}`,
    });
  }
  return out.slice(0, 4);
}

// ============================================================
// LEGACY SHIM — mantém compatibilidade com callers antigos
// (alerts-card, dashboard.analise, dashboard.index) que usavam
// AccountRow[] vindo de financial_statements e a API
// computeIndicators / formatIndicator / IndicatorValue.
// ============================================================

export interface AccountRow {
  descricao: string;
  codigo_conta: string | null;
  periodo: string;
  valor: number;
  tipo_demonstracao: string;
  nivel?: number;
  is_subtotal?: boolean;
}

export interface IndicatorValue {
  key: string;
  label: string;
  category: Categoria;
  format: Formato;
  description: string;
  values: Record<string, number | null>;
}

function accountRowsToFlat(rows: AccountRow[], tipo: string): FlatRow[] {
  return rows
    .filter((r) => r.tipo_demonstracao === tipo)
    .map((r, i) => ({
      linha_ordem: i,
      descricao: r.descricao,
      codigo_conta: r.codigo_conta,
      nivel: r.nivel ?? 0,
      is_subtotal: r.is_subtotal ?? false,
      periodo: r.periodo,
      valor: Number(r.valor) || 0,
    }));
}

export function computeIndicators(
  rows: AccountRow[],
  periodos: string[],
): IndicatorValue[] {
  const dre = accountRowsToFlat(rows, "DRE");
  const bpA = accountRowsToFlat(rows, "BP_ATIVO").length
    ? accountRowsToFlat(rows, "BP_ATIVO")
    : accountRowsToFlat(rows, "BP");
  const bpP = accountRowsToFlat(rows, "BP_PASSIVO").length
    ? accountRowsToFlat(rows, "BP_PASSIVO")
    : accountRowsToFlat(rows, "BP");
  const completos = computeIndicadoresCompletos(dre, bpA, bpP, periodos);
  return completos.map((c) => ({
    key: c.key,
    label: c.label,
    category: c.categoria,
    format: c.formato,
    description: c.formulaTexto,
    values: Object.fromEntries(c.serie.map((s) => [s.periodo, s.valor])),
  }));
}

export function formatIndicator(v: number | null, fmt: Formato): string {
  return formatIndicador(v, fmt);
}
