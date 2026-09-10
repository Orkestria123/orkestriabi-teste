import { Card } from "@/components/ui/card";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { formatBRLCompact, formatBRL } from "@/lib/format";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE } from "@/lib/chart-config";

interface ParetoItem {
  descricao: string;
  valor: number;
  acumuladoPct?: number;
}

export function ParetoDespesas({ data }: { data: ParetoItem[] }) {
  if (data.length === 0) {
    return (
      <Card className="p-5">
        <h3 className="text-sm font-semibold">Pareto de Despesas</h3>
        <p className="text-xs text-muted-foreground mt-2">Sem dados suficientes.</p>
      </Card>
    );
  }
  const criticas = data.filter((d) => (d.acumuladoPct ?? 0) <= 80);
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold mb-1">O 80/20 das suas despesas</h3>
      <p className="text-xs text-muted-foreground mb-4">
        {criticas.length} {criticas.length === 1 ? "conta concentra" : "contas concentram"} 80% do total. Focar nelas tem o maior impacto.
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 12, bottom: 80 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="descricao" {...AXIS_PROPS} angle={-30} textAnchor="end" interval={0} height={70} />
          <YAxis yAxisId="left" {...AXIS_PROPS} tickFormatter={formatBRLCompact} />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            {...AXIS_PROPS}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: any, k: any) =>
              k === "acumuladoPct" ? `${Number(v).toFixed(1)}%` : formatBRL(Number(v))
            }
          />
          <Bar yAxisId="left" dataKey="valor" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
          <Line
            yAxisId="right"
            dataKey="acumuladoPct"
            stroke="var(--chart-5)"
            strokeWidth={2.5}
            dot={{ r: 3 }}
            name="Acumulado %"
          />
          <ReferenceLine
            yAxisId="right"
            y={80}
            stroke="var(--warning, var(--chart-3))"
            strokeDasharray="4 4"
            label={{ value: "80%", fontSize: 10, fill: "var(--muted-foreground)" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}
