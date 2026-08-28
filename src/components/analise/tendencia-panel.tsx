import { Card } from "@/components/ui/card";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, Cell,
} from "recharts";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE } from "@/lib/chart-config";
import { formatBRL, formatBRLCompact, formatPct } from "@/lib/format";
import {
  mediaMovel, crescimentoMensalMedio, sazonalidade,
  type PontoSerie,
} from "@/lib/analise-tendencia";

export function TendenciaPanel({ serie }: { serie: PontoSerie[] }) {
  if (serie.length < 3) {
    return (
      <Card className="p-8 text-center">
        <h3 className="text-sm font-semibold">Tendência</h3>
        <p className="text-xs text-muted-foreground mt-2">
          Selecione um recorte com pelo menos 3 meses para a análise de tendência.
        </p>
      </Card>
    );
  }
  const comMA = mediaMovel(serie, 3);
  const crescR = crescimentoMensalMedio(serie, "receita");
  const crescD = crescimentoMensalMedio(serie, "despesaTotal");
  const sz = sazonalidade(serie);

  const mesForte = [...sz].sort((a, b) => b.indiceReceita - a.indiceReceita)[0];
  const mesFraco = [...sz].filter((s) => s.indiceReceita > 0).sort((a, b) => a.indiceReceita - b.indiceReceita)[0];

  const insight = (() => {
    const partes: string[] = [];
    if (crescR != null) {
      partes.push(
        `Receita cresce em média ${formatPct(Math.abs(crescR))} ao mês ${crescR >= 0 ? "" : "(queda)"}.`,
      );
    }
    if (crescD != null) {
      partes.push(
        `Despesa cresce ${formatPct(Math.abs(crescD))} ao mês ${crescD >= 0 ? "" : "(queda)"}.`,
      );
    }
    if (crescR != null && crescD != null && crescD > crescR) {
      partes.push("⚠ Efeito tesoura: despesas crescem mais rápido que receitas.");
    }
    if (mesForte && mesFraco && mesForte.mes !== mesFraco.mes && mesForte.indiceReceita > 1.1) {
      partes.push(`Mês forte: ${mesForte.mes}. Mês fraco: ${mesFraco.mes}.`);
    }
    return partes.join(" ");
  })();

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
          <h3 className="text-sm font-semibold">Tendência com média móvel (3 meses)</h3>
          <span className="text-[11px] text-muted-foreground">A linha pontilhada suaviza picos e mostra a direção.</span>
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={comMA} margin={{ top: 8, right: 12, left: 12, bottom: 8 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="mes" {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} tickFormatter={formatBRLCompact} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => formatBRL(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="receita" name="Receita" stroke="var(--success)" strokeWidth={2} dot={{ r: 2 }} />
            <Line type="monotone" dataKey="receitaMA" name="Receita (média móvel)" stroke="var(--success)" strokeWidth={2.5} strokeDasharray="6 4" dot={false} />
            <Line type="monotone" dataKey="despesaTotal" name="Despesa" stroke="var(--destructive)" strokeWidth={2} dot={{ r: 2 }} />
            <Line type="monotone" dataKey="despesaMA" name="Despesa (média móvel)" stroke="var(--destructive)" strokeWidth={2.5} strokeDasharray="6 4" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        {insight && <p className="text-xs text-muted-foreground mt-3">{insight}</p>}
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-1">Sazonalidade — receita média por mês</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Barras acima de 100% são meses fortes; abaixo, meses fracos. Use para programar campanhas e caixa.
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={sz} margin={{ top: 8, right: 12, left: 12, bottom: 8 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="mes" {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: any) => `${(Number(v) * 100).toFixed(0)}% da média`}
            />
            <Bar dataKey="indiceReceita" radius={[6, 6, 0, 0]}>
              {sz.map((s, i) => (
                <Cell key={i} fill={s.indiceReceita >= 1 ? "var(--success)" : "var(--muted-foreground)"} fillOpacity={s.indiceReceita >= 1 ? 0.85 : 0.4} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
