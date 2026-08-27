export type CategoriaBloco = "kpi" | "grafico";

export interface BlocoDef {
  key: string;
  label: string;
  descricao: string;
  categoria: CategoriaBloco;
  suportaBaseComparacao: boolean;
}

export const BLOCOS_CATALOGO: BlocoDef[] = [
  { key: "kpi_faturamento", label: "KPI — Faturamento", descricao: "Receita bruta do período, com comparação.", categoria: "kpi", suportaBaseComparacao: true },
  { key: "kpi_lucro_liquido", label: "KPI — Lucro Líquido", descricao: "Resultado do exercício. Cor indica superávit/déficit.", categoria: "kpi", suportaBaseComparacao: true },
  { key: "kpi_ebit", label: "KPI — EBIT", descricao: "Mesma fórmula do indicador Ebit.", categoria: "kpi", suportaBaseComparacao: true },
  { key: "kpi_ebitda", label: "KPI — EBITDA", descricao: "Mesma fórmula do indicador Ebitda.", categoria: "kpi", suportaBaseComparacao: true },
  { key: "kpi_receita_liquida", label: "KPI — Receita Líquida", descricao: "Receita líquida do período, com comparação.", categoria: "kpi", suportaBaseComparacao: true },
  { key: "grafico_receita_despesa", label: "Gráfico — Receita vs Custos", descricao: "Evolução da receita e dos custos (papéis dos indicadores).", categoria: "grafico", suportaBaseComparacao: false },
  { key: "grafico_tendencia", label: "Gráfico — Lucro Líquido", descricao: "Tendência do resultado (papel dos indicadores).", categoria: "grafico", suportaBaseComparacao: false },
];

export const KPI_DESTAQUE = [
  "kpi_faturamento",
  "kpi_lucro_liquido",
  "kpi_ebit",
  "kpi_ebitda",
] as const;

export const KPI_PAPEL: Record<string, string> = {
  kpi_faturamento: "RECEITA_BRUTA",
  kpi_receita_liquida: "RECEITA_LIQUIDA",
  kpi_ebit: "EBIT",
  kpi_ebitda: "EBITDA",
  kpi_lucro_liquido: "LUCRO_LIQUIDO",
};

export const KPI_LABEL: Record<string, string> = {
  kpi_faturamento: "Faturamento",
  kpi_receita_liquida: "Receita Líquida",
  kpi_ebit: "EBIT",
  kpi_ebitda: "EBITDA",
  kpi_lucro_liquido: "Lucro Líquido",
};

/** KPIs que leem a fórmula do indicador homônimo (Ebit / Ebitda), não o papel da DRE. */
export const KPI_VIA_INDICADOR: Record<string, "ebit" | "ebitda"> = {
  kpi_ebit: "ebit",
  kpi_ebitda: "ebitda",
};

export { nomeBateIndicadorEbit as nomeBateKpiIndicador } from "@/lib/indicadores/ebit-fonte";

export const BASE_COMPARACAO_OPCOES: { value: string; label: string }[] = [
  { value: "mes_anterior", label: "Mês anterior" },
  { value: "ano_anterior", label: "Mesmo mês do ano anterior" },
  { value: "orcado", label: "Orçado" },
];

export function configPadraoDoBloco(key: string, suportaBase: boolean): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  if (suportaBase) cfg.base_comparacao = "mes_anterior";
  if (KPI_PAPEL[key]) cfg.papel = KPI_PAPEL[key];
  if (key === "grafico_receita_despesa") {
    cfg.papel_receita = "RECEITA_LIQUIDA";
    cfg.papel_custos = "CUSTOS";
  }
  if (key === "grafico_tendencia") cfg.papel_lucro = "LUCRO_LIQUIDO";
  return cfg;
}
