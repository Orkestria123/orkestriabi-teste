import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import { projetar, type PontoSerie } from "@/lib/analise-tendencia";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE } from "@/lib/chart-config";
import { formatBRLCompact, formatBRL } from "@/lib/format";

interface Props {
  serie: PontoSerie[];
}

export function ProjecaoPanel({ serie }: Props) {
  const [meses, setMeses] = useState(3);
  const dados = useMemo(() => projetar(serie, meses), [serie, meses]);
  const ultHistorico = serie.length;

  const futuro = dados.slice(ultHistorico);
  const recProjFinal = futuro.length > 0 ? futuro[futuro.length - 1].receitaProj ?? 0 : 0;
  const desProjFinal = futuro.length > 0 ? futuro[futuro.length - 1].despesaProj ?? 0 : 0;
  const margemProj = recProjFinal - desProjFinal;
  const margemPct = recProjFinal > 0 ? (margemProj / recProjFinal) * 100 : 0;

  if (serie.length < 3) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        São necessários pelo menos 3 meses de histórico para projetar tendência.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-3 bg-muted/30 flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-muted-foreground">
          Projeção baseada em <strong>regressão linear</strong> dos últimos {serie.length} meses.
          A faixa cinza indica o intervalo de confiança de 95%. <em>Não é previsão garantida.</em>
        </div>
        <div className="flex items-center gap-1">
          {[3, 6, 12].map((m) => (
            <Button
              key={m}
              size="sm"
              variant={meses === m ? "default" : "outline"}
              onClick={() => setMeses(m)}
              className="h-7 px-2 text-xs"
            >
              +{m}m
            </Button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi label={`Receita projetada (+${meses}m)`} value={formatBRL(recProjFinal)} />
        <Kpi label={`Despesa projetada (+${meses}m)`} value={formatBRL(desProjFinal)} />
        <Kpi
          label="Margem projetada"
          value={`${formatBRL(margemProj)} (${margemPct.toFixed(2).replace(".", ",")}%)`}
          tone={margemProj >= 0 ? "positive" : "negative"}
        />
      </div>

      <Card className="p-4">
        <p className="text-sm font-medium mb-2">Projeção de Receita e Despesa</p>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dados} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="mes" {...AXIS_PROPS} />
              <YAxis tickFormatter={(v) => formatBRLCompact(v)} {...AXIS_PROPS} />
              <Tooltip
                formatter={(v: any) => (v == null ? "—" : formatBRL(Number(v)))}
                contentStyle={TOOLTIP_STYLE}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {ultHistorico > 0 && (
                <ReferenceLine
                  x={serie[serie.length - 1].mes}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="2 2"
                  label={{ value: "hoje", position: "top", fontSize: 10, fill: "var(--muted-foreground)" }}
                />
              )}
              <Area type="monotone" dataKey="receitaProjMax" stroke="none" fill="var(--success)" fillOpacity={0.15} name="Confiança ±" legendType="none" />
              <Area type="monotone" dataKey="receitaProjMin" stroke="none" fill="var(--background)" fillOpacity={1} legendType="none" />
              <Line type="monotone" dataKey="receita" name="Receita histórica" stroke="var(--success)" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="despesaTotal" name="Despesa histórica" stroke="var(--destructive)" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="receitaProj" name="Receita projetada" stroke="var(--success)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
              <Line type="monotone" dataKey="despesaProj" name="Despesa projetada" stroke="var(--destructive)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "neutral" }) {
  const toneCls = tone === "positive" ? "text-success" : tone === "negative" ? "text-destructive" : "text-foreground";
  return (
    <Card className="p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${toneCls}`}>{value}</p>
    </Card>
  );
}
