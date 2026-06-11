import { Card } from "@/components/ui/card";
import { formatBRLCompact, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

interface Props {
  label: string;
  valorA: number | null;
  valorB: number | null;
  labelA: string;
  labelB: string;
  format?: "brl" | "percent";
  /** Para format=percent, variação em p.p.; senão variação relativa em %. */
  inverter?: boolean;
}

function fmt(v: number | null, format: "brl" | "percent") {
  if (v == null || isNaN(v)) return "—";
  return format === "brl" ? formatBRLCompact(v) : formatPct(v);
}

export function HighlightCard({ label, valorA, valorB, labelA, labelB, format = "brl", inverter }: Props) {
  let variacao: number | null = null;
  let varSuffix = "";
  if (valorA != null && valorB != null) {
    if (format === "percent") {
      variacao = valorB - valorA;
      varSuffix = " p.p.";
    } else if (valorA !== 0) {
      variacao = ((valorB - valorA) / Math.abs(valorA)) * 100;
      varSuffix = "%";
    }
  }
  const rawPositive = variacao != null && variacao > 0;
  const rawNegative = variacao != null && variacao < 0;
  const positive = inverter ? rawNegative : rawPositive;
  const negative = inverter ? rawPositive : rawNegative;

  return (
    <Card className="relative overflow-hidden p-5 before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:bg-[var(--brand)]">
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-medium">{label}</p>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{labelA}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{fmt(valorA, format)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{labelB}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{fmt(valorB, format)}</p>
        </div>
      </div>
      {variacao != null && (
        <div
          className={cn(
            "mt-3 inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md",
            positive && "text-success bg-success/10",
            negative && "text-destructive bg-destructive/10",
            !positive && !negative && "text-muted-foreground bg-muted",
          )}
        >
          {variacao > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : variacao < 0 ? <ArrowDownRight className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
          {Math.abs(variacao).toFixed(1).replace(".", ",")}{varSuffix}
        </div>
      )}
    </Card>
  );
}
