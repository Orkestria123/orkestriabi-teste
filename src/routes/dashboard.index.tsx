import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useAvailablePeriods, useFinancialStatement, useMyCompanies } from "@/hooks/use-financial-data";
import { useAuth } from "@/hooks/use-auth";

import { Card } from "@/components/ui/card";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, Legend, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, ReferenceLine, LabelList,
} from "recharts";
import { periodoLabel, formatBRLCompact, formatBRL } from "@/lib/format";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { InsightsCard } from "@/components/insights-card";
import { AlertsCard } from "@/components/alerts-card";
import { computeIndicators } from "@/lib/indicators";
import {
  AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE, ANIMATION,
  tooltipFormatBRL, tooltipFormatBRLCompact, CHART_COLORS,
} from "@/lib/chart-config";
import { IndicadoresClienteGrid } from "@/components/indicadores/indicadores-cliente";
import { DashboardKpisGrid } from "@/components/dashboard/dashboard-kpis";

export const Route = createFileRoute("/dashboard/")({ component: DashboardHome });

function findValue(rows: any[], descKeywords: string[], periodo: string): number | null {
  const row = rows.find(
    (r) => r.periodo === periodo && descKeywords.some((k) => r.descricao?.toLowerCase().includes(k)),
  );
  return row?.valor ?? null;
}

const RECEITA_KW = /receita|venda|faturamento/i;
const DESPESA_KW = /despesa|custo|cmv|cpv|tribut|imposto|deduç|amortizaç|depreciaç|juros pass/i;

type View = "geral" | "receitas" | "despesas";

