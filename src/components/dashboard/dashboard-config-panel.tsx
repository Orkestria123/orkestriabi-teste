import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, ArrowUp, ArrowDown, Info, Table2 } from "lucide-react";
import { toast } from "sonner";
import { ensureDashboardConfig } from "@/lib/dashboard/ensure-config";
import { INDICES_DASHBOARD, blocoIndice } from "@/lib/dashboard/indices-financeiros";

interface DashboardConfigRow {
  id: string;
  tenant_id: string;
  company_id: string | null;
  bloco: string;
  visivel: boolean;
  ordem: number;
  config: Record<string, unknown> | null;
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

  const invalidarIndices = () => {
    qc.invalidateQueries({ queryKey: qk });
    qc.invalidateQueries({ queryKey: ["dashboard-indices-visiveis", tenantId] });
  };

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
      if (criou) {
        qc.invalidateQueries({ queryKey: qk });
        qc.invalidateQueries({ queryKey: ["dashboard-indices-visiveis", tenantId] });
      }
    })();
  }, [rows, tenantId, companyId, qc]);

  const byKey = useMemo(() => {
    const m = new Map<string, DashboardConfigRow>();
    for (const r of rows ?? []) m.set(r.bloco, r);
    return m;
  }, [rows]);

  const ordenados = useMemo(() => {
    const all = INDICES_DASHBOARD
      .map((d) => ({ def: d, bloco: blocoIndice(d.key), row: byKey.get(blocoIndice(d.key)) ?? null }));
    const pin = all.filter((x) => x.def.key === "resultado");
    const resto = all
      .filter((x) => x.def.key !== "resultado")
      .sort((a, b) => {
        const oa = a.row?.ordem ?? 9999;
        const ob = b.row?.ordem ?? 9999;
        if (oa !== ob) return oa - ob;
        return a.def.label.localeCompare(b.def.label);
      });
    return [...pin, ...resto];
  }, [byKey]);

  const atualizar = async (row: DashboardConfigRow, patch: Partial<DashboardConfigRow>) => {
    setSaving(row.bloco);
    try {
      const { error } = await supabase
        .from("dashboard_config" as any)
        .update(patch as any)
        .eq("id", row.id);
      if (error) throw error;
      invalidarIndices();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(null);
    }
  };

  const mover = async (index: number, delta: -1 | 1) => {
    if (ordenados[index]?.def.key === "resultado") return;
    const dest = index + delta;
    if (dest < 0 || dest >= ordenados.length) return;
    if (ordenados[dest]?.def.key === "resultado") return;
    const alvo = ordenados[index];
    const vizinho = ordenados[dest];
    if (!alvo?.row || !vizinho?.row) return;
    const oa = alvo.row.ordem;
    const ov = vizinho.row.ordem;
    setSaving(alvo.bloco);
    try {
      const { error: e1 } = await supabase
        .from("dashboard_config" as any)
        .update({ ordem: ov } as any)
        .eq("id", alvo.row.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("dashboard_config" as any)
        .update({ ordem: oa } as any)
        .eq("id", vizinho.row.id);
      if (e2) throw e2;
      invalidarIndices();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(null);
    }
  };

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
              ? <>Linhas da tabela <strong>Índices financeiros</strong> na Visão Geral: ligue para mostrar, desligue para ocultar, e reordene com as setas.</>
              : <>Nesta empresa você oculta ou reordena as linhas da tabela de índices da Visão Geral.</>}
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Table2 className="h-4 w-4" />
          <h3 className="font-semibold text-sm">Tabela Índices (Visão Geral)</h3>
        </div>
        <div className="divide-y divide-border">
          {ordenados.map(({ def, bloco, row }, i) => {
            if (!row) {
              return (
                <div key={bloco} className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Preparando "{def.label}"…
                </div>
              );
            }
            const busy = saving === bloco;
            return (
              <div key={bloco} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="flex flex-col gap-1">
                  <Button size="icon" variant="ghost" className="h-6 w-6" disabled={i <= 1 || busy} onClick={() => mover(i, -1)}>
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" disabled={i === 0 || i === ordenados.length - 1 || busy} onClick={() => mover(i, 1)}>
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{def.label}</span>
                    {!row.visivel && (
                      <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-400">
                        Oculto
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{def.formula}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Visível</span>
                  <Switch
                    checked={row.visivel}
                    disabled={busy}
                    onCheckedChange={(v) => atualizar(row, { visivel: v })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
