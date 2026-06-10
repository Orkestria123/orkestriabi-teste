import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useFinancialStatement } from "@/hooks/use-financial-data";
import { StatementTable, type StatementRow } from "@/components/statement-table";
import { ExportMenu } from "@/components/export-menu";
import { useMemo } from "react";

function buildRows(data: any[]): StatementRow[] {
  const map = new Map<string, StatementRow>();
  for (const r of data) {
    const key = `${r.linha_ordem}-${r.descricao}`;
    if (!map.has(key)) map.set(key, {
      descricao: r.descricao,
      codigo_conta: r.codigo_conta,
      nivel: r.nivel ?? 0,
      is_subtotal: r.is_subtotal ?? false,
      values: {},
      linha_ordem: r.linha_ordem ?? 0,
    });
    map.get(key)!.values[r.periodo] = Number(r.valor) || 0;
  }
  return Array.from(map.values()).sort((a, b) => a.linha_ordem - b.linha_ordem);
}

export const Route = createFileRoute("/dashboard/balanco")({ component: Page });

function Page() {
  const { companyId, company } = useDashboardCompany();
  const { periodos } = useFilters();
  const { data: ativo } = useFinancialStatement(companyId, "BP_ATIVO", periodos);
  const { data: passivo } = useFinancialStatement(companyId, "BP_PASSIVO", periodos);
  const ativoRows = useMemo(() => buildRows(ativo ?? []), [ativo]);
  const passivoRows = useMemo(() => buildRows(passivo ?? []), [passivo]);
  const allRows = useMemo(() => [...ativoRows, ...passivoRows], [ativoRows, passivoRows]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">Balanço Patrimonial</h2>
        <ExportMenu
          rows={allRows}
          periods={periodos}
          filename={`BP-${company?.name ?? "empresa"}`}
          title="Balanço Patrimonial"
          subtitle={company?.razao_social ?? company?.name}
        />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div>
          <h3 className="font-medium mb-2 text-sm uppercase tracking-wider text-muted-foreground">Ativo</h3>
          <StatementTable rows={ativoRows} periods={periodos} showAV avBaseCodigo="Total do Ativo" />
        </div>
        <div>
          <h3 className="font-medium mb-2 text-sm uppercase tracking-wider text-muted-foreground">Passivo + PL</h3>
          <StatementTable rows={passivoRows} periods={periodos} showAV avBaseCodigo="Total do Passivo" />
        </div>
      </div>
    </div>
  );
}
