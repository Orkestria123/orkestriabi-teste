import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LabelList } from "recharts";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE, tooltipFormatBRL, ANIMATION, CHART_COLORS } from "@/lib/chart-config";
import { formatBRLCompact } from "@/lib/format";
import type { CompRow } from "./comparativo-table";

interface Props {
  rows: CompRow[];
  labelA: string;
  labelB: string;
}

export function ComparativoBarChart({ rows, labelA, labelB }: Props) {
  // Top 6 subtotais (ou linhas) por magnitude absoluta
  const candidates = rows.filter((r) => r.is_subtotal);
  const pool = candidates.length >= 3 ? candidates : rows;
  const top = [...pool]
    .sort((a, b) => Math.max(Math.abs(b.valorA), Math.abs(b.valorB)) - Math.max(Math.abs(a.valorA), Math.abs(a.valorB)))
    .slice(0, 6);

  if (top.length === 0) return null;

  const data = top.map((r) => ({
    descricao: r.descricao.length > 22 ? r.descricao.slice(0, 22) + "…" : r.descricao,
    [labelA]: r.valorA,
    [labelB]: r.valorB,
  }));

  return (
    <Card className="p-5 shadow-[var(--shadow-soft)]">
      <h3 className="font-semibold mb-1">Top 6 — Comparativo</h3>
      <p className="text-xs text-muted-foreground mb-4">Maiores linhas em magnitude absoluta</p>
      <div className="h-80">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%" barGap={3}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="descricao" {...AXIS_PROPS} interval={0} angle={-15} textAnchor="end" height={70} />
            <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatBRLCompact(v)} width={72} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatBRL} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} iconType="circle" iconSize={8} />
            <Bar dataKey={labelA} fill={CHART_COLORS[0]} radius={[5, 5, 0, 0]} {...ANIMATION}>
              <LabelList dataKey={labelA} position="top" fontSize={10} formatter={(v: number) => Math.abs(v) > 0 ? formatBRLCompact(v) : ""} />
            </Bar>
            <Bar dataKey={labelB} fill={CHART_COLORS[1]} radius={[5, 5, 0, 0]} {...ANIMATION}>
              <LabelList dataKey={labelB} position="top" fontSize={10} formatter={(v: number) => Math.abs(v) > 0 ? formatBRLCompact(v) : ""} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
