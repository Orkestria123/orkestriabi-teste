import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useFinancialStatement } from "@/hooks/use-financial-data";
import { StatementTable, type StatementRow } from "@/components/statement-table";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ExportMenu } from "@/components/export-menu";

function buildRows(data: any[]): { rows: StatementRow[]; periods: string[] } {
  const map = new Map<string, StatementRow>();
  const periodSet = new Set<string>();
  for (const r of data) {
    const key = `${r.linha_ordem}-${r.descricao}`;
    if (!map.has(key)) {
      map.set(key, {
        descricao: r.descricao,
        codigo_conta: r.codigo_conta,
        nivel: r.nivel ?? 0,
        is_subtotal: r.is_subtotal ?? false,
        values: {},
        linha_ordem: r.linha_ordem ?? 0,
      });
    }
    map.get(key)!.values[r.periodo] = Number(r.valor) || 0;
    periodSet.add(r.periodo);
  }
  return {
    rows: Array.from(map.values()).sort((a, b) => a.linha_ordem - b.linha_ordem),
    periods: Array.from(periodSet).sort(),
  };
}

export function makeStatementPage(tipo: string, title: string, avBase?: string) {
  return function Page() {
    const { companyId, company } = useDashboardCompany();
    const { periodos } = useFilters();
    const { data, isLoading } = useFinancialStatement(companyId, tipo, periodos);
    const [showAV, setShowAV] = useState(false);
    const [showAH, setShowAH] = useState(false);

    const { rows, periods: dataPeriods } = useMemo(() => buildRows(data ?? []), [data]);
    // If the filter context already knows which periodos are available, intersect
    // so the user's year selection still narrows columns. Otherwise show whatever
    // the data returned (typical first render before PeriodSync resolves).
    const periods = useMemo(() => {
      if (periodos.length === 0) return dataPeriods;
      const set = new Set(periodos);
      const filtered = dataPeriods.filter((p) => set.has(p));
      return filtered.length > 0 ? filtered : dataPeriods;
    }, [dataPeriods, periodos]);
    const basePeriod = periods[0];

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          <div className="flex gap-2">
            <Button size="sm" variant={showAV ? "default" : "outline"} onClick={() => setShowAV((v) => !v)}>AV%</Button>
            <Button size="sm" variant={showAH ? "default" : "outline"} onClick={() => setShowAH((v) => !v)}>AH%</Button>
            <ExportMenu
              rows={rows}
              periods={periods}
              filename={`${tipo}-${company?.name ?? "empresa"}`}
              title={title}
              subtitle={company?.razao_social ?? company?.name}
            />
          </div>
        </div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <StatementTable
            rows={rows}
            periods={periods}
            showAV={showAV}
            showAH={showAH}
            basePeriod={basePeriod}
            avBaseCodigo={avBase}
          />
        )}
      </div>
    );
  };
}

export const Route = createFileRoute("/dashboard/dre")({
  component: makeStatementPage("DRE", "Demonstração do Resultado (DRE)", "Receita Bruta"),
});
