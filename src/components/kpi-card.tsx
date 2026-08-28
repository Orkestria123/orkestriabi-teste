import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatBRLCompact, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useId } from "react";

interface Props {
  label: string;
  value: number | null;
  previousValue?: number | null;
  format?: "brl" | "pct";
  tone?: "default" | "positive" | "negative" | "neutral";
  sparkline?: number[];
  hint?: string;
}

export function KpiCard({
  label,
  value,
  previousValue,
  format = "brl",
  tone = "default",
  sparkline,
  hint,
}: Props) {
  const variation =
    previousValue != null && previousValue !== 0 && value != null
      ? ((value - previousValue) / Math.abs(previousValue)) * 100
      : null;
  const positive = variation != null && variation > 0;
  const negative = variation != null && variation < 0;

  const accentClass =
    tone === "positive"
      ? "before:bg-success"
      : tone === "negative"
      ? "before:bg-destructive"
      : tone === "neutral"
      ? "before:bg-muted-foreground/40"
      : "before:bg-[var(--brand)]";

  return (
    <Card
      className={cn(
        "relative overflow-hidden p-5 transition-shadow hover:shadow-[var(--shadow-elegant)]",
        "before:absolute before:left-0 before:top-0 before:h-full before:w-1",
        accentClass,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-medium">
          {label}
        </div>
        {variation != null && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md",
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
          </span>
        )}
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums font-[var(--font-display)] text-foreground">
        {value == null ? "—" : format === "brl" ? formatBRLCompact(value) : formatPct(value)}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      {sparkline && sparkline.length > 1 && (
        <Sparkline values={sparkline} positive={positive} negative={negative} />
      )}
    </Card>
  );
}

function Sparkline({
  values,
  positive,
  negative,
}: {
  values: number[];
  positive?: boolean;
  negative?: boolean;
}) {
  const uid = useId().replace(/[:]/g, "");
  const w = 120;
  const h = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => ({
    x: i * step,
    y: h - 4 - ((v - min) / range) * (h - 8),
  }));

  const d = pts.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`;
    const prev = pts[i - 1];
    const cpx = (prev.x + pt.x) / 2;
    return `${acc} C ${cpx} ${prev.y} ${cpx} ${pt.y} ${pt.x} ${pt.y}`;
  }, "");

  const color = negative ? "var(--destructive)" : positive ? "var(--success)" : "var(--brand)";
  const last = pts[pts.length - 1];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 w-full h-9" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill={`url(#spark-${uid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r={3} fill={color} stroke="var(--card)" strokeWidth={1.5} />
    </svg>
  );
}
