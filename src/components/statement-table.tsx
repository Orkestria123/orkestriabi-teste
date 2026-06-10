import { useMemo } from "react";
import { formatBRL, formatPct, periodoLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  basePeriod?: string; // for AH
  avBaseCodigo?: string; // codigo or descricao for AV base
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
                    <span className={cn(row.nivel >= 3 && !row.is_subtotal && "text-muted-foreground")}>
                      {row.descricao}
                    </span>
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
