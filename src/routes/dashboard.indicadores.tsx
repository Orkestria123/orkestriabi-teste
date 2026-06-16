import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useMonthlyStatement } from "@/hooks/use-financial-data";
import {
  computeIndicadoresCompletos,
  type IndicadorCompleto,
  type Categoria,
  type FlatRow,
} from "@/lib/indicators";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { IndicatorCard } from "@/components/indicators/indicator-card";
import { IndicatorDrilldown } from "@/components/indicators/indicator-drilldown";
import { SaudeGeralPanel } from "@/components/indicators/saude-geral-panel";

export const Route = createFileRoute("/dashboard/indicadores")({
  component: Page,
});

const CATEGORIAS: Categoria[] = [
  "Liquidez",
  "Endividamento",
  "Rentabilidade",
  "Atividade",
];

function Page() {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const { data: dre, isLoading: l1 } = useMonthlyStatement(
    companyId,
    "DRE",
    periodos,
  );
  const { data: bpA, isLoading: l2 } = useMonthlyStatement(
    companyId,
    "BP_ATIVO",
    periodos,
  );
  const { data: bpP, isLoading: l3 } = useMonthlyStatement(
    companyId,
    "BP_PASSIVO",
    periodos,
  );
  const isLoading = l1 || l2 || l3;

  const [drill, setDrill] = useState<IndicadorCompleto | null>(null);
  const [modo, setModo] = useState<"empresario" | "contador">("empresario");

  const indicadores = useMemo(
    () =>
      computeIndicadoresCompletos(
        (dre ?? []) as FlatRow[],
        (bpA ?? []) as FlatRow[],
        (bpP ?? []) as FlatRow[],
        periodos,
      ),
    [dre, bpA, bpP, periodos],
  );

  const periodoLabel =
    periodos.length === 0
      ? "—"
      : periodos.length === 1
      ? periodos[0].slice(0, 7)
      : `${periodos[0].slice(0, 7)} a ${periodos[periodos.length - 1].slice(0, 7)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Indicadores</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {periodoLabel} · calculado a partir da DRE e do Balanço Patrimonial
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {(["empresario", "contador"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setModo(m)}
              className={cn(
                "h-7 rounded-md px-3 text-xs font-medium transition-colors",
                modo === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "empresario" ? "Visão Empresário" : "Visão Contador"}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground">Calculando…</div>
      )}

      {!isLoading && modo === "empresario" && indicadores.length > 0 && (
        <SaudeGeralPanel indicadores={indicadores} />
      )}

      {CATEGORIAS.map((cat) => {
        const items = indicadores.filter((i) => i.categoria === cat);
        if (items.length === 0) return null;
        const conta = {
          otimo: items.filter((i) => i.faixa === "otimo").length,
          atencao: items.filter((i) => i.faixa === "atencao").length,
          critico: items.filter((i) => i.faixa === "critico").length,
        };
        return (
          <section key={cat}>
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {cat}
              </h3>
              <span className="text-[10px] text-muted-foreground">
                {conta.otimo > 0 && (
                  <span className="text-success">{conta.otimo} ótimo(s)</span>
                )}
                {conta.atencao > 0 && (
                  <>
                    {conta.otimo > 0 && " · "}
                    <span className="text-warning">
                      {conta.atencao} atenção
                    </span>
                  </>
                )}
                {conta.critico > 0 && (
                  <>
                    {(conta.otimo > 0 || conta.atencao > 0) && " · "}
                    <span className="text-destructive">
                      {conta.critico} crítico(s)
                    </span>
                  </>
                )}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((ind) => (
                <IndicatorCard
                  key={ind.key}
                  ind={ind}
                  modoTecnico={modo === "contador"}
                  onClick={() => setDrill(ind)}
                />
              ))}
            </div>
          </section>
        );
      })}

      <IndicatorDrilldown ind={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
