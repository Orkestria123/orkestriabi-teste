import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useAccountDrilldown } from "@/hooks/use-drilldown";
import { formatBRL, periodoLabel } from "@/lib/format";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  codigoConta: string;
  descricao: string;
  periods: string[];
  colSpanLeft: number;
  colSpanRight: number;
}

export function InlineDrilldown({
  codigoConta,
  descricao,
  periods,
  colSpanLeft,
  colSpanRight,
}: Props) {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const usePeriods = periods.length > 0 ? periods : periodos;
  const { data, isLoading } = useAccountDrilldown(companyId, codigoConta, usePeriods, true);

  return (
    <tr className="bg-muted/20">
      <td colSpan={colSpanLeft + periods.length + colSpanRight} className="p-0">
        <div className="px-6 py-2 border-l-2 border-primary/40 bg-muted/30">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Drill-down · {descricao}
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Carregando contas analíticas…
            </div>
          ) : !data || data.length === 0 ? (
            <div className="py-3 text-xs text-muted-foreground">
              Nenhuma conta analítica encontrada.
            </div>
          ) : (
            <div className="overflow-x-auto rounded border bg-card">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
                      Código
                    </th>
                    <th className="text-left font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
                      Conta
                    </th>
                    {periods.map((p) => (
                      <th
                        key={p}
                        className="text-right font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5 tabular-nums"
                      >
                        {periodoLabel(p)}
                      </th>
                    ))}
                    <th className="text-right font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((acc, i) => (
                    <tr
                      key={i}
                      className={cn(
                        "border-b last:border-0 hover:bg-accent/40",
                        (acc.nivel ?? 0) <= 2 && "font-medium bg-muted/20",
                      )}
                    >
                      <td
                        className="px-2 py-1 font-mono text-[10px] text-muted-foreground"
                        style={{ paddingLeft: `${8 + (acc.nivel ?? 0) * 6}px` }}
                      >
                        {acc.codigo_conta}
                      </td>
                      <td className="px-2 py-1">{acc.nome_conta ?? "—"}</td>
                      {periods.map((p) => (
                        <td key={p} className="px-2 py-1 text-right tabular-nums">
                          {formatBRL(acc.values[p] ?? 0)}
                        </td>
                      ))}
                      <td className="px-2 py-1 text-right tabular-nums font-medium">
                        {formatBRL(acc.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