function DashboardHome() {
  const { companyId, company } = useDashboardCompany();
  const { loading: authLoading } = useAuth();
  const { isLoading: companiesLoading } = useMyCompanies();
  const { periodos } = useFilters();
  const { data: dre } = useFinancialStatement(companyId, "DRE", periodos);
  const { data: bp } = useFinancialStatement(companyId, "BP", periodos);
  const [view, setView] = useState<View>("geral");

  const indicators = useMemo(() => {
    const rows = [
      ...((dre ?? []) as any[]).map((r) => ({ ...r, tipo_demonstracao: "DRE" })),
      ...((bp ?? []) as any[]).map((r) => ({ ...r, tipo_demonstracao: "BP" })),
    ];
    const ps = Array.from(new Set(rows.map((r) => r.periodo as string))).sort();
    return computeIndicators(rows as any, ps);
  }, [dre, bp]);

  const { data: availablePeriods } = useAvailablePeriods(companyId);
  const dataPeriods = useMemo(() => {
    const set = new Set<string>();
    (dre ?? []).forEach((r: any) => set.add(r.periodo));
    (availablePeriods ?? []).forEach((p) => set.add(p));
    return Array.from(set).sort();
  }, [dre, availablePeriods]);
  const activePeriods = useMemo(() => {
    if (periodos.length === 0) return dataPeriods;
    const filterSet = new Set(periodos);
    const filtered = dataPeriods.filter((p) => filterSet.has(p));
    return filtered.length > 0 ? filtered : dataPeriods;
  }, [dataPeriods, periodos]);

  const lastPeriod = activePeriods[activePeriods.length - 1];


  const chartData = useMemo(() => {
    return activePeriods.map((p) => {
      const lucro = findValue(dre ?? [], ["lucro líquido", "lucro liquido"], p) ?? 0;
      return {
        periodo: periodoLabel(p),
        Receita: findValue(dre ?? [], ["receita líquida", "receita liquida", "receita bruta"], p) ?? 0,
        Custos: Math.abs(findValue(dre ?? [], ["custo", "cmv"], p) ?? 0),
        Lucro: lucro,
        LucroPos: lucro >= 0 ? lucro : 0,
        LucroNeg: lucro < 0 ? lucro : 0,
      };
    });
  }, [dre, activePeriods]);

  // Breakdown rows for Receitas / Despesas: pick analytic rows (not subtotals) that match the keyword
  const breakdown = useMemo(() => {
    const rows = (dre ?? []) as any[];
    const seenByPeriod = new Map<string, Map<string, number>>();
    const labelSet = new Set<string>();
    const re = view === "receitas" ? RECEITA_KW : DESPESA_KW;
    rows.forEach((r) => {
      if (r.is_subtotal) return;
      if (!re.test(r.descricao ?? "")) return;
      if (!activePeriods.includes(r.periodo)) return;
      const label = r.descricao as string;
      labelSet.add(label);
      if (!seenByPeriod.has(r.periodo)) seenByPeriod.set(r.periodo, new Map());
      const m = seenByPeriod.get(r.periodo)!;
      m.set(label, (m.get(label) ?? 0) + Math.abs(Number(r.valor) || 0));
    });
    // Limit to top N labels by total
    const totals = new Map<string, number>();
    labelSet.forEach((l) => {
      let t = 0;
      seenByPeriod.forEach((m) => { t += m.get(l) ?? 0; });
      totals.set(l, t);
    });
    const topLabels = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([l]) => l);
    const stacked = activePeriods.map((p) => {
      const row: any = { periodo: periodoLabel(p) };
      topLabels.forEach((l) => { row[l] = seenByPeriod.get(p)?.get(l) ?? 0; });
      return row;
    });
    const donut = topLabels.map((l) => ({
      name: l,
      value: seenByPeriod.get(lastPeriod)?.get(l) ?? 0,
    })).filter((d) => d.value > 0);
    return { stacked, labels: topLabels, donut };
  }, [dre, activePeriods, lastPeriod, view]);

  if (!companyId) {
    if (authLoading || companiesLoading) {
      return (
        <div className="flex items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      );
    }
    return <EmptyState text="Nenhuma empresa selecionada." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Visão geral</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {company?.razao_social ?? company?.name} {company?.cnpj && `· CNPJ ${company.cnpj}`}
          </p>
        </div>
        <ViewSwitcher value={view} onChange={setView} />
      </div>

      <DashboardKpisGrid companyId={companyId} activePeriods={activePeriods} />

      {view === "geral" && (
        <IndicadoresClienteGrid
          tenantId={company?.tenant_id ?? undefined}
          companyId={companyId ?? undefined}
          periodos={activePeriods}
          visibilidade={["dashboard", "ambos"]}
          compacto
          hideWhenEmpty
        />
      )}

      {view === "geral" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InsightsCard companyId={companyId} periodos={activePeriods} />
          <AlertsCard indicators={indicators} periodos={activePeriods} />
        </div>
      )}

      {view === "geral" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-5 shadow-[var(--shadow-soft)]">
            <h3 className="font-semibold mb-1">Receita vs Custos</h3>
            <p className="text-xs text-muted-foreground mb-4">Evolução nos períodos selecionados</p>
            <div className="h-72">
              <ResponsiveContainer>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gReceita" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.18} />
                      <stop offset="85%" stopColor="var(--chart-2)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="periodo" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatBRLCompact(v)} width={72} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatBRLCompact} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 16 }} iconType="circle" iconSize={8} />
                  <Area
                    type="monotone"
                    dataKey="Receita"
                    stroke="var(--chart-2)"
                    strokeWidth={2.5}
                    fill="url(#gReceita)"
                    dot={{ r: 3.5, fill: "var(--chart-2)", strokeWidth: 2, stroke: "var(--card)" }}
                    activeDot={{ r: 6, fill: "var(--chart-2)", stroke: "var(--card)", strokeWidth: 2 }}
                    {...ANIMATION}
                  />
                  <Area
                    type="monotone"
                    dataKey="Custos"
                    stroke="var(--chart-5)"
                    strokeWidth={1.8}
                    strokeDasharray="5 3"
                    fill="transparent"
                    dot={{ r: 3, fill: "var(--chart-5)", strokeWidth: 1.5, stroke: "var(--card)" }}
                    activeDot={{ r: 5 }}
                    {...ANIMATION}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-5 shadow-[var(--shadow-soft)]">
            <h3 className="font-semibold mb-1">Evolução do Resultado</h3>
            <p className="text-xs text-muted-foreground mb-4">Lucro líquido do exercício por período</p>

            <div className="h-72">
              <ResponsiveContainer>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gLucroPos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--success)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gLucroNeg" x1="0" y1="1" x2="0" y2="0">
                      <stop offset="0%" stopColor="var(--destructive)" stopOpacity={0.20} />
                      <stop offset="100%" stopColor="var(--destructive)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="periodo" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatBRLCompact(v)} width={72} />
                  <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [formatBRL(Number(v)), "Lucro Líquido"]} />
                  <Area type="monotone" dataKey="LucroPos" stroke="transparent" fill="url(#gLucroPos)" {...ANIMATION} />
                  <Area type="monotone" dataKey="LucroNeg" stroke="transparent" fill="url(#gLucroNeg)" {...ANIMATION} />
                  <Line
                    type="monotone"
                    dataKey="Lucro"
                    stroke={(chartData[chartData.length - 1]?.Lucro ?? 0) >= 0 ? "var(--success)" : "var(--destructive)"}
                    strokeWidth={2.5}

                    dot={(props: any) => {
                      const { cx, cy, value, index } = props;
                      const color = (value ?? 0) >= 0 ? "var(--success)" : "var(--destructive)";
                      return <circle key={index} cx={cx} cy={cy} r={4} fill={color} stroke="var(--card)" strokeWidth={2} />;
                    }}
                    activeDot={{ r: 6, stroke: "var(--card)", strokeWidth: 2 }}
                    {...ANIMATION}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {(view === "receitas" || view === "despesas") && (
        <>
          <SectionLabel
            color={view === "receitas" ? "var(--chart-2)" : "var(--chart-5)"}
            text={view === "receitas" ? "Receitas — composição e evolução" : "Despesas — composição e evolução"}
          />
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <Card className="p-5 shadow-[var(--shadow-soft)] lg:col-span-3">
              <h3 className="font-semibold mb-1">
                {view === "receitas" ? "Receitas por Categoria" : "Despesas por Categoria"} — Histórico
              </h3>
              <p className="text-xs text-muted-foreground mb-4">Top 3 categorias por período (R$)</p>
              <div className="h-80">
                <ResponsiveContainer>
                  <BarChart data={breakdown.stacked} margin={{ top: 16, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%" barGap={3}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="periodo" {...AXIS_PROPS} />
                    <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatBRLCompact(v)} width={72} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatBRL} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} iconType="square" iconSize={10} />
                    {breakdown.labels.slice(0, 3).map((l, i) => (
                      <Bar key={l} dataKey={l} fill={CHART_COLORS[i]} radius={[5, 5, 0, 0]} {...ANIMATION}>
                        <LabelList dataKey={l} position="top" fontSize={10} formatter={(v: number) => v > 0 ? formatBRLCompact(v) : ""} />
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-5 shadow-[var(--shadow-soft)] lg:col-span-2">
              <h3 className="font-semibold mb-1">
                Distribuição {view === "receitas" ? "Receitas" : "Despesas"} — {lastPeriod ? periodoLabel(lastPeriod) : ""}
              </h3>
              <p className="text-xs text-muted-foreground mb-4">Participação no último período</p>
              <div className="h-80">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={breakdown.donut}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={70}
                      outerRadius={105}
                      paddingAngle={3}
                      startAngle={90}
                      endAngle={-270}
                      label={({ percent }) => `${((percent ?? 0) * 100).toFixed(0)}%`}
                      labelLine={{ stroke: "var(--border)", strokeWidth: 1 }}
                      {...ANIMATION}
                    >
                      {breakdown.donut.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="var(--card)" strokeWidth={3} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatBRL} />
                    <Legend
                      layout="horizontal"
                      verticalAlign="bottom"
                      align="center"
                      wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                      iconType="circle"
                      iconSize={8}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function SectionLabel({ color, text }: { color: string; text: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/60 pb-2">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium">{text}</span>
    </div>
  );
}

function ViewSwitcher({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const opts: { id: View; label: string }[] = [
    { id: "geral", label: "Visão Geral" },
    { id: "receitas", label: "Receitas" },
    { id: "despesas", label: "Despesas" },
  ];
  return (
    <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shadow-sm">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "px-3.5 h-8 text-xs font-medium rounded-md transition-colors",
            value === o.id
              ? "bg-primary text-primary-foreground shadow"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
