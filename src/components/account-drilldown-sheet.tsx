import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useAccountDrilldown } from "@/hooks/use-drilldown";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { formatBRL, periodoLabel } from "@/lib/format";
import { Loader2, FileSearch } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  codigoConta: string | null;
  descricao: string;
}

export function AccountDrilldownSheet({
  open,
  onOpenChange,
  codigoConta,
  descricao,
}: Props) {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const { data, isLoading } = useAccountDrilldown(companyId, codigoConta, periodos, open);

  // Build period columns from data (more reliable than filter for drilldown)
  const periodSet = new Set<string>();
  (data ?? []).forEach((d) => Object.keys(d.values).forEach((p) => periodSet.add(p)));
  const periods = Array.from(periodSet).sort();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-primary" />
            Drill-down: {descricao}
          </SheetTitle>
          <SheetDescription>
            {codigoConta
              ? `Contas analíticas que compõem a linha "${descricao}" (código ${codigoConta}).`
              : "Esta linha não possui código de conta associado para detalhamento."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          {!codigoConta ? (
            <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Linhas calculadas (subtotais, EBITDA, etc.) não têm contas analíticas
              vinculadas — abra uma linha de saldo para ver o detalhamento.
            </div>
          ) : isLoading ? (
            <div className="flex items-center gap-2 justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando contas analíticas…
            </div>
          ) : !data || data.length === 0 ? (
            <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Nenhuma conta analítica encontrada para o código {codigoConta} nos
              períodos selecionados.
            </div>
          ) : (
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-muted-foreground px-3 py-2.5">
                        Código
                      </th>
                      <th className="text-left font-medium text-xs uppercase tracking-wider text-muted-foreground px-3 py-2.5">
                        Conta
                      </th>
                      {periods.map((p) => (
                        <th
                          key={p}
                          className="text-right font-medium text-xs uppercase tracking-wider text-muted-foreground px-3 py-2.5 tabular-nums"
                        >
                          {periodoLabel(p)}
                        </th>
                      ))}
                      <th className="text-right font-medium text-xs uppercase tracking-wider text-muted-foreground px-3 py-2.5">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((acc, idx) => (
                      <tr
                        key={idx}
                        className={cn(
                          "border-b last:border-0 hover:bg-accent/40",
                          (acc.nivel ?? 0) <= 2 && "font-medium bg-muted/20",
                        )}
                      >
                        <td
                          className="px-3 py-2 font-mono text-xs text-muted-foreground"
                          style={{ paddingLeft: `${12 + (acc.nivel ?? 0) * 8}px` }}
                        >
                          {acc.codigo_conta}
                        </td>
                        <td className="px-3 py-2">{acc.nome_conta ?? "—"}</td>
                        {periods.map((p) => (
                          <td key={p} className="px-3 py-2 text-right tabular-nums">
                            {formatBRL(acc.values[p] ?? 0)}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {formatBRL(acc.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
