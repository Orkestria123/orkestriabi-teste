import { Card } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { formatBRL, formatPct } from "@/lib/format";
import { CHART_COLORS, TOOLTIP_STYLE } from "@/lib/chart-config";

interface OrigemItem {
  nome: string;
  valor: number;
  pct: number;
}

export function ComposicaoReceita({ data }: { data: OrigemItem[] }) {
  if (data.length === 0) {
    return (
      <Card className="p-5">
        <h3 className="text-sm font-semibold">Composição da Receita</h3>
        <p className="text-xs text-muted-foreground mt-2">Sem receita no período.</p>
      </Card>
    );
  }
  const total = data.reduce((s, d) => s + d.valor, 0);
  const maiorPct = data[0].pct;
  const concentrado = maiorPct > 70;

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold mb-1">De onde vem seu dinheiro</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Receita por origem (produtos, serviços, mercadorias, etc.).
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={data} dataKey="valor" nameKey="nome" innerRadius={60} outerRadius={95} paddingAngle={2}>
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => formatBRL(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="space-y-1.5">
          {data.map((o, i) => (
            <div key={o.nome} className="flex items-center justify-between text-xs border-b border-border/40 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="truncate">{o.nome}</span>
              </div>
              <div className="tabular-nums text-muted-foreground whitespace-nowrap ml-2">
                {formatBRL(o.valor)} <span className="opacity-70">· {formatPct(o.pct)}</span>
              </div>
            </div>
          ))}
          <div className="pt-2 text-[11px] text-muted-foreground">
            Total: <span className="font-medium text-foreground">{formatBRL(total)}</span>
          </div>
        </div>
      </div>
      <p className={`text-xs mt-3 ${concentrado ? "text-destructive" : "text-success"}`}>
        {concentrado
          ? `⚠ ${formatPct(maiorPct, 0)} da receita vem de uma única origem. Alta dependência — considere diversificar.`
          : `✓ Receita diversificada entre ${data.length} ${data.length === 1 ? "origem" : "origens"} — menor risco.`}
      </p>
    </Card>
  );
}
