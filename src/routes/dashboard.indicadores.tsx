import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { computeIndicators, formatIndicator, type IndicatorValue, type AccountRow } from "@/lib/indicators";
import { periodoLabel } from "@/lib/format";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/indicadores")({ component: Page });

function useAllStatements(companyId: string | null, periodos: string[]) {
  return useQuery({
    queryKey: ["statements-all", companyId, periodos],
    enabled: !!companyId && periodos.length > 0,
    queryFn: async (): Promise<AccountRow[]> => {
      const { data, error } = await supabase
        .from("financial_statements")
        .select("descricao,codigo_conta,periodo,valor,tipo_demonstracao,nivel,is_subtotal")
        .eq("company_id", companyId!)
        .in("periodo", periodos);
      if (error) throw error;
      return (data ?? []).map((d: any) => ({ ...d, valor: Number(d.valor) || 0 }));
    },
  });
}

function Page() {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const { data, isLoading } = useAllStatements(companyId, periodos);

  const indicators = useMemo(
    () => computeIndicators(data ?? [], periodos),
    [data, periodos],
  );

  const byCategory = useMemo(() => {
    const m = new Map<string, IndicatorValue[]>();
    for (const ind of indicators) {
      if (!m.has(ind.category)) m.set(ind.category, []);
      m.get(ind.category)!.push(ind);
    }
    return Array.from(m.entries());
  }, [indicators]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Indicadores</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Análise calculada automaticamente a partir da DRE e do Balanço Patrimonial.
        </p>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Calculando…</div>}

      {byCategory.map(([cat, items]) => (
        <div key={cat}>
          <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">{cat}</h3>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Indicador</th>
                    <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Fórmula</th>
                    {periodos.map((p) => (
                      <th key={p} className="text-right px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground tabular-nums">
                        {periodoLabel(p)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((ind) => {
                    const last = periodos[periodos.length - 1];
                    const prev = periodos[periodos.length - 2];
                    const lastV = ind.values[last];
                    const prevV = prev ? ind.values[prev] : null;
                    const trend =
                      lastV != null && prevV != null && prevV !== 0
                        ? ((lastV - prevV) / Math.abs(prevV)) * 100
                        : null;
                    return (
                      <tr key={ind.key} className="border-t hover:bg-accent/40">
                        <td className="px-4 py-3 font-medium">
                          {ind.label}
                          {trend != null && (
                            <span className={cn("ml-2 text-xs", trend > 0 ? "text-success" : trend < 0 ? "text-destructive" : "text-muted-foreground")}>
                              {trend > 0 ? "▲" : trend < 0 ? "▼" : "—"} {Math.abs(trend).toFixed(1).replace(".", ",")}%
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{ind.description}</td>
                        {periodos.map((p) => (
                          <td key={p} className="px-4 py-3 text-right tabular-nums">
                            {formatIndicator(ind.values[p] ?? null, ind.format)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}
