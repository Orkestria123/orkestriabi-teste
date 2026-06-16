interface Props {
  value: number; // 0-100
  size?: number;
}

// Velocímetro semicircular 0-100 com 3 zonas
export function GaugeChart({ value, size = 200 }: Props) {
  const v = Math.max(0, Math.min(100, value));
  const w = size;
  const h = size / 1.7;
  const cx = w / 2;
  const cy = h - 4;
  const r = w / 2 - 12;
  const stroke = 14;

  const polar = (deg: number) => {
    const rad = ((deg - 180) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const arcPath = (a1: number, a2: number) => {
    const p1 = polar(a1);
    const p2 = polar(a2);
    const large = a2 - a1 > 180 ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y}`;
  };

  // zonas: 0-40 vermelho, 40-70 amarelo, 70-100 verde
  const zonas = [
    { from: 0, to: 40, cor: "var(--destructive)" },
    { from: 40, to: 70, cor: "var(--warning)" },
    { from: 70, to: 100, cor: "var(--success)" },
  ];

  // ângulo do ponteiro
  const angle = -180 + (v / 100) * 180; // -180 → 0
  const pRad = (angle * Math.PI) / 180;
  const tipX = cx + (r - 6) * Math.cos(pRad);
  const tipY = cy + (r - 6) * Math.sin(pRad);

  const corValor =
    v >= 70 ? "var(--success)" : v >= 40 ? "var(--warning)" : "var(--destructive)";

  return (
    <svg viewBox={`0 0 ${w} ${h + 28}`} className="w-full">
      {zonas.map((z, i) => (
        <path
          key={i}
          d={arcPath((z.from / 100) * 180, (z.to / 100) * 180)}
          stroke={z.cor}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="butt"
          opacity={0.9}
        />
      ))}
      {/* ponteiro */}
      <line
        x1={cx}
        y1={cy}
        x2={tipX}
        y2={tipY}
        stroke="var(--foreground)"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={6} fill="var(--foreground)" />
      <text
        x={cx}
        y={h + 22}
        textAnchor="middle"
        fontSize={26}
        fontWeight={700}
        fill={corValor}
      >
        {Math.round(v)}
      </text>
    </svg>
  );
}
