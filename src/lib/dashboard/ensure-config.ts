import { supabase } from "@/integrations/supabase/client";
import { BLOCOS_CATALOGO, configPadraoDoBloco } from "@/lib/dashboard/catalogo";

export type DashboardBlocoRow = {
  id?: string;
  bloco: string;
  visivel: boolean;
  ordem: number;
  config: Record<string, any>;
  origem: "tenant" | "empresa";
};

async function seedTenant(tenantId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("dashboard_config" as any)
    .select("id, bloco, config, visivel, ordem")
    .eq("tenant_id", tenantId)
    .is("company_id", null);
  if (error) throw error;
  const rows = (data ?? []) as unknown as { id: string; bloco: string; config: Record<string, unknown> | null; visivel: boolean; ordem: number }[];
  const existentes = new Set(rows.map((r) => r.bloco));
  const faltantes = BLOCOS_CATALOGO.filter((b) => !existentes.has(b.key));
  let mudou = false;
  if (faltantes.length > 0) {
    const inserts = faltantes.map((b) => ({
      tenant_id: tenantId,
      company_id: null,
      bloco: b.key,
      visivel: true,
      ordem: BLOCOS_CATALOGO.findIndex((x) => x.key === b.key) * 10,
      config: configPadraoDoBloco(b.key, b.suportaBaseComparacao),
    }));
    const { error: insErr } = await supabase.from("dashboard_config" as any).insert(inserts as any);
    if (insErr) throw insErr;
    mudou = true;
  }
  for (const row of rows) {
    const def = BLOCOS_CATALOGO.find((b) => b.key === row.bloco);
    if (!def) continue;
    const padrao = configPadraoDoBloco(def.key, def.suportaBaseComparacao);
    const merged = { ...padrao, ...(row.config ?? {}) };
    const falta = Object.keys(padrao).some((k) => row.config == null || row.config[k] === undefined);
    if (!falta) continue;
    const { error: upErr } = await supabase
      .from("dashboard_config" as any)
      .update({ config: merged } as any)
      .eq("id", row.id);
    if (upErr) throw upErr;
    mudou = true;
  }
  return mudou;
}

export async function ensureDashboardConfig(tenantId: string, companyId?: string) {
  let mudou = await seedTenant(tenantId);
  if (!companyId) return mudou;
  const { data, error } = await supabase
    .from("dashboard_config" as any)
    .select("id, bloco, config")
    .eq("company_id", companyId);
  if (error) throw error;
  const rows = (data ?? []) as unknown as { id: string; bloco: string; config: Record<string, unknown> | null }[];
  const existentes = new Set(rows.map((r) => r.bloco));
  const faltantes = BLOCOS_CATALOGO.filter((b) => !existentes.has(b.key));
  if (faltantes.length > 0) {
    const { data: globais } = await supabase
      .from("dashboard_config" as any)
      .select("bloco, visivel, ordem, config")
      .eq("tenant_id", tenantId)
      .is("company_id", null);
    const gBy = new Map(((globais ?? []) as any[]).map((r) => [r.bloco, r]));
    const inserts = faltantes.map((b) => {
      const g = gBy.get(b.key);
      return {
        tenant_id: tenantId,
        company_id: companyId,
        bloco: b.key,
        visivel: g?.visivel ?? true,
        ordem: g?.ordem ?? BLOCOS_CATALOGO.findIndex((x) => x.key === b.key) * 10,
        config: g?.config ?? configPadraoDoBloco(b.key, b.suportaBaseComparacao),
      };
    });
    const { error: insErr } = await supabase.from("dashboard_config" as any).insert(inserts as any);
    if (insErr) throw insErr;
    mudou = true;
  }
  return mudou;
}

export async function lerDashboardBlocos(tenantId: string, companyId?: string): Promise<DashboardBlocoRow[]> {
  const { data: globais, error: e1 } = await supabase
    .from("dashboard_config" as any)
    .select("*")
    .eq("tenant_id", tenantId)
    .is("company_id", null);
  if (e1) throw e1;
  const gMap = new Map(((globais ?? []) as any[]).map((r) => [r.bloco as string, r]));

  let eMap = new Map<string, any>();
  if (companyId) {
    const { data: empresa, error: e2 } = await supabase
      .from("dashboard_config" as any)
      .select("*")
      .eq("company_id", companyId);
    if (e2) throw e2;
    eMap = new Map(((empresa ?? []) as any[]).map((r) => [r.bloco as string, r]));
  }

  return BLOCOS_CATALOGO.map((def, i) => {
    const g = gMap.get(def.key);
    const e = eMap.get(def.key);
    const config = {
      ...configPadraoDoBloco(def.key, def.suportaBaseComparacao),
      ...(g?.config ?? {}),
    };
    if (e?.config?.base_comparacao) config.base_comparacao = e.config.base_comparacao;
    return {
      id: (companyId ? e?.id : g?.id) as string | undefined,
      bloco: def.key,
      visivel: (e?.visivel ?? g?.visivel ?? true) as boolean,
      ordem: (g?.ordem ?? e?.ordem ?? i * 10) as number,
      config,
      origem: (g ? "tenant" : "empresa") as "tenant" | "empresa",
    };
  }).sort((a, b) => a.ordem - b.ordem);
}
