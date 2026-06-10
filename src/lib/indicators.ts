export interface AccountRow {
  descricao: string;
  codigo_conta: string | null;
  periodo: string;
  valor: number;
  tipo_demonstracao: string;
  nivel?: number;
  is_subtotal?: boolean;
}

function find(rows: AccountRow[], periodo: string, tipo: string, keywords: string[]): number {
  const k = keywords.map((x) => x.toLowerCase());
  const row = rows.find(
    (r) =>
      r.periodo === periodo &&
      r.tipo_demonstracao === tipo &&
      k.some((kw) => r.descricao?.toLowerCase().includes(kw)),
  );
  return row?.valor ?? 0;
}

function safeDiv(a: number, b: number): number | null {
  if (!b || !isFinite(b)) return null;
  const v = a / b;
  return isFinite(v) ? v : null;
}

export interface IndicatorValue {
  key: string;
  label: string;
  category: "Liquidez" | "Endividamento" | "Rentabilidade" | "Atividade";
  format: "ratio" | "percent" | "days";
  description: string;
  values: Record<string, number | null>;
}

export function computeIndicators(rows: AccountRow[], periodos: string[]): IndicatorValue[] {
  const calc = (fn: (p: string) => number | null) =>
    Object.fromEntries(periodos.map((p) => [p, fn(p)]));

  const ativoCirc = (p: string) => find(rows, p, "BP", ["ativo circulante"]);
  const passivoCirc = (p: string) => find(rows, p, "BP", ["passivo circulante"]);
  const ativoTotal = (p: string) => find(rows, p, "BP", ["ativo total", "total do ativo"]);
  const passivoTotal = (p: string) => find(rows, p, "BP", ["passivo total", "total do passivo"]);
  const patrimonio = (p: string) => find(rows, p, "BP", ["patrimônio líquido", "patrimonio liquido"]);
  const estoques = (p: string) => find(rows, p, "BP", ["estoque"]);
  const disponivel = (p: string) => find(rows, p, "BP", ["caixa", "disponível", "disponivel"]);
  const realizavelLP = (p: string) => find(rows, p, "BP", ["realizável a longo prazo", "realizavel a longo prazo"]);
  const exigivelLP = (p: string) => find(rows, p, "BP", ["passivo não circulante", "exigível a longo prazo"]);

  const receitaLiq = (p: string) => find(rows, p, "DRE", ["receita líquida", "receita liquida"]);
  const receitaBruta = (p: string) => find(rows, p, "DRE", ["receita bruta"]);
  const lucroBruto = (p: string) => find(rows, p, "DRE", ["lucro bruto", "resultado bruto"]);
  const lucroLiq = (p: string) => find(rows, p, "DRE", ["lucro líquido", "lucro liquido", "resultado líquido"]);
  const ebitda = (p: string) => find(rows, p, "DRE", ["ebitda", "lajida"]);

  const list: IndicatorValue[] = [
    {
      key: "lc", label: "Liquidez Corrente", category: "Liquidez", format: "ratio",
      description: "Ativo Circulante / Passivo Circulante",
      values: calc((p) => safeDiv(ativoCirc(p), passivoCirc(p))),
    },
    {
      key: "ls", label: "Liquidez Seca", category: "Liquidez", format: "ratio",
      description: "(AC − Estoques) / PC",
      values: calc((p) => safeDiv(ativoCirc(p) - estoques(p), passivoCirc(p))),
    },
    {
      key: "li", label: "Liquidez Imediata", category: "Liquidez", format: "ratio",
      description: "Disponível / PC",
      values: calc((p) => safeDiv(disponivel(p), passivoCirc(p))),
    },
    {
      key: "lg", label: "Liquidez Geral", category: "Liquidez", format: "ratio",
      description: "(AC + RLP) / (PC + ELP)",
      values: calc((p) => safeDiv(ativoCirc(p) + realizavelLP(p), passivoCirc(p) + exigivelLP(p))),
    },
    {
      key: "endiv", label: "Endividamento Geral", category: "Endividamento", format: "percent",
      description: "(PC + ELP) / Ativo Total",
      values: calc((p) => {
        const v = safeDiv(passivoCirc(p) + exigivelLP(p), ativoTotal(p));
        return v == null ? null : v * 100;
      }),
    },
    {
      key: "compEnd", label: "Composição do Endividamento", category: "Endividamento", format: "percent",
      description: "PC / (PC + ELP)",
      values: calc((p) => {
        const v = safeDiv(passivoCirc(p), passivoCirc(p) + exigivelLP(p));
        return v == null ? null : v * 100;
      }),
    },
    {
      key: "margemBruta", label: "Margem Bruta", category: "Rentabilidade", format: "percent",
      description: "Lucro Bruto / Receita Líquida",
      values: calc((p) => { const v = safeDiv(lucroBruto(p), receitaLiq(p)); return v == null ? null : v * 100; }),
    },
    {
      key: "margemLiq", label: "Margem Líquida", category: "Rentabilidade", format: "percent",
      description: "Lucro Líquido / Receita Líquida",
      values: calc((p) => { const v = safeDiv(lucroLiq(p), receitaLiq(p)); return v == null ? null : v * 100; }),
    },
    {
      key: "margemEbitda", label: "Margem EBITDA", category: "Rentabilidade", format: "percent",
      description: "EBITDA / Receita Líquida",
      values: calc((p) => { const v = safeDiv(ebitda(p), receitaLiq(p)); return v == null ? null : v * 100; }),
    },
    {
      key: "roa", label: "ROA (Retorno sobre Ativo)", category: "Rentabilidade", format: "percent",
      description: "Lucro Líquido / Ativo Total",
      values: calc((p) => { const v = safeDiv(lucroLiq(p), ativoTotal(p)); return v == null ? null : v * 100; }),
    },
    {
      key: "roe", label: "ROE (Retorno sobre PL)", category: "Rentabilidade", format: "percent",
      description: "Lucro Líquido / Patrimônio Líquido",
      values: calc((p) => { const v = safeDiv(lucroLiq(p), patrimonio(p)); return v == null ? null : v * 100; }),
    },
    {
      key: "giroAtivo", label: "Giro do Ativo", category: "Atividade", format: "ratio",
      description: "Receita Líquida / Ativo Total",
      values: calc((p) => safeDiv(receitaLiq(p), ativoTotal(p))),
    },
  ];
  return list;
}

export function formatIndicator(v: number | null, fmt: IndicatorValue["format"]): string {
  if (v == null) return "—";
  if (fmt === "percent") return `${v.toFixed(2).replace(".", ",")}%`;
  if (fmt === "days") return `${v.toFixed(0)} d`;
  return v.toFixed(2).replace(".", ",");
}
