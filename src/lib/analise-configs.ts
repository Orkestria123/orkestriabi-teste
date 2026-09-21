// Análises configuráveis pelo escritório (Admin → Análises).
// Usa a MESMA lógica de fórmulas dos indicadores (engine), mas com
// destino próprio: aba "Análises" do dashboard, seção Capital de Giro etc.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  avaliarExpressao,
  tokensDaFormula,
  type EngineContext,
  type Formula,
  type ResolverLinha,
  type SeriePonto,
  type Token,
} from "@/lib/indicadores/engine";


export type SecaoAnalise = "capital_giro" | "ponto_equilibrio" | "geral";
export type FormatoAnalise = "reais" | "percentual" | "numero";
export type GraficoAnalise = "linha" | "barra" | "area" | "valor";

export interface AnaliseConfigRow {
  id: string;
  tenant_id: string;
  secao: SecaoAnalise;
  nome: string;
  descricao: string | null;
  formula: Formula;
  formato: FormatoAnalise;
  grafico: GraficoAnalise;
  visivel: boolean;
  ordem: number;
}

export const SECOES_ANALISE: { id: SecaoAnalise; label: string; descricao: string }[] = [
  {
    id: "capital_giro",
    label: "Capital de Giro",
    descricao: "Substitui o cálculo fixo da NCG na aba Capital de Giro da Análise.",
  },
  {
    id: "ponto_equilibrio",
    label: "Ponto de Equilíbrio",
    descricao: "Análises de margem de contribuição e ponto de equilíbrio.",
  },
  {
    id: "geral",
    label: "Geral",
    descricao: "Aparece na aba Análises do dashboard, na ordem definida.",
  },
];

export const secaoLabel = (s: string) =>
  SECOES_ANALISE.find((x) => x.id === s)?.label ?? s;

export const GRAFICOS_ANALISE: { id: GraficoAnalise; label: string }[] = [
  { id: "linha", label: "Linha" },
  { id: "barra", label: "Barra" },
  { id: "area", label: "Área" },
  { id: "valor", label: "Valor (KPI)" },
];

export const FORMATOS_ANALISE: { id: FormatoAnalise; label: string }[] = [
  { id: "reais", label: "Reais (R$)" },
  { id: "percentual", label: "Percentual (%)" },
  { id: "numero", label: "Número" },
];

export function useAnaliseConfigs(
  tenantId: string | null | undefined,
  soVisiveis = false,
) {
  return useQuery({
    queryKey: ["analise-configs", tenantId, soVisiveis],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = supabase
        .from("analise_configs")
        .select("*")
        .eq("tenant_id", tenantId!)
        .order("ordem")
        .order("nome");
      if (soVisiveis) q = q.eq("visivel", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...(r as unknown as Omit<AnaliseConfigRow, "formula">),
        formula: (r.formula ?? { expressao: [] }) as unknown as Formula,
      }));
    },
    staleTime: 5 * 60_000,
  });
}

/** Série (valor por período) de uma fórmula de análise. */
export function serieAnalise(
  formula: Formula | Token[] | null | undefined,
  periodos: string[],
  ctx: EngineContext,
  resolver?: ResolverLinha,
): SeriePonto[] {
  const tokens = tokensDaFormula(formula);
  return periodos.map((p) => ({
    periodo: p,
    valor: avaliarExpressao(tokens, p, ctx, resolver),
  }));
}
