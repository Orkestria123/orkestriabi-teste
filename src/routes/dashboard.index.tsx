import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useAvailablePeriods, useFinancialStatement, useMyCompanies } from "@/hooks/use-financial-data";
import { useAuth } from "@/hooks/use-auth";
import { useMemo } from "react";
import { InsightsCard } from "@/components/insights-card";
import { AlertsCard } from "@/components/alerts-card";
import { computeIndicators } from "@/lib/indicators";
import { IndicadoresClienteGrid } from "@/components/indicadores/indicadores-cliente";
import { DashboardKpisGrid } from "@/components/dashboard/dashboard-kpis";
import { DashboardCharts } from "@/components/dashboard/dashboard-charts";

export const Route = createFileRoute("/dashboard/")({ component: DashboardHome });

function DashboardHome() {
  const { companyId, company } = useDashboardCompany();
  const { loading: authLoading } = useAuth();
  const { isLoading: companiesLoading } = useMyCompanies();
  const { periodos } = useFilters();
  const { data: dre } = useFinancialStatement(companyId, "DRE", periodos);
  const { data: bp } = useFinancialStatement(companyId, "BP", periodos);

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

      <DashboardKpisGrid
        companyId={companyId}
        tenantId={company?.tenant_id}
        activePeriods={activePeriods}
      />

      <IndicadoresClienteGrid
        tenantId={company?.tenant_id ?? undefined}
        companyId={companyId ?? undefined}
        periodos={activePeriods}
        visibilidade={["dashboard", "ambos"]}
        compacto
        hideWhenEmpty
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <InsightsCard companyId={companyId} periodos={activePeriods} />
        <AlertsCard indicators={indicators} periodos={activePeriods} />
      </div>

      <DashboardCharts
        companyId={companyId}
        tenantId={company?.tenant_id}
        activePeriods={activePeriods}
      />
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
