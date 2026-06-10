import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { AlertTriangle, AlertCircle, CheckCircle2, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPct } from "@/lib/format";
import type { IndicatorValue } from "@/lib/indicators";

interface Props {
  indicators: IndicatorValue[];
  periodos: string[];
}

type Alert = {
  severity: "high" | "medium" | "low" | "ok";
  title: string;
  description: string;
};

// Regras configuradas (defaults clássicos de análise financeira)
const RULES: Array<{
  key: string;
  test: (v: number) => Alert | null;
}> = [
  {
    key: "lc",
    test: (v) =>
      v < 1
        ? { severity: "high", title: "Liquidez corrente crítica", description: `Indicador em ${v.toFixed(2).replace(".", ",")} — passivo circulante supera o ativo circulante.` }
        : v < 1.2
        ? { severity: "medium", title: "Liquidez corrente apertada", description: `Indicador em ${v.toFixed(2).replace(".", ",")} — margem de folga baixa para curto prazo.` }
        : null,
  },
  {
    key: "endiv",
    test: (v) =>
      v > 80
        ? { severity: "high", title: "Endividamento elevado", description: `${formatPct(v)} do ativo financiado por terceiros.` }
        : v > 60
        ? { severity: "medium", title: "Endividamento em atenção", description: `${formatPct(v)} do ativo financiado por terceiros.` }
        : null,
  },
  {
    key: "margemLiq",
    test: (v) =>
      v < 0
        ? { severity: "high", title: "Margem líquida negativa", description: `Empresa operando no prejuízo (${formatPct(v)}).` }
        : v < 3
        ? { severity: "medium", title: "Margem líquida baixa", description: `Margem em ${formatPct(v)} — pouca folga operacional.` }
        : null,
  },
  {
    key: "margemBruta",
    test: (v) =>
      v < 10
        ? { severity: "medium", title: "Margem bruta reduzida", description: `Margem bruta em ${formatPct(v)} — revise custos.` }
        : null,
  },
];

export function AlertsCard({ indicators, periodos }: Props) {
  const periodo = periodos[periodos.length - 1];

  const alerts = useMemo<Alert[]>(() => {
    if (!periodo) return [];
    const list: Alert[] = [];
    for (const rule of RULES) {
      const ind = indicators.find((i) => i.key === rule.key);
      if (!ind) continue;
      const v = ind.values[periodo];
      if (v == null || !isFinite(v)) continue;
      const a = rule.test(v);
      if (a) list.push(a);
    }
    return list;
  }, [indicators, periodo]);

  const counts = {
    high: alerts.filter((a) => a.severity === "high").length,
    medium: alerts.filter((a) => a.severity === "medium").length,
  };

  return (
    <Card className="p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "h-8 w-8 rounded-lg grid place-items-center",
              alerts.length === 0
                ? "bg-success/15 text-success"
                : counts.high > 0
                ? "bg-destructive/15 text-destructive"
                : "bg-amber-500/15 text-amber-500",
            )}
          >
            <Bell className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-semibold leading-tight">Alertas financeiros</h3>
            <p className="text-xs text-muted-foreground">
              Baseado nos indicadores do último período
            </p>
          </div>
        </div>
        {alerts.length > 0 && (
          <div className="flex gap-1.5 text-[10px] uppercase tracking-wider font-medium">
            {counts.high > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">
                {counts.high} críticos
              </span>
            )}
            {counts.medium > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">
                {counts.medium} atenção
              </span>
            )}
          </div>
        )}
      </div>

      {alerts.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <CheckCircle2 className="h-4 w-4 text-success" />
          Nenhum alerta detectado nos indicadores principais.
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a, i) => (
            <li
              key={i}
              className={cn(
                "flex gap-3 rounded-md border px-3 py-2.5 text-sm",
                a.severity === "high"
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-amber-500/30 bg-amber-500/5",
              )}
            >
              {a.severity === "high" ? (
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="font-medium leading-tight">{a.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{a.description}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
