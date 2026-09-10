import { Card } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { formatBRL, formatPct } from "@/lib/format";
import { CHART_COLORS, TOOLTIP_STYLE } from "@/lib/chart-config";

interface CentroItem {
  nome: string;
  valor: number;
  pct: number;
}

export function DespesaPorCentro({ data }: { data: CentroItem[] }) {
  if (data.length === 0) {
    return (
      <Card className="p-5">
        <h3 className="text-sm font-semibold">Despesa por Centro</h3>
        <p className="text-xs text-muted-foreground mt-2">Sem centros configurados.</p>
      </Card>
    );
  }
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold mb-1">Onde o dinheiro está sendo gasto</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Distribuição da despesa por centro de atividade.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={data}
              dataKey="valor"
              nameKey="nome"
              innerRadius={60}
              outerRadius={95}
              paddingAngle={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: any) => formatBRL(Number(v))}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="space-y-1.5">
          {data.map((c, i) => (
            <div key={c.nome} className="flex items-center justify-between text-xs border-b border-border/40 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                />
                <span className="truncate">{c.nome}</span>
              </div>
              <div className="tabular-nums text-muted-foreground whitespace-nowrap ml-2">
                {formatBRL(c.valor)} <span className="opacity-70">· {formatPct(c.pct)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
