import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { IndicadoresClienteGrid } from "@/components/indicadores/indicadores-cliente";

export const Route = createFileRoute("/dashboard/indicadores")({
  component: Page,
});

function Page() {
  const { companyId, company } = useDashboardCompany();
  const { periodos } = useFilters();

  const periodoLabel =
    periodos.length === 0
      ? "todos os períodos disponíveis"
      : periodos.length === 1
      ? periodos[0].slice(0, 7)
      : `${periodos[0].slice(0, 7)} a ${periodos[periodos.length - 1].slice(0, 7)}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Indicadores</h2>
        <p className="mt-1 text-sm text-muted-foreground">{periodoLabel}</p>
      </div>

      <IndicadoresClienteGrid
        tenantId={company?.tenant_id ?? undefined}
        companyId={companyId ?? undefined}
        periodos={periodos}
        visibilidade={["indicadores", "ambos"]}
        emptyMessage="Nenhum indicador liberado para esta empresa. Fale com seu contador."
      />
    </div>
  );
}
