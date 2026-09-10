import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useMonthlyStatement } from "@/hooks/use-financial-data";
import { StatementTable, type StatementRow } from "@/components/statement-table";
import { ExportMenu } from "@/components/export-menu";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import { VisaoBadge } from "@/components/visao-toggle";

function buildRows(data: any[]): StatementRow[] {
  const map = new Map<string, StatementRow>();
  const hasComparativo = data.some((r) => r.valor_gerencial !== undefined);
  for (const r of data) {
    const identity = r.codigo_conta ?? `sub:${r.descricao}`;
    const key = `${r.linha_ordem}|${identity}`;

    if (!map.has(key)) map.set(key, {
      descricao: r.descricao,
      codigo_conta: r.codigo_conta ?? null,
      nivel: r.nivel ?? 0,
      is_subtotal: r.is_subtotal ?? false,
      values: {},
      valuesGer: hasComparativo ? {} : undefined,
      linha_ordem: r.linha_ordem ?? 0,
    });
    const row = map.get(key)!;
    row.values[r.periodo] = Number(r.valor) || 0;
    if (hasComparativo) row.valuesGer![r.periodo] = Number(r.valor_gerencial) || 0;
  }
  return Array.from(map.values()).sort((a, b) => a.linha_ordem - b.linha_ordem);
}

export const Route = createFileRoute("/dashboard/balanco")({ component: Page });

function Page() {
  const { companyId, company } = useDashboardCompany();
  const { periodos } = useFilters();
  const [showAV, setShowAV] = useState(false);
  const [showAH, setShowAH] = useState(false);

  const { data: ativo } = useMonthlyStatement(companyId, "BP_ATIVO", periodos);
  const { data: passivo } = useMonthlyStatement(companyId, "BP_PASSIVO", periodos);
  const ativoRows = useMemo(() => buildRows(ativo ?? []), [ativo]);
  const passivoRows = useMemo(() => buildRows(passivo ?? []), [passivo]);
  const bpRows = useMemo(() => {
    const desloc = 1_000_000;
    return [
      ...ativoRows,
      ...passivoRows.map((r) => ({ ...r, linha_ordem: r.linha_ordem + desloc })),
    ];
  }, [ativoRows, passivoRows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-2xl font-semibold tracking-tight">Balanço Patrimonial</h2>
          <VisaoBadge />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant={showAV ? "default" : "outline"} onClick={() => setShowAV((v) => !v)}>AV%</Button>
          <Button
            size="sm"
            variant={showAH ? "default" : "outline"}
            disabled={periodos.length < 2}
            title={
              periodos.length < 2
                ? "A análise horizontal compara períodos — selecione pelo menos dois meses no filtro."
                : "Variação por coluna (período anterior ou base fixa, selecionável na tabela)"
            }
            onClick={() => setShowAH((v) => !v)}
          >AH%</Button>
          <ExportMenu
            rows={bpRows}
            periods={periodos}
            filename={`BP-${company?.name ?? "empresa"}`}
            title="Balanço Patrimonial"
            subtitle={company?.razao_social ?? company?.name}
          />
        </div>
      </div>

      <StatementTable
        rows={bpRows}
        periods={periodos}
        showAV={showAV}
        showAH={showAH}
        basePeriod={periodos[0]}
        avBaseCodigo="Total do Ativo"
        variante="bp"
        padraoMaxNivel={3}
        lados
      />
    </div>
  );
}
