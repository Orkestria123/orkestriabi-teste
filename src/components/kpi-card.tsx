import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatBRLCompact, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: number | null;
  previousValue?: number | null;
  format?: "brl" | "pct";
}

export function KpiCard({ label, value, previousValue, format = "brl" }: Props) {
  const variation =
    previousValue != null && previousValue !== 0 && value != null
      ? ((value - previousValue) / Math.abs(previousValue)) * 100
      : null;
  const positive = variation != null && variation > 0;
  const negative = variation != null && variation < 0;

  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">
        {value == null ? "—" : format === "brl" ? formatBRLCompact(value) : formatPct(value)}
      </div>
      {variation != null && (
        <div
          className={cn(
            "mt-2 inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
            positive && "text-success bg-success/10",
            negative && "text-destructive bg-destructive/10",
            !positive && !negative && "text-muted-foreground bg-muted",
          )}
        >
          {positive ? (
            <ArrowUpRight className="h-3 w-3" />
          ) : negative ? (
            <ArrowDownRight className="h-3 w-3" />
          ) : (
            <Minus className="h-3 w-3" />
          )}
          {formatPct(Math.abs(variation))}
        </div>
      )}
    </Card>
  );
}
