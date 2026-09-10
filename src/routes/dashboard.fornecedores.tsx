import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useFiscalInvoices } from "@/hooks/use-fiscal-data";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { formatBRL, formatBRLCompact, formatPct } from "@/lib/format";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
} from "recharts";
import { Users, TrendingUp, Building2, BarChart3, FileSearch } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/fornecedores")({ component: Page });

const COLORS = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f59e0b", "#64748b", "#94a3b8",
];

function Page() {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const { data: invoices, isLoading } = useFiscalInvoices(companyId, periodos, { tipo: "E" });
  const [selectedSupplier, setSelectedSupplier] = useState<{ id: string; name: string } | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, {
      id: string; nome: string; cnpj: string | null;
      total: number; qtde: number; ultimaCompra: string | null;
    }>();
    for (const inv of invoices ?? []) {
      if (inv.cancelada) continue;
      if (!inv.participant_id) continue;
      const k = inv.participant_id;
      const cur = map.get(k) ?? {
        id: k,
        nome: inv.participant_nome ?? "—",
        cnpj: inv.participant_cnpj ?? null,
        total: 0,
        qtde: 0,
        ultimaCompra: null,
      };
      cur.total += inv.valor_total ?? 0;
      cur.qtde += 1;
      if (!cur.ultimaCompra || (inv.data_emissao && inv.data_emissao > cur.ultimaCompra)) {
        cur.ultimaCompra = inv.data_emissao;
      }
      map.set(k, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [invoices]);

  const totalGeral = grouped.reduce((s, g) => s + g.total, 0);
  const top5Share = grouped.slice(0, 5).reduce((s, g) => s + g.total, 0);
  const top5Pct = totalGeral > 0 ? (top5Share / totalGeral) * 100 : 0;
  const ticketMedio = grouped.reduce((s, g) => s + g.qtde, 0) > 0
    ? totalGeral / grouped.reduce((s, g) => s + g.qtde, 0)
    : 0;

  const pieData = useMemo(() => {
    const top = grouped.slice(0, 10);
    const outros = grouped.slice(10).reduce((s, g) => s + g.total, 0);
    const data = top.map((g) => ({ name: g.nome, value: g.total }));
    if (outros > 0) data.push({ name: "Outros", value: outros });
    return data;
  }, [grouped]);

  if (!companyId) {
    return <p className="text-sm text-muted-foreground">Selecione uma empresa.</p>;
  }

  if (!isLoading && (invoices?.length ?? 0) === 0) {
    return (
      <Card className="p-12 text-center">
        <Receipt className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
        <h3 className="font-semibold mb-1">Sem dados de notas fiscais ainda</h3>
        <p className="text-sm text-muted-foreground">
          Importe um arquivo SPED Fiscal (EFD ICMS/IPI) em Admin → Upload para começar a análise.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Kpi label="Fornecedores ativos" icon={Users} value={grouped.length.toString()} />
        <Kpi label="Volume total de compras" icon={TrendingUp} value={formatBRLCompact(totalGeral)} />
        <Kpi label="Ticket médio por nota" icon={BarChart3} value={formatBRLCompact(ticketMedio)} />
        <Kpi
          label="Concentração Top 5"
          icon={Building2}
          value={formatPct(top5Pct)}
          hint={top5Pct > 60 ? "Concentração alta" : top5Pct > 40 ? "Atenção" : "Diversificada"}
          tone={top5Pct > 60 ? "warning" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <Card className="p-5 shadow-[var(--shadow-soft)]">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <h3 className="font-semibold">Ranking de fornecedores</h3>
              <p className="text-xs text-muted-foreground">Por volume de compras no período</p>
            </div>
            <span className="text-xs text-muted-foreground">{grouped.length} fornecedores</span>
          </div>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                  <th className="text-left px-2 py-2 font-medium">#</th>
                  <th className="text-left px-2 py-2 font-medium">Fornecedor</th>
                  <th className="text-right px-2 py-2 font-medium">Notas</th>
                  <th className="text-right px-2 py-2 font-medium">Ticket médio</th>
                  <th className="text-right px-2 py-2 font-medium">Volume</th>
                  <th className="text-right px-2 py-2 font-medium">Part.</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {grouped.slice(0, 20).map((g, idx) => {
                  const pct = totalGeral > 0 ? (g.total / totalGeral) * 100 : 0;
                  return (
                    <tr
                      key={g.id}
                      className="border-b last:border-0 hover:bg-accent/30 cursor-pointer"
                      onClick={() => setSelectedSupplier({ id: g.id, name: g.nome })}
                    >
                      <td className="px-2 py-2.5 text-muted-foreground tabular-nums">{idx + 1}</td>
                      <td className="px-2 py-2.5">
                        <div className="font-medium truncate max-w-[260px]">{g.nome}</div>
                        {g.cnpj && (
                          <div className="text-[10px] text-muted-foreground font-mono">{g.cnpj}</div>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{g.qtde}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                        {formatBRLCompact(g.total / g.qtde)}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-medium">
                        {formatBRLCompact(g.total)}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        <div className="inline-flex items-center gap-2">
                          <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground w-12 text-right">{pct.toFixed(2).replace(".", ",")}%</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        <FileSearch className="h-3.5 w-3.5 text-muted-foreground" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5 shadow-[var(--shadow-soft)]">
          <h3 className="font-semibold mb-1">Concentração</h3>
          <p className="text-xs text-muted-foreground mb-3">Top 10 + Outros</p>
          <div className="h-[300px]">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={pieData}
                  innerRadius={55}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: any) => formatBRL(Number(v))}
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Sheet open={!!selectedSupplier} onOpenChange={(o) => !o && setSelectedSupplier(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selectedSupplier?.name}</SheetTitle>
            <SheetDescription>Últimas notas fiscais de entrada deste fornecedor</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {(invoices ?? [])
              .filter((i) => i.participant_id === selectedSupplier?.id)
              .slice(0, 50)
              .map((inv) => (
                <div
                  key={inv.id}
                  className={cn(
                    "flex items-center justify-between rounded-md border px-3 py-2 text-sm",
                    inv.cancelada && "opacity-50 line-through",
                  )}
                >
                  <div>
                    <div className="font-medium">NF {inv.numero ?? "—"} · série {inv.serie ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {inv.data_emissao ?? "—"} · modelo {inv.modelo ?? "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{formatBRL(inv.valor_total ?? 0)}</div>
                    {inv.cancelada && <Badge variant="destructive" className="text-[10px]">Cancelada</Badge>}
                  </div>
                </div>
              ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Kpi({
  label, value, icon: Icon, hint, tone = "default",
}: { label: string; value: string; icon: any; hint?: string; tone?: "default" | "warning" }) {
  return (
    <Card className="p-4 relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            {label}
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
          {hint && (
            <div className={cn(
              "mt-1 text-[11px]",
              tone === "warning" ? "text-amber-500" : "text-muted-foreground",
            )}>
              {hint}
            </div>
          )}
        </div>
        <div className={cn(
          "h-9 w-9 rounded-lg grid place-items-center",
          tone === "warning" ? "bg-amber-500/10 text-amber-500" : "bg-primary/10 text-primary",
        )}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Card>
  );
}

function Receipt(props: any) {
  return <FileSearch {...props} />;
}
