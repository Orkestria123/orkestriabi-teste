import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { IndicadoresClienteGrid } from "@/components/indicadores/indicadores-cliente";
import { useState } from "react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/indicadores")({
  component: Page,
});

type BaseAV = "rb" | "rl";

function Page() {
  const { companyId, company } = useDashboardCompany();
  const { periodos } = useFilters();
  const [baseAV, setBaseAV] = useState<BaseAV>("rl");

  const periodoLabel =
    periodos.length === 0
      ? "todos os períodos disponíveis"
      : periodos.length === 1
      ? periodos[0].slice(0, 7)
      : `${periodos[0].slice(0, 7)} a ${periodos[periodos.length - 1].slice(0, 7)}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Indicadores</h2>
          <p className="mt-1 text-sm text-muted-foreground">{periodoLabel}</p>
        </div>
        
        {/* Seletor global de base AV */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Base:</span>
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
            {[
              { value: "rb", label: "Sobre RB" },
              { value: "rl", label: "Sobre RL" },
            ].map((o) => (
              <button
                key={o.value}
                onClick={() => setBaseAV(o.value as BaseAV)}
                className={cn(
                  "px-3 h-7 text-xs font-medium rounded-md transition-colors",
                  baseAV === o.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <IndicadoresClienteGrid
        tenantId={company?.tenant_id ?? undefined}
        companyId={companyId ?? undefined}
        periodos={periodos}
        visibilidade={["indicadores", "ambos"]}
        baseAV={baseAV}
        emptyMessage="Nenhum indicador liberado para esta empresa. Fale com seu contador."
      />
    </div>
  );
}