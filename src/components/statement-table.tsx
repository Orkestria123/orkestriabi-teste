import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { formatBRL, formatPct, periodoLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AccountDrilldownSheet } from "@/components/account-drilldown-sheet";

export interface StatementRow {
  descricao: string;
  codigo_conta: string | null;
  nivel: number;
  is_subtotal: boolean;
  values: Record<string, number>; // period -> value
  linha_ordem: number;
}

interface Props {
  rows: StatementRow[];
  periods: string[];
  showAV?: boolean;
  showAH?: boolean;
  basePeriod?: string;
  avBaseCodigo?: string;
}

export function StatementTable({
  rows,
  periods,
  showAV = false,
  showAH = false,
  basePeriod,
  avBaseCodigo,
}: Props) {
  const avBase = useMemo(() => {
    if (!avBaseCodigo) return null;
    const r = rows.find(
      (x) =>
        x.codigo_conta === avBaseCodigo ||
        x.descricao.toLowerCase().includes(avBaseCodigo.toLowerCase()),
    );
    return r ?? null;
  }, [rows, avBaseCodigo]);

  // Compute children ranges based on nivel
  const childrenMap = useMemo(() => {
    const map = new Map<number, number[]>(); // parent idx -> all descendant indices
    for (let i = 0; i < rows.length; i++) {
      const lvl = rows[i].nivel ?? 0;
      const desc: number[] = [];
      for (let j = i + 1; j < rows.length; j++) {
        if ((rows[j].nivel ?? 0) > lvl) desc.push(j);
        else break;
      }
      if (desc.length > 0) map.set(i, desc);
    }
    return map;
  }, [rows]);

  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const hidden = useMemo(() => {
    const h = new Set<number>();
    collapsed.forEach((idx) => {
      const d = childrenMap.get(idx);
      if (d) d.forEach((c) => h.add(c));
    });
    return h;
  }, [collapsed, childrenMap]);

  const toggle = (idx: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  const allParents = useMemo(
    () => Array.from(childrenMap.keys()),
    [childrenMap],
  );
  const allCollapsed = allParents.length > 0 && allParents.every((p) => collapsed.has(p));

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(allParents));

  const [drilldown, setDrilldown] = useState<{ codigo: string | null; descricao: string } | null>(null);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
        Nenhum dado encontrado para os filtros selecionados.
        <br />
        Faça upload de um arquivo SPED para começar.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {allParents.length > 0 && (
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-b bg-muted/20 text-xs">
          <button
            onClick={allCollapsed ? expandAll : collapseAll}
            className="px-2 h-7 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            {allCollapsed ? "Expandir todos" : "Recolher todos"}
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left font-medium text-xs uppercase tracking-wider text-muted-foreground px-4 py-3 sticky left-0 bg-muted/30">
                Descrição
              </th>
              {periods.map((p) => (
                <th
                  key={p}
                  className="text-right font-medium text-xs uppercase tracking-wider text-muted-foreground px-4 py-3 tabular-nums"
                >
                  {periodoLabel(p)}
                </th>
              ))}
              {showAV && (
                <th className="text-right font-medium text-xs uppercase tracking-wider text-muted-foreground px-4 py-3">
                  AV%
                </th>
              )}
              {showAH && basePeriod && (
                <th className="text-right font-medium text-xs uppercase tracking-wider text-muted-foreground px-4 py-3">
                  AH%
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              if (hidden.has(idx)) return null;
              const lastPeriod = periods[periods.length - 1];
              const lastValue = row.values[lastPeriod] ?? 0;
              const av =
                avBase && avBase.values[lastPeriod]
                  ? (lastValue / avBase.values[lastPeriod]) * 100
                  : null;
              const baseValue = basePeriod ? row.values[basePeriod] : null;
              const ah =
                baseValue != null && baseValue !== 0
                  ? ((lastValue - baseValue) / Math.abs(baseValue)) * 100
                  : null;
              const hasChildren = childrenMap.has(idx);
              const isCollapsed = collapsed.has(idx);
              return (
                <tr
                  key={idx}
                  className={cn(
                    "border-b last:border-0 hover:bg-accent/40 transition-colors",
                    row.is_subtotal && "bg-muted/40 font-semibold",
                  )}
                >
                  <td
                    className={cn(
                      "px-4 py-2.5 sticky left-0 bg-card",
                      row.is_subtotal && "bg-muted/40",
                    )}
                    style={{ paddingLeft: `${16 + row.nivel * 16}px` }}
                  >
                    <div className="flex items-center gap-1.5">
                      {hasChildren ? (
                        <button
                          onClick={() => toggle(idx)}
                          className="shrink-0 grid place-items-center h-5 w-5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={isCollapsed ? "Expandir" : "Recolher"}
                        >
                          <ChevronRight
                            className={cn(
                              "h-3.5 w-3.5 transition-transform",
                              !isCollapsed && "rotate-90",
                            )}
                          />
                        </button>
                      ) : (
                        <span className="inline-block w-5 shrink-0" />
                      )}
                      <button
                        type="button"
                        onClick={() => setDrilldown({ codigo: row.codigo_conta, descricao: row.descricao })}
                        className={cn(
                          "text-left hover:text-primary hover:underline decoration-dotted underline-offset-4 transition-colors inline-flex items-center gap-1.5 group",
                          row.nivel >= 3 && !row.is_subtotal && "text-muted-foreground",
                        )}
                        title="Ver contas analíticas que compõem esta linha"
                      >
                        {row.descricao}
                        <Search className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                      </button>
                    </div>
                  </td>
                  {periods.map((p) => (
                    <td key={p} className="px-4 py-2.5 text-right tabular-nums">
                      {formatBRL(row.values[p] ?? 0)}
                    </td>
                  ))}
                  {showAV && (
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {av != null ? formatPct(av) : "—"}
                    </td>
                  )}
                  {showAH && basePeriod && (
                    <td
                      className={cn(
                        "px-4 py-2.5 text-right tabular-nums",
                        ah != null && ah > 0 && "text-success",
                        ah != null && ah < 0 && "text-destructive",
                      )}
                    >
                      {ah != null ? formatPct(ah) : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
