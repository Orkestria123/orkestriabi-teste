import { useId } from "react";

interface Props {
  values: (number | null)[];
  color: string;
  height?: number;
}

export function MiniTrend({ values, color, height = 48 }: Props) {
  const uid = useId().replace(/[:]/g, "");
  const clean = values.filter((v): v is number => v != null && isFinite(v));
  if (clean.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-[10px] text-muted-foreground"
        style={{ height }}
      >
        sem histórico suficiente
      </div>
    );
  }
  const w = 240;
  const h = height;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  const step = w / (clean.length - 1);
  const pts = clean.map((v, i) => ({
    x: i * step,
    y: h - 4 - ((v - min) / range) * (h - 8),
  }));
  const d = pts.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`;
    const prev = pts[i - 1];
    const cx = (prev.x + pt.x) / 2;
    return `${acc} C ${cx} ${prev.y} ${cx} ${pt.y} ${pt.x} ${pt.y}`;
  }, "");
  const last = pts[pts.length - 1];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      <defs>
        <linearGradient id={`mt-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill={`url(#mt-${uid})`} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={last.x}
        cy={last.y}
        r={3}
        fill={color}
        stroke="var(--card)"
        strokeWidth={1.3}
      />
    </svg>
  );
}
