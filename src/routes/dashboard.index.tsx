import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useMyCompanies } from "@/hooks/use-financial-data";
import { useAuth } from "@/hooks/use-auth";
import { InsightsCard } from "@/components/insights-card";
import { TabelaIndices } from "@/components/dashboard/tabela-indices";

export const Route = createFileRoute("/dashboard/")({ component: DashboardHome });

function DashboardHome() {
  const { companyId, company } = useDashboardCompany();
  const { loading: authLoading } = useAuth();
  const { isLoading: companiesLoading } = useMyCompanies();
  const { periodos } = useFilters();

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

      <TabelaIndices
        tenantId={company?.tenant_id}
        companyId={companyId}
        periodos={periodos}
      />

      <InsightsCard companyId={companyId} periodos={periodos} />
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
