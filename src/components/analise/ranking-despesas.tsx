import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  ResponsiveContainer,
  Tooltip,
  LabelList,
} from "recharts";
import { ChevronRight, ChevronDown } from "lucide-react";
import { formatBRL, formatBRLCompact, formatPct } from "@/lib/format";
import { AXIS_PROPS, TOOLTIP_STYLE } from "@/lib/chart-config";
import type { RankingItem } from "@/lib/analise-receita-despesa";

interface Props {
  ranking: RankingItem[];
}

export function RankingDespesas({ ranking }: Props) {
  const [aberto, setAberto] = useState<string | null>(null);

  if (ranking.length === 0) {
    return (
      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-2">Ranking de Despesas</h3>
        <p className="text-xs text-muted-foreground">Sem despesas no período.</p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold mb-1">O que está consumindo mais</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Maiores despesas do período. Clique numa barra para ver as contas analíticas.
      </p>
      <ResponsiveContainer width="100%" height={Math.max(220, ranking.length * 38)}>
        <BarChart data={ranking} layout="vertical" margin={{ left: 12, right: 70, top: 4, bottom: 4 }}>
          <XAxis type="number" {...AXIS_PROPS} tickFormatter={formatBRLCompact} />
          <YAxis type="category" dataKey="descricao" {...AXIS_PROPS} width={190} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: any) => formatBRL(Number(v))}
            cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          />
          <Bar dataKey="valor" radius={[0, 5, 5, 0]} onClick={(d: any) => setAberto(aberto === d.classificacao ? null : d.classificacao)} style={{ cursor: "pointer" }}>
            {ranking.map((d, i) => (
              <Cell key={d.classificacao} fill={i < 3 ? "var(--destructive)" : "var(--chart-1)"} />
            ))}
            <LabelList
              dataKey="pct_receita"
              position="right"
              fontSize={10}
              formatter={(v: any) => `${formatPct(Number(v), 1)} rec.`}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-4 space-y-1.5">
        {ranking.map((g) => {
          const abertoAtual = aberto === g.classificacao;
          return (
            <div key={g.classificacao} className="border-b border-border/60 last:border-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAberto(abertoAtual ? null : g.classificacao)}
                className="w-full justify-between text-xs h-8 px-2"
              >
                <span className="flex items-center gap-1.5">
                  {abertoAtual ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  {g.descricao}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatBRL(g.valor)} · {formatPct(g.pct_total, 1)} do total
                </span>
              </Button>
              {abertoAtual && g.filhos && g.filhos.length > 0 && (
                <div className="pl-8 py-1.5 space-y-1">
                  {g.filhos.slice(0, 12).map((f) => (
                    <div key={f.classificacao} className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="truncate">{f.descricao}</span>
                      <span className="tabular-nums whitespace-nowrap ml-2">
                        {formatBRL(f.valor)} · {formatPct(f.pct_receita, 1)} rec.
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
