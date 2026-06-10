import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "./dashboard";
import { useFilters } from "@/components/filter-bar";
import { useFinancialStatement, useMyCompanies } from "@/hooks/use-financial-data";
import { useAuth } from "@/hooks/use-auth";
import { KpiCard } from "@/components/kpi-card";
import { Card } from "@/components/ui/card";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, CartesianGrid,
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
        <KpiCard label="Receita Bruta" value={kpis.receitaBruta.v} previousValue={kpis.receitaBruta.p} />
        <KpiCard label="Receita Líquida" value={kpis.receitaLiquida.v} previousValue={kpis.receitaLiquida.p} />
        <KpiCard label="EBITDA" value={kpis.ebitda.v} previousValue={kpis.ebitda.p} />
        <KpiCard label="Lucro Líquido" value={kpis.lucroLiquido.v} previousValue={kpis.lucroLiquido.p} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-semibold mb-4">Evolução de Receita vs Custos</h3>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.012 260)" />
                <XAxis dataKey="periodo" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => formatBRLCompact(v)} />
                <Tooltip formatter={(v: any) => formatBRLCompact(v)} />
                <Legend />
                <Bar dataKey="Receita" fill="oklch(0.54 0.20 277)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Custos" fill="oklch(0.60 0.22 25)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold mb-4">Evolução do Lucro Líquido</h3>
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.012 260)" />
                <XAxis dataKey="periodo" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => formatBRLCompact(v)} />
                <Tooltip formatter={(v: any) => formatBRLCompact(v)} />
                <Line type="monotone" dataKey="Lucro" stroke="oklch(0.65 0.18 150)" strokeWidth={2.5} dot={{ r: 3 }} />
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
