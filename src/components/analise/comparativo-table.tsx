import { Card } from "@/components/ui/card";
import { formatBRL, formatBRLCompact, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isCustoDespesa } from "@/lib/analise-helpers";
import { Zap } from "lucide-react";

export interface CompRow {
  linha_ordem: number;
  descricao: string;
  nivel: number;
  is_subtotal: boolean;
  valorA: number;
  valorB: number;
}

interface Props {
  rows: CompRow[];
  labelA: string;
  labelB: string;
  /** Modo apresentação: oculta colunas de valor absoluto e aumenta a fonte */
  presentation?: boolean;
}

export function ComparativoTable({ rows, labelA, labelB, presentation }: Props) {
  if (rows.length === 0) {
    return (
      <Card className="p-10 text-center text-sm text-muted-foreground">
        Nenhum dado para os períodos selecionados.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className={cn("w-full", presentation ? "text-sm" : "text-xs")}>
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-4 py-3 font-medium uppercase tracking-wider text-muted-foreground sticky left-0 bg-muted/30 text-[11px]">
                Descrição
              </th>
              {!presentation && (
                <>
                  <th className="text-right px-4 py-3 font-medium uppercase tracking-wider text-muted-foreground tabular-nums text-[11px]">{labelA}</th>
                  <th className="text-right px-4 py-3 font-medium uppercase tracking-wider text-muted-foreground tabular-nums text-[11px]">{labelB}</th>
                </>
              )}
              <th className="text-right px-4 py-3 font-medium uppercase tracking-wider text-muted-foreground tabular-nums text-[11px]">Var R$</th>
              <th className="text-right px-4 py-3 font-medium uppercase tracking-wider text-muted-foreground tabular-nums text-[11px]">Var %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const delta = r.valorB - r.valorA;
              const variacao = r.valorA !== 0 ? (delta / Math.abs(r.valorA)) * 100 : null;
              const inverter = !r.is_subtotal && isCustoDespesa(r.descricao);
              const rawPos = variacao != null && variacao > 0;
              const rawNeg = variacao != null && variacao < 0;
              const positive = inverter ? rawNeg : rawPos;
              const negative = inverter ? rawPos : rawNeg;
              const extreme = variacao != null && Math.abs(variacao) > 50;

              return (
                <tr key={r.linha_ordem} className={cn("border-t hover:bg-accent/40", r.is_subtotal && "bg-muted/40 font-semibold")}>
                  <td
                    className={cn("px-4 sticky left-0 bg-card", presentation ? "py-3" : "py-2.5")}
                    style={{ paddingLeft: `${16 + r.nivel * 14}px` }}
                  >
                    {r.descricao}
                  </td>
                  {!presentation && (
                    <>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(r.valorA)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(r.valorB)}</td>
                    </>
                  )}
                  <td className={cn("px-4 text-right tabular-nums", presentation ? "py-3 text-sm" : "py-2.5")}>
                    {formatBRLCompact(delta)}
                  </td>
                  <td className={cn(
                    "px-4 text-right tabular-nums font-medium",
                    presentation ? "py-3 text-sm" : "py-2.5",
                    positive && "text-success",
                    negative && "text-destructive",
                  )}>
                    {variacao != null ? (
                      <span className="inline-flex items-center justify-end gap-1">
                        {extreme && <Zap className="h-3 w-3 animate-pulse" />}
                        {variacao > 0 ? "▲" : variacao < 0 ? "▼" : ""} {formatPct(Math.abs(variacao), 1)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
