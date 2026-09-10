import { Card } from "@/components/ui/card";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
  Legend,
} from "recharts";
import { formatBRLCompact, formatBRL } from "@/lib/format";
import { PontoEquilibrioResultado } from "@/lib/analise-ponto-equilibrio";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE } from "@/lib/chart-config";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Settings2 } from "lucide-react";

interface Props {
  resultado: PontoEquilibrioResultado;
  labelPeriodo: string;
}

export function PontoEquilibrioPanel({ resultado, labelPeriodo }: Props) {
  const {
    receita,
    custos_fixos,
    custos_variaveis,
    despesa_nao_classificada,
    cobertura_pct,
    margem_contribuicao_pct,
    ponto_equilibrio_receita,
    margem_seguranca_pct,
    alavancagem_operacional,
    serie,
  } = resultado;

  const baixaCobertura = cobertura_pct < 0.6;
  const semClassificacao = custos_fixos === 0 && custos_variaveis === 0;

  if (semClassificacao) {
    return (
      <Card className="p-8 text-center space-y-3">
        <Settings2 className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="text-sm font-medium">
          Nenhuma despesa classificada como Fixo ou Variável.
        </p>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          O Ponto de Equilíbrio precisa que cada grupo de custo/despesa esteja
          marcado como Fixo ou Variável no Plano de Contas.
        </p>
        <Link
          to="/admin/plano-padrao"
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <Settings2 className="h-4 w-4" /> Abrir Plano de Contas
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {baixaCobertura && (
        <Card className="p-3 bg-warning/10 border-warning/40 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground">
            Apenas <strong>{(cobertura_pct * 100).toFixed(0)}%</strong> das despesas estão
            classificadas. Os resultados ficam mais precisos conforme você completa a
            classificação no Plano de Contas.
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Ponto de Equilíbrio"
          value={ponto_equilibrio_receita != null ? formatBRL(ponto_equilibrio_receita) : "—"}
          sub="Receita mínima para empatar"
        />
        <Kpi
          label="Margem de Contribuição"
          value={`${(margem_contribuicao_pct * 100).toFixed(2).replace(".", ",")}%`}
          sub="Sobra após custos variáveis"
        />
        <Kpi
          label="Margem de Segurança"
          value={
            margem_seguranca_pct != null
              ? `${(margem_seguranca_pct * 100).toFixed(2).replace(".", ",")}%`
              : "—"
          }
          sub={
            margem_seguranca_pct != null && margem_seguranca_pct >= 0
              ? "Quanto a receita pode cair antes do prejuízo"
              : "Operando abaixo do equilíbrio"
          }
          tone={
            margem_seguranca_pct == null
              ? "neutral"
              : margem_seguranca_pct >= 0.2
              ? "positive"
              : margem_seguranca_pct >= 0
              ? "warning"
              : "negative"
          }
        />
        <Kpi
          label="Alavancagem Operacional"
          value={
            alavancagem_operacional != null
              ? alavancagem_operacional.toFixed(2).replace(".", ",") + "×"
              : "—"
          }
          sub="Cada 1% de receita → variação no lucro"
        />
      </div>

      <Card className="p-4">
        <p className="text-sm font-medium mb-2">Receita × Custos — {labelPeriodo}</p>
        <p className="text-xs text-muted-foreground mb-4">
          A linha azul (receita) cruza a vermelha (custo total) no Ponto de Equilíbrio.
          Acima desse ponto, a empresa dá lucro.
        </p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={serie} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="receita"
                type="number"
                tickFormatter={(v) => formatBRLCompact(v)}
                {...AXIS_PROPS}
              />
              <YAxis tickFormatter={(v) => formatBRLCompact(v)} {...AXIS_PROPS} />
              <Tooltip
                formatter={(v: any) => formatBRL(Number(v))}
                labelFormatter={(v) => `Receita: ${formatBRL(Number(v))}`}
                contentStyle={TOOLTIP_STYLE}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="receitaTotal" name="Receita" stroke="var(--success)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="custoTotal" name="Custo Total (Fixo + Variável)" stroke="var(--destructive)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="custoFixo" name="Custo Fixo" stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="4 4" dot={false} />
              {ponto_equilibrio_receita != null && (
                <ReferenceDot
                  x={ponto_equilibrio_receita}
                  y={ponto_equilibrio_receita}
                  r={6}
                  fill="var(--primary)"
                  stroke="white"
                  strokeWidth={2}
                  label={{ value: "PE", position: "top", fontSize: 11, fill: "var(--foreground)" }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Mini label="Custos Fixos" value={custos_fixos} />
        <Mini label="Custos Variáveis" value={custos_variaveis} />
        <Mini label="Não classificado" value={despesa_nao_classificada} tone="warning" />
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "positive" | "negative" | "warning" | "neutral";
}) {
  const toneCls =
    tone === "positive"
      ? "text-success"
      : tone === "negative"
      ? "text-destructive"
      : tone === "warning"
      ? "text-warning"
      : "text-foreground";
  return (
    <Card className="p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1.5 text-xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
    </Card>
  );
}

function Mini({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "warning" | "neutral" }) {
  return (
    <Card className="p-3 flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${tone === "warning" ? "text-warning" : ""}`}>
        {formatBRL(value)}
      </span>
    </Card>
  );
}
