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

const cache = new Map<string, FormulasEbitEbitda>();
const inflight = new Map<string, Promise<FormulasEbitEbitda>>();

export function limparCacheFormulasEbit(tenantId?: string) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

const VAZIO: FormulasEbitEbitda = { ebit: [], ebitda: [], ebitId: null, ebitdaId: null };

export async function getFormulasEbitEbitda(tenantId: string): Promise<FormulasEbitEbitda> {
  const hit = cache.get(tenantId);
  if (hit) return hit;
  const pending = inflight.get(tenantId);
  if (pending) return pending;

  const job = (async (): Promise<FormulasEbitEbitda> => {
    const { data, error } = await supabase
      .from("indicadores_empresa")
      .select("id, nome, formula")
      .eq("tenant_id", tenantId)
      .is("company_id", null);
    if (error) {
      console.warn("[ebit-fonte] indicadores:", error.message);
      return { ...VAZIO };
    }
    const out: FormulasEbitEbitda = { ...VAZIO };
    for (const r of data ?? []) {
      const toks = tokensDaFormula((r as any).formula);
      const id = String((r as any).id);
      if (nomeBateIndicadorEbit(String((r as any).nome), "ebitda")) {
        out.ebitda = toks;
        out.ebitdaId = id;
      } else if (nomeBateIndicadorEbit(String((r as any).nome), "ebit")) {
        out.ebit = toks;
        out.ebitId = id;
      }
    }
    cache.set(tenantId, out);
    return out;
  })();

  inflight.set(tenantId, job);
  try {
    return await job;
  } finally {
    inflight.delete(tenantId);
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
