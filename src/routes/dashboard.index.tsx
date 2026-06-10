import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useFinancialStatement, useMyCompanies } from "@/hooks/use-financial-data";
import { useAuth } from "@/hooks/use-auth";
import { KpiCard } from "@/components/kpi-card";
import { Card } from "@/components/ui/card";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, Legend, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";
import { periodoLabel, formatBRLCompact, formatBRL } from "@/lib/format";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { InsightsCard } from "@/components/insights-card";
import { AlertsCard } from "@/components/alerts-card";
import { computeIndicators } from "@/lib/indicators";

export const Route = createFileRoute("/dashboard/")({ component: DashboardHome });

function findValue(rows: any[], descKeywords: string[], periodo: string): number | null {
  const row = rows.find(
    (r) => r.periodo === periodo && descKeywords.some((k) => r.descricao?.toLowerCase().includes(k)),
  );
  return row?.valor ?? null;
}

const RECEITA_KW = /receita|venda|faturamento/i;
const DESPESA_KW = /despesa|custo|cmv|cpv|tribut|imposto|deduç|amortizaç|depreciaç|juros pass/i;

const CHART_COLORS = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f59e0b", "#64748b",
];

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

  const dataPeriods = useMemo(() => {
    const set = new Set<string>();
    (dre ?? []).forEach((r: any) => set.add(r.periodo));
    return Array.from(set).sort();
  }, [dre]);
  const activePeriods = useMemo(() => {
    if (periodos.length === 0) return dataPeriods;
    const filterSet = new Set(periodos);
    const filtered = dataPeriods.filter((p) => filterSet.has(p));
    return filtered.length > 0 ? filtered : dataPeriods;
  }, [dataPeriods, periodos]);

  const lastPeriod = activePeriods[activePeriods.length - 1];
  const prevPeriod = activePeriods[activePeriods.length - 2];

  const kpis = useMemo(() => {
    const rows = dre ?? [];
    return {
      receitaBruta: { v: findValue(rows, ["receita bruta", "receita operacional bruta"], lastPeriod), p: findValue(rows, ["receita bruta", "receita operacional bruta"], prevPeriod) },
      receitaLiquida: { v: findValue(rows, ["receita líquida", "receita liquida"], lastPeriod), p: findValue(rows, ["receita líquida", "receita liquida"], prevPeriod) },
      ebitda: { v: findValue(rows, ["ebitda", "lajida"], lastPeriod), p: findValue(rows, ["ebitda", "lajida"], prevPeriod) },
      lucroLiquido: { v: findValue(rows, ["lucro líquido", "lucro liquido", "resultado líquido"], lastPeriod), p: findValue(rows, ["lucro líquido", "lucro liquido", "resultado líquido"], prevPeriod) },
    };
  }, [dre, lastPeriod, prevPeriod]);

  const chartData = useMemo(() => {
    return activePeriods.map((p) => ({
      periodo: periodoLabel(p),
      Receita: findValue(dre ?? [], ["receita líquida", "receita liquida", "receita bruta"], p) ?? 0,
      Custos: Math.abs(findValue(dre ?? [], ["custo", "cmv"], p) ?? 0),
      Lucro: findValue(dre ?? [], ["lucro líquido", "lucro liquido"], p) ?? 0,
    }));
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Receita Bruta" value={kpis.receitaBruta.v} previousValue={kpis.receitaBruta.p} tone="default" sparkline={chartData.map((d) => d.Receita)} />
        <KpiCard label="Receita Líquida" value={kpis.receitaLiquida.v} previousValue={kpis.receitaLiquida.p} tone="default" sparkline={chartData.map((d) => d.Receita)} />
        <KpiCard label="EBITDA" value={kpis.ebitda.v} previousValue={kpis.ebitda.p} tone="positive" sparkline={chartData.map((d) => d.Lucro)} />
        <KpiCard label="Lucro Líquido" value={kpis.lucroLiquido.v} previousValue={kpis.lucroLiquido.p} tone={(kpis.lucroLiquido.v ?? 0) < 0 ? "negative" : "positive"} sparkline={chartData.map((d) => d.Lucro)} />
      </div>

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
                      <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gCustos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-5)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--chart-5)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="periodo" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => formatBRLCompact(v)} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} formatter={(v: any) => formatBRLCompact(v)} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Area type="monotone" dataKey="Receita" stroke="var(--chart-2)" strokeWidth={2.5} fill="url(#gReceita)" />
                  <Area type="monotone" dataKey="Custos" stroke="var(--chart-5)" strokeWidth={2} fill="url(#gCustos)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-5 shadow-[var(--shadow-soft)]">
            <h3 className="font-semibold mb-1">Lucro Líquido</h3>
            <p className="text-xs text-muted-foreground mb-4">Tendência do resultado do exercício</p>
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="periodo" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => formatBRLCompact(v)} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} formatter={(v: any) => formatBRLCompact(v)} />
                  <Line type="monotone" dataKey="Lucro" stroke="var(--chart-4)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--chart-4)" }} activeDot={{ r: 5 }} />
                </LineChart>
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
              <p className="text-xs text-muted-foreground mb-4">Composição empilhada (R$)</p>
              <div className="h-80">
                <ResponsiveContainer>
                  <BarChart data={breakdown.stacked} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="periodo" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => formatBRLCompact(v)} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} formatter={(v: any) => formatBRL(v)} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    {breakdown.labels.map((l, i) => (
                      <Bar key={l} dataKey={l} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} radius={i === breakdown.labels.length - 1 ? [4, 4, 0, 0] : 0} />
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
                    <Pie data={breakdown.donut} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
                      {breakdown.donut.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="var(--card)" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} formatter={(v: any) => formatBRL(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} layout="vertical" align="right" verticalAlign="middle" />
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
