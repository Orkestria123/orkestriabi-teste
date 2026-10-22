import { supabase } from "@/integrations/supabase/client";
import { tokensDaFormula, type Token } from "./engine";

export const CATEGORIA_LINHAS = "Linhas calculadas";
export const LINHAS_CALCULADAS = [
  { key: "CUSTO_PRODUTOS", nome: "Custo de materiais dos produtos", contas: ["3.02.01.01", "3.02.01.02", "3.02.01.05", "3.02.01.06"] },
  { key: "CUSTO_MERCADORIA", nome: "Custo de aquisição das mercadorias", contas: ["3.03.01.01", "3.03.01.02", "3.03.01.04", "3.03.01.05"] },
] as const;
export type LinhaCalculadaKey = typeof LINHAS_CALCULADAS[number]["key"];
export interface DefinicaoLinha {
  id: string; company_id: string | null; linha_calculada_key: string | null;
  formula: unknown; exibir_demonstracao: boolean;
}
export interface FormulaLinha { tokens: Token[]; exibir: boolean }
export type FormulasLinhas = Partial<Record<LinhaCalculadaKey, FormulaLinha>>;

export function selecionarFormulasLinhas(rows: DefinicaoLinha[], companyId: string): FormulasLinhas {
  const out: FormulasLinhas = {};
  for (const linha of LINHAS_CALCULADAS) {
    const row = rows.find(r => r.linha_calculada_key === linha.key && r.company_id === companyId)
      ?? rows.find(r => r.linha_calculada_key === linha.key && r.company_id === null);
    if (row) out[linha.key] = { tokens: tokensDaFormula(row.formula as Parameters<typeof tokensDaFormula>[0]), exibir: row.exibir_demonstracao !== false };
  }
  return out;
}

export async function getFormulasLinhas(tenantId: string, companyId: string): Promise<FormulasLinhas> {
  const { data, error } = await supabase.from("indicadores_empresa")
    .select("id, company_id, linha_calculada_key, formula, exibir_demonstracao")
    .eq("tenant_id", tenantId).not("linha_calculada_key", "is", null)
    .or(`company_id.is.null,company_id.eq.${companyId}`);
  if (error) throw error;
  return selecionarFormulasLinhas(data ?? [], companyId);
}

// These lines are components, never additional costs in CPV/CMV totals.
// Restrict dependent line inputs to avoid cycles through EBIT and other cost-derived lines.
export const LINHAS_CUSTO_PROIBIDAS = ["CUSTO_PRODUTOS", "CUSTO_MERCADORIA", "EBIT", "EBITDA", "RESULTADO_OPERACIONAL", "PONTO_EQUILIBRIO"];