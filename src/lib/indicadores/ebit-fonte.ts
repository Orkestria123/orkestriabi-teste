// EBIT / EBITDA: a fórmula dos indicadores Ebit e Ebitda é a fonte.
// DRE, KPIs e o termo "EBIT (DRE)" / "EBITDA (DRE)" leem o mesmo valor.
import { supabase } from "@/integrations/supabase/client";
import { tokensDaFormula, type Token } from "@/lib/indicadores/engine";

export function nomeBateIndicadorEbit(nome: string, alvo: "ebit" | "ebitda"): boolean {
  const n = (nome ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (alvo === "ebitda") return n === "ebitda";
  return n === "ebit";
}

export interface FormulasEbitEbitda {
  ebit: Token[];
  ebitda: Token[];
  ebitId: string | null;
  ebitdaId: string | null;
}

const inflight = new Map<string, Promise<FormulasEbitEbitda>>();

export function limparCacheFormulasEbit(tenantId?: string) {
  if (tenantId) {
    for (const key of inflight.keys()) if (key.startsWith(`${tenantId}:`)) inflight.delete(key);
  }
  else inflight.clear();
}

const VAZIO: FormulasEbitEbitda = { ebit: [], ebitda: [], ebitId: null, ebitdaId: null };

export function indicadoresEbitEfetivos<T extends { nome: string; escopo: string }>(rows: T[]): T[] {
  return rows.filter(row => row.escopo === "empresa" || !(["ebit", "ebitda"] as const).some(alvo =>
    nomeBateIndicadorEbit(row.nome, alvo) && rows.some(local => local.escopo === "empresa" && nomeBateIndicadorEbit(local.nome, alvo)),
  ));
}

export function selecionarFormulasEbit(rows: { id: string; nome: string; company_id: string | null; formula: Parameters<typeof tokensDaFormula>[0] }[], companyId?: string): FormulasEbitEbitda {
  const out = { ...VAZIO };
  for (const alvo of ["ebit", "ebitda"] as const) {
    const candidatos = rows.filter(r => nomeBateIndicadorEbit(r.nome, alvo));
    const row = (companyId ? candidatos.find(r => r.company_id === companyId) : undefined)
      ?? candidatos.find(r => r.company_id === null);
    if (row) {
      out[alvo] = tokensDaFormula(row.formula);
      out[`${alvo}Id`] = row.id;
    }
  }
  return out;
}

export async function getFormulasEbitEbitda(tenantId: string, companyId?: string): Promise<FormulasEbitEbitda> {
  const key = `${tenantId}:${companyId ?? "global"}`;
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async (): Promise<FormulasEbitEbitda> => {
    let query = supabase
      .from("indicadores_empresa")
      .select("id, nome, formula, company_id")
      .eq("tenant_id", tenantId);
    query = companyId ? query.or(`company_id.is.null,company_id.eq.${companyId}`) : query.is("company_id", null);
    const { data, error } = await query;
    if (error) {
      console.warn("[ebit-fonte] indicadores:", error.message);
      return { ...VAZIO };
    }
    return selecionarFormulasEbit((data ?? []).map(r => ({ ...r, formula: r.formula as Parameters<typeof tokensDaFormula>[0] })), companyId);
  })();

  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

async function upsertIndicadorEbit(
  tenantId: string,
  alvo: "ebit" | "ebitda",
  id: string | null,
  tokens: Token[],
): Promise<void> {
  const formula = { expressao: tokens };
  if (id) {
    const { error } = await supabase
      .from("indicadores_empresa")
      .update({ formula })
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase.from("indicadores_empresa").insert({
    tenant_id: tenantId,
    company_id: null,
    nome: alvo === "ebitda" ? "Ebitda" : "Ebit",
    categoria: "Rentabilidade",
    modo_analise: "reais",
    formula,
    descricao:
      alvo === "ebitda"
        ? "EBIT + depreciação/amortização"
        : "Resultado operacional (EBIT)",
    visibilidade: "ambos",
    is_padrao: true,
    ordem: alvo === "ebitda" ? 150 : 140,
    revisar_contas: false,
    faixas: null,
  });
  if (error) throw new Error(error.message);
}

export async function salvarFormulasEbitEbitda(
  tenantId: string,
  ebit: Token[],
  ebitda: Token[],
): Promise<void> {
  const atual = await getFormulasEbitEbitda(tenantId);
  await upsertIndicadorEbit(tenantId, "ebit", atual.ebitId, ebit);
  limparCacheFormulasEbit(tenantId);
  const depoisEbit = await getFormulasEbitEbitda(tenantId);
  await upsertIndicadorEbit(tenantId, "ebitda", depoisEbit.ebitdaId, ebitda);
  limparCacheFormulasEbit(tenantId);
}
