import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useMonthlyStatement } from "@/hooks/use-financial-data";
import { makeStatementPage } from "./dashboard.dre";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/kpi-card";
import { ValidationBadge } from "@/components/validation-badge";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Cell, ReferenceLine, LabelList, LineChart, Line, PieChart, Pie,
} from "recharts";
import { formatBRLCompact, formatBRL, formatPct, periodoLabel } from "@/lib/format";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE, ANIMATION, CHART_COLORS } from "@/lib/chart-config";

const StatementPage = makeStatementPage("DLPA", "Demonstração de Lucros ou Prejuízos Acumulados");

function val(rows: any[], desc: string, periodo: string): number {
  return rows.find((r) => r.descricao === desc && r.periodo === periodo)?.valor ?? 0;
}

function DLPAContent() {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const { data: rows } = useMonthlyStatement(companyId, "DLPA", periodos);

  const blocks = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const periodosOrd = Array.from(new Set(rows.map((r: any) => r.periodo))).sort() as string[];
    const last = periodosOrd[periodosOrd.length - 1];

    const evolucao = periodosOrd.map((p) => ({
      label: periodoLabel(p),
      saldo: val(rows, "(=) Saldo Final de Lucros/Prejuízos Acumulados", p),
    }));

    const lucroLiq = val(rows, "(+) Lucro Líquido do Exercício", last) || val(rows, "(-) Prejuízo do Exercício", last);
    const reservaLegal = -val(rows, "(-) Reserva Legal (sugerida 5%)", last);
    const destinacoes = -val(rows, "(-) Destinações / Distribuições do Período", last);
    const saldoInicial = val(rows, "Saldo Inicial de Lucros/Prejuízos Acumulados", last);
    const saldoFinal = val(rows, "(=) Saldo Final de Lucros/Prejuízos Acumulados", last);
    const lucroRetido = Math.max(0, lucroLiq - reservaLegal - destinacoes);

    const validRow = rows.find((r: any) => r.periodo === last && /Saldo final/i.test(r.descricao ?? ""));
    const validado = (validRow?.descricao || "").startsWith("✓");

    return { periodosOrd, last, evolucao, lucroLiq, reservaLegal, destinacoes, saldoInicial, saldoFinal, lucroRetido, validado };
  }, [rows]);

  if (!blocks) {
    return <Card className="p-6 text-sm text-muted-foreground">Carregando DLPA…</Card>;
  }

  const { evolucao, lucroLiq, reservaLegal, destinacoes, saldoFinal, lucroRetido, validado, last } = blocks;
  const payout = lucroLiq > 0 ? (destinacoes / lucroLiq) * 100 : 0;
  const retencao = lucroLiq > 0 ? (lucroRetido / lucroLiq) * 100 : 0;

  // Waterfall: LL -> -Reserva -> -Dest -> Lucro Retido
  const afterRL = lucroLiq - reservaLegal;
  const afterDest = afterRL - destinacoes;
  const waterfall = [
    { name: "Lucro Líquido", base: 0, valor: lucroLiq, total: lucroLiq, kind: "total" },
    { name: "(-) Reserva Legal", base: Math.min(lucroLiq, afterRL), valor: Math.abs(reservaLegal), total: -reservaLegal, kind: "neg" },
    { name: "(-) Destinações", base: Math.min(afterRL, afterDest), valor: Math.abs(destinacoes), total: -destinacoes, kind: "neg" },
    { name: "Lucro Retido", base: 0, valor: lucroRetido, total: lucroRetido, kind: "total" },
  ];

  const pizza = [
    { name: "Retido", value: lucroRetido, color: CHART_COLORS[3] },
    { name: "Distribuído", value: destinacoes, color: CHART_COLORS[0] },
    { name: "Reservas", value: reservaLegal, color: CHART_COLORS[1] },
  ].filter((d) => d.value > 0);

  const insights = [
    payout > 0
      ? `Distribuído ${formatPct(payout, 1)} do lucro aos sócios (${formatBRL(destinacoes)}).`
      : `Todo o lucro foi retido para reinvestimento — fortalecendo o patrimônio.`,
    saldoFinal < 0
      ? `Prejuízos acumulados de ${formatBRL(Math.abs(saldoFinal))}. Distribuição vedada até a compensação.`
      : `Lucros acumulados de ${formatBRL(saldoFinal)} disponíveis para destinação futura.`,
    reservaLegal > 0
      ? `Reserva legal sugerida: ${formatBRL(reservaLegal)} (5% do lucro, limitada a 20% do capital).`
      : "",
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">Demonstração de Lucros/Prejuízos Acumulados</h2>
        <ValidationBadge ok={validado} label={validado ? "Saldo final reconciliado" : "Saldo final divergente"} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Lucro Líquido" value={lucroLiq} tone={lucroLiq >= 0 ? "positive" : "negative"} />
        <KpiCard label="Payout" value={payout} format="pct" hint="% distribuído" />
        <KpiCard label="Taxa de Retenção" value={retencao} format="pct" hint="% reinvestido" />
        <KpiCard label="Saldo Final" value={saldoFinal} tone={saldoFinal >= 0 ? "positive" : "negative"} />
      </div>

      <Card className="p-5">
        <h3 className="font-semibold mb-4">Cascata da Destinação do Lucro — {periodoLabel(last)}</h3>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={waterfall} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="name" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatBRLCompact(v)} width={72} />
              <Tooltip contentStyle={TOOLTIP_STYLE}
                formatter={(_v: any, _n: any, p: any) => [formatBRL(p?.payload?.total), p?.payload?.name]}
                labelFormatter={() => ""} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Bar dataKey="base" stackId="a" fill="transparent" />
              <Bar dataKey="valor" stackId="a" radius={[5, 5, 0, 0]} {...ANIMATION}>
                <LabelList dataKey="total" position="top" fontSize={11} formatter={(v: number) => formatBRLCompact(v)} fill="var(--foreground)" />
                {waterfall.map((d, i) => (
                  <Cell key={i} fill={
                    d.kind === "total" ? "var(--chart-1)" :
                    d.kind === "pos" ? "var(--success)" : "var(--destructive)"
                  } />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-semibold mb-4">Evolução dos Lucros Acumulados</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={evolucao}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatBRLCompact(v)} width={64} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => formatBRL(Number(v))} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Line type="monotone" dataKey="saldo" stroke="var(--chart-4)" strokeWidth={2.5}
                  dot={{ r: 4, fill: "var(--chart-4)", stroke: "var(--card)", strokeWidth: 2 }} {...ANIMATION} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold mb-4">Destinação do Resultado</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pizza} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={3}
                  label={({ percent }: any) => `${((percent as number) * 100).toFixed(0)}%`}>
                  {pizza.map((d, i) => <Cell key={i} fill={d.color} stroke="var(--card)" strokeWidth={3} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => formatBRL(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="font-semibold mb-3">💡 Leitura Automática</h3>
        <ul className="space-y-2 text-sm">
          {insights.map((i, idx) => (
            <li key={idx} className="rounded-md bg-muted/40 px-3 py-2 border border-border/40">{i}</li>
          ))}
        </ul>
      </Card>

      <StatementPage />
    </div>
  );
}

export const Route = createFileRoute("/dashboard/dlpa")({ component: DLPAContent });
