import { supabase } from "@/integrations/supabase/client";
import { tokensDaFormula, type Token } from "@/lib/indicadores/engine";

export interface DreLinhasConfig {
  ebit_expressao: Token[];
  ebitda_expressao: Token[];
  /** legado — preenchido a partir da fórmula para a DRE antiga */
  ebit_classificacoes: string[];
  ebitda_classificacoes: string[];
  ebitda_sobre_ebit: boolean;
  ebit_modo: "estrutura" | "soma";
  ebitda_modo: "estrutura" | "ebit_mais" | "soma";
}

export const DRE_LINHAS_VAZIA: DreLinhasConfig = {
  ebit_expressao: [],
  ebitda_expressao: [],
  ebit_classificacoes: [],
  ebitda_classificacoes: [],
  ebitda_sobre_ebit: true,
  ebit_modo: "estrutura",
  ebitda_modo: "estrutura",
};

function contasParaExpressao(contas: string[]): Token[] {
  if (contas.length === 0) return [];
  return [{
    tipo: "termo",
    origem: "conta",
    contas,
    sinais: contas.map(() => "+" as const),
  }];
}

function lerExpressao(raw: unknown, fallbackContas: string[]): Token[] {
  const toks = tokensDaFormula(raw as any);
  if (toks.length > 0) return toks;
  return contasParaExpressao(fallbackContas);
}

const cache = new Map<string, DreLinhasConfig>();
const inflight = new Map<string, Promise<DreLinhasConfig>>();

function normalizar(row: Partial<DreLinhasConfig> & Record<string, unknown> | null | undefined): DreLinhasConfig {
  const ebitCls = Array.isArray(row?.ebit_classificacoes)
    ? row!.ebit_classificacoes.filter((c) => typeof c === "string" && c.length > 0)
    : [];
  const ebitdaCls = Array.isArray(row?.ebitda_classificacoes)
    ? row!.ebitda_classificacoes.filter((c) => typeof c === "string" && c.length > 0)
    : [];
  const ebit_expressao = lerExpressao(row?.ebit_expressao, ebitCls);
  const ebitda_expressao = lerExpressao(row?.ebitda_expressao, ebitdaCls);
  const ebit_modo: DreLinhasConfig["ebit_modo"] =
    ebit_expressao.length > 0 ? "soma" : "estrutura";
  let ebitda_modo: DreLinhasConfig["ebitda_modo"] = "estrutura";
  if (ebitda_expressao.length > 0) ebitda_modo = "soma";
  return {
    ebit_expressao,
    ebitda_expressao,
    ebit_classificacoes: ebitCls,
    ebitda_classificacoes: ebitdaCls,
    ebitda_sobre_ebit: true,
    ebit_modo,
    ebitda_modo,
  };
}

export async function getDreLinhasConfig(tenantId: string): Promise<DreLinhasConfig> {
  const hit = cache.get(tenantId);
  if (hit) return hit;
  const pending = inflight.get(tenantId);
  if (pending) return pending;

  const job = (async () => {
    const { data, error } = await (supabase as any)
      .from("dre_linhas_config")
      .select("ebit_classificacoes, ebitda_classificacoes, ebitda_sobre_ebit, ebit_modo, ebitda_modo, ebit_expressao, ebitda_expressao")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      console.warn("[dre_linhas_config] indisponível:", error.message);
      return DRE_LINHAS_VAZIA;
    }
    const cfg = normalizar(data);
    cache.set(tenantId, cfg);
    return cfg;
  })();

  inflight.set(tenantId, job);
  try {
    return await job;
  } finally {
    inflight.delete(tenantId);
  }
}

export function limparCacheDreLinhas(tenantId?: string) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

export async function salvarDreLinhasConfig(
  tenantId: string,
  cfg: DreLinhasConfig,
): Promise<void> {
  const payload = {
    tenant_id: tenantId,
    ebit_expressao: cfg.ebit_expressao,
    ebitda_expressao: cfg.ebitda_expressao,
    ebit_classificacoes: cfg.ebit_classificacoes,
    ebitda_classificacoes: cfg.ebitda_classificacoes,
    ebitda_sobre_ebit: true,
    ebit_modo: cfg.ebit_expressao.length > 0 ? "soma" : "estrutura",
    ebitda_modo: cfg.ebitda_expressao.length > 0 ? "soma" : "estrutura",
    updated_at: new Date().toISOString(),
  };
  const { error } = await (supabase as any)
    .from("dre_linhas_config")
    .upsert(payload as unknown as Record<string, unknown>, { onConflict: "tenant_id" });
  if (error) throw new Error(error.message);
  cache.set(tenantId, normalizar(cfg));
}
