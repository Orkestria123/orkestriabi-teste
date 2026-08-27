import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, ArrowUp, ArrowDown, Info, LayoutDashboard } from "lucide-react";
import { toast } from "sonner";
import { ensureDashboardConfig } from "@/lib/dashboard/ensure-config";
import {
  BLOCOS_CATALOGO,
  KPI_DESTAQUE,
  KPI_LABEL,
  KPI_PAPEL,
  KPI_VIA_INDICADOR,
  BASE_COMPARACAO_OPCOES,
} from "@/lib/dashboard/catalogo";
import { LINHAS_CATALOGO } from "@/lib/indicadores/linhas";

export {
  BLOCOS_CATALOGO,
  KPI_DESTAQUE,
  KPI_LABEL,
  KPI_PAPEL,
  BASE_COMPARACAO_OPCOES,
};

interface DashboardConfigRow {
  id: string;
  tenant_id: string;
  company_id: string;
  bloco: string;
  visivel: boolean;
  ordem: number;
  config: Record<string, any> | null;
}

interface IndicadorRow {
  id: string;
  nome: string;
  categoria: string | null;
  visibilidade: "invisivel" | "indicadores" | "dashboard" | "ambos";
}

export function DashboardConfigPanel({
  tenantId,
  companyId,
}: {
  tenantId: string;
  companyId?: string;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const isTenant = !companyId;
  const qk = ["dashboard-config", tenantId, companyId ?? "tenant"] as const;

  const { data: rows, isLoading } = useQuery({
    queryKey: qk,
    queryFn: async () => {
      let q = supabase.from("dashboard_config" as any).select("*").eq("tenant_id", tenantId);
      q = isTenant ? q.is("company_id", null) : q.eq("company_id", companyId!);
      const { data, error } = await q.order("ordem");
      if (error) throw error;
      return (data ?? []) as unknown as DashboardConfigRow[];
    },
  });

  useEffect(() => {
    if (!rows) return;
    (async () => {
      const criou = await ensureDashboardConfig(tenantId, companyId);
      if (criou) qc.invalidateQueries({ queryKey: qk });
    })();
  }, [rows, tenantId, companyId, qc]);

  const byKey = useMemo(() => {
    const m = new Map<string, DashboardConfigRow>();
    for (const r of rows ?? []) m.set(r.bloco, r);
    return m;
  }, [rows]);

  const ordenados = useMemo(() => {
    return BLOCOS_CATALOGO
      .map((b) => ({ def: b, row: byKey.get(b.key) ?? null }))
      .sort((a, b) => {
        const oa = a.row?.ordem ?? 9999;
        const ob = b.row?.ordem ?? 9999;
        if (oa !== ob) return oa - ob;
        return a.def.label.localeCompare(b.def.label);
      });
  }, [byKey]);

  const atualizar = async (row: DashboardConfigRow, patch: Partial<DashboardConfigRow>) => {
    setSaving(row.bloco);
    try {
      const { error } = await supabase
        .from("dashboard_config" as any)
        .update(patch as any)
        .eq("id", row.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: qk });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(null);
    }
  };

  const mover = async (index: number, delta: -1 | 1) => {
    const alvo = ordenados[index];
    const vizinho = ordenados[index + delta];
    if (!alvo?.row || !vizinho?.row) return;
    const oa = alvo.row.ordem;
    const ov = vizinho.row.ordem;
    setSaving(alvo.def.key);
    try {
      const { error: e1 } = await supabase.from("dashboard_config" as any).update({ ordem: ov } as any).eq("id", alvo.row.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("dashboard_config" as any).update({ ordem: oa } as any).eq("id", vizinho.row.id);
      if (e2) throw e2;
      qc.invalidateQueries({ queryKey: qk });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(null);
    }
  };

  const { data: indicadores } = useQuery({
    queryKey: ["dashboard-indicadores-info", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("indicadores_da_empresa", {
        _company_id: companyId,
      });
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((i) => i.visibilidade === "dashboard" || i.visibilidade === "ambos")
        .sort((a, b) => (a.categoria ?? "").localeCompare(b.categoria ?? "") ||
                        a.nome.localeCompare(b.nome)) as unknown as IndicadorRow[];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 border-blue-500/30 bg-blue-500/5">
        <div className="flex gap-2 text-sm">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            {isTenant
              ? <>Cards e gráficos da Visão Geral do escritório: ligue/desligue e reordene. Faturamento, Receita Líquida e Lucro Líquido usam as <strong>linhas da DRE</strong>. EBIT e EBITDA usam a fórmula dos indicadores Ebit e Ebitda.</>
              : <>Nesta empresa você só oculta blocos ou muda a base de comparação. Papéis dos cards e gráficos se definem em <strong>Configurações → Indicadores</strong>.</>}
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4" />
          <h3 className="font-semibold text-sm">Blocos padrão</h3>
        </div>
        <div className="divide-y divide-border">
          {ordenados.map(({ def, row }, i) => {
            if (!row) {
              return (
                <div key={def.key} className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Preparando "{def.label}"…
                </div>
              );
            }
            const base = (row.config as any)?.base_comparacao ?? "mes_anterior";
            const busy = saving === def.key;
            return (
              <div key={def.key} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="flex flex-col gap-1">
                  <Button size="icon" variant="ghost" className="h-6 w-6" disabled={i === 0 || busy} onClick={() => mover(i, -1)}>
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" disabled={i === ordenados.length - 1 || busy} onClick={() => mover(i, 1)}>
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{def.label}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{def.categoria}</Badge>
                    {!row.visivel && (
                      <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-400">
                        Oculto
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{def.descricao}</div>
                </div>
                {def.suportaBaseComparacao && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Comparar com:</span>
                    <select
                      value={base}
                      disabled={busy}
                      onChange={(e) =>
                        atualizar(row, {
                          config: { ...(row.config ?? {}), base_comparacao: e.target.value },
                        })
                      }
                      className="h-8 rounded border border-border bg-background px-2 text-xs"
                    >
                      {BASE_COMPARACAO_OPCOES.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Visível</span>
                  <Switch
                    checked={row.visivel}
                    disabled={busy}
                    onCheckedChange={(v) => atualizar(row, { visivel: v })}
                  />
                </div>
                {isTenant && def.categoria === "kpi" && KPI_VIA_INDICADOR[def.key] && (
                  <span className="text-[11px] text-muted-foreground">
                    Valor = fórmula do indicador {KPI_VIA_INDICADOR[def.key] === "ebitda" ? "Ebitda" : "Ebit"}
                  </span>
                )}
                {isTenant && def.categoria === "kpi" && !KPI_VIA_INDICADOR[def.key] && (
                  <LinhaSelect
                    label="Valor (indicador)"
                    value={(row.config as any)?.papel ?? KPI_PAPEL[def.key]}
                    disabled={busy}
                    origens={["DRE"]}
                    onChange={(papel) =>
                      atualizar(row, { config: { ...(row.config ?? {}), papel } })
                    }
                  />
                )}
                {isTenant && def.key === "grafico_receita_despesa" && (
                  <>
                    <LinhaSelect
                      label="Receita"
                      value={(row.config as any)?.papel_receita ?? "RECEITA_LIQUIDA"}
                      disabled={busy}
                      origens={["DRE"]}
                      onChange={(papel_receita) =>
                        atualizar(row, { config: { ...(row.config ?? {}), papel_receita } })
                      }
                    />
                    <LinhaSelect
                      label="Custos"
                      value={(row.config as any)?.papel_custos ?? "CUSTOS"}
                      disabled={busy}
                      origens={["DRE"]}
                      onChange={(papel_custos) =>
                        atualizar(row, { config: { ...(row.config ?? {}), papel_custos } })
                      }
                    />
                  </>
                )}
                {isTenant && def.key === "grafico_tendencia" && (
                  <LinhaSelect
                    label="Resultado"
                    value={(row.config as any)?.papel_lucro ?? "LUCRO_LIQUIDO"}
                    disabled={busy}
                    origens={["DRE"]}
                    onChange={(papel_lucro) =>
                      atualizar(row, { config: { ...(row.config ?? {}), papel_lucro } })
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {!isTenant && (
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Indicadores exibidos na Visão Geral</h3>
          <div className="text-xs text-muted-foreground">
            Vindos da aba <strong>Indicadores</strong> desta empresa (visibilidade Dashboard ou Ambos).
            Para incluir ou tirar, use essa aba — a fórmula só se edita em Configurações → Indicadores.
          </div>
        </div>
        <div className="p-4">
          {(indicadores ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground italic">
              Nenhum indicador marcado para o Dashboard.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(indicadores ?? []).map((ind) => (
                <Badge key={ind.id} variant="secondary" className="text-xs gap-1">
                  <span>{ind.nome}</span>
                  {ind.categoria && (
                    <span className="text-muted-foreground">· {ind.categoria}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    ({ind.visibilidade === "ambos" ? "Ambos" : "Dashboard"})
                  </span>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Card>
      )}
    </div>
  );
}

function LinhaSelect({
  label,
  value,
  disabled,
  origens,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  origens: Array<"DRE" | "BP">;
  onChange: (v: string) => void;
}) {
  const opcoes = LINHAS_CATALOGO.filter((l) => origens.includes(l.origem));
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground whitespace-nowrap">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded border border-border bg-background px-2 text-xs max-w-[220px]"
      >
        {opcoes.map((l) => (
          <option key={l.key} value={l.key}>{l.label}</option>
        ))}
      </select>
    </div>
  );
}
