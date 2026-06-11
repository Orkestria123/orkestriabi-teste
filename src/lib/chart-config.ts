import { formatBRL, formatBRLCompact } from "@/lib/format";

export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "oklch(0.65 0.14 300)",
  "oklch(0.72 0.12 55)",
  "oklch(0.60 0.12 200)",
];

export const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: "10px",
  border: "1px solid var(--border)",
  backgroundColor: "var(--card)",
  boxShadow: "var(--shadow-elegant)",
  fontSize: 12,
  fontFamily: "var(--font-sans)",
  padding: "10px 14px",
  color: "var(--foreground)",
};

export const AXIS_PROPS = {
  fontSize: 11,
  tickLine: false,
  axisLine: false,
  tick: { fill: "var(--muted-foreground)" },
};

export const GRID_PROPS = {
  strokeDasharray: "2 4",
  stroke: "var(--border)",
  vertical: false,
  opacity: 0.7,
};

export const tooltipFormatBRL = (v: any) => formatBRL(Number(v));
export const tooltipFormatBRLCompact = (v: any) => formatBRLCompact(Number(v));

export const ANIMATION = {
  isAnimationActive: true as const,
  animationDuration: 600,
  animationEasing: "ease-out" as const,
};
