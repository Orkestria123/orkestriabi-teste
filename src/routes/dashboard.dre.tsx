import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "./dashboard";
import { useFilters } from "@/components/filter-bar";
import { useFinancialStatement } from "@/hooks/use-financial-data";
import { StatementTable, type StatementRow } from "@/components/statement-table";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ExportMenu } from "@/components/export-menu";

function buildRows(data: any[]): StatementRow[] {
  const map = new Map<string, StatementRow>();
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
  }
  return Array.from(map.values()).sort((a, b) => a.linha_ordem - b.linha_ordem);
}

export function makeStatementPage(tipo: string, title: string, avBase?: string) {
  return function Page() {
    const { companyId, company } = useDashboardCompany();
    const { periodos } = useFilters();
    const { data, isLoading } = useFinancialStatement(companyId, tipo, periodos);
    const [showAV, setShowAV] = useState(false);
    const [showAH, setShowAH] = useState(false);

    const rows = useMemo(() => buildRows(data ?? []), [data]);
    const basePeriod = periodos[0];

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          <div className="flex gap-2">
            <Button size="sm" variant={showAV ? "default" : "outline"} onClick={() => setShowAV((v) => !v)}>AV%</Button>
            <Button size="sm" variant={showAH ? "default" : "outline"} onClick={() => setShowAH((v) => !v)}>AH%</Button>
            <ExportMenu
              rows={rows}
              periods={periodos}
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
            periods={periodos}
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
