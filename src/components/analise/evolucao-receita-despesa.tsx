import { Card } from "@/components/ui/card";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { formatBRL, formatBRLCompact, formatPct } from "@/lib/format";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE } from "@/lib/chart-config";

interface SerieItem {
  mes: string;
  receita: number;
  despesaTotal: number;
  margem: number;
}

export function EvolucaoReceitaDespesa({ data }: { data: SerieItem[] }) {
  if (data.length < 2) {
    return (
      <Card className="p-5">
        <h3 className="text-sm font-semibold">Evolução Receita × Despesa</h3>
        <p className="text-xs text-muted-foreground mt-2">
          Selecione um período com pelo menos 2 meses para ver a evolução.
        </p>
      </Card>
    );
  }

  const first = data[0];
  const last = data[data.length - 1];
  const ahReceita = first.receita ? ((last.receita - first.receita) / Math.abs(first.receita)) * 100 : 0;
  const ahDespesa = first.despesaTotal
    ? ((last.despesaTotal - first.despesaTotal) / Math.abs(first.despesaTotal)) * 100
    : 0;
  const tesoura = ahDespesa > ahReceita;
  const insight = tesoura
    ? `⚠ Efeito tesoura: despesas crescem ${formatPct(Math.abs(ahDespesa), 0)} enquanto a receita cresce ${formatPct(Math.abs(ahReceita), 0)}. Margem em compressão.`
    : `✓ Receita cresce ${formatPct(Math.abs(ahReceita), 0)} acima do crescimento das despesas (${formatPct(Math.abs(ahDespesa), 0)}). Margem em expansão.`;

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold mb-1">Receita × Despesa no tempo</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Quando as linhas se aproximam, a margem aperta. A área entre elas é o seu resultado.
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 12, bottom: 8 }}>
          <defs>
            <linearGradient id="gradMargem" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--success)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="mes" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} tickFormatter={formatBRLCompact} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: any) => formatBRL(Number(v))}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area type="monotone" dataKey="margem" fill="url(#gradMargem)" stroke="none" name="Margem" />
          <Line
            type="monotone"
            dataKey="receita"
            stroke="var(--success)"
            strokeWidth={2.5}
            name="Receita"
            dot={{ r: 3 }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="despesaTotal"
            stroke="var(--destructive)"
            strokeWidth={2.5}
            name="Despesa Total"
            dot={{ r: 3 }}
            activeDot={{ r: 6 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <p className={`text-xs mt-3 ${tesoura ? "text-destructive" : "text-success"}`}>{insight}</p>
    </Card>
  );
}
