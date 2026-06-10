import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useFinancialStatement, useMyCompanies } from "@/hooks/use-financial-data";
import { useAuth } from "@/hooks/use-auth";
import { KpiCard } from "@/components/kpi-card";
import { Card } from "@/components/ui/card";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, Legend, CartesianGrid,
} from "recharts";
import { periodoLabel, formatBRLCompact } from "@/lib/format";
import { useMemo } from "react";

export const Route = createFileRoute("/dashboard/")({ component: DashboardHome });

function findValue(rows: any[], descKeywords: string[], periodo: string): number | null {
  const row = rows.find(
    (r) => r.periodo === periodo && descKeywords.some((k) => r.descricao?.toLowerCase().includes(k)),
  );
  return row?.valor ?? null;
}

function DashboardHome() {
  const { companyId, company } = useDashboardCompany();
  const { loading: authLoading } = useAuth();
  const { isLoading: companiesLoading } = useMyCompanies();
  const { periodos } = useFilters();
  const { data: dre } = useFinancialStatement(companyId, "DRE", periodos);

  // Derive actual periods from the returned data, intersected with the user's
  // year selection. Avoids mismatch when filter holds month-level placeholder
  // dates but the DB stores period end-of-year dates from SPED.
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
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Visão geral</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {company?.razao_social ?? company?.name} {company?.cnpj && `· CNPJ ${company.cnpj}`}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Receita Bruta" value={kpis.receitaBruta.v} previousValue={kpis.receitaBruta.p} tone="default" sparkline={chartData.map((d) => d.Receita)} />
        <KpiCard label="Receita Líquida" value={kpis.receitaLiquida.v} previousValue={kpis.receitaLiquida.p} tone="default" sparkline={chartData.map((d) => d.Receita)} />
        <KpiCard label="EBITDA" value={kpis.ebitda.v} previousValue={kpis.ebitda.p} tone="positive" sparkline={chartData.map((d) => d.Lucro)} />
        <KpiCard label="Lucro Líquido" value={kpis.lucroLiquido.v} previousValue={kpis.lucroLiquido.p} tone={(kpis.lucroLiquido.v ?? 0) < 0 ? "negative" : "positive"} sparkline={chartData.map((d) => d.Lucro)} />
      </div>

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
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
                  formatter={(v: any) => formatBRLCompact(v)}
                />
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
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
                  formatter={(v: any) => formatBRLCompact(v)}
                />
                <Line type="monotone" dataKey="Lucro" stroke="var(--chart-4)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--chart-4)" }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
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
