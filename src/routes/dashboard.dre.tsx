import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useMonthlyStatement } from "@/hooks/use-financial-data";
import { StatementTable, type StatementRow } from "@/components/statement-table";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ExportMenu } from "@/components/export-menu";
import { VisaoBadge } from "@/components/visao-toggle";

function buildRows(data: any[]): { rows: StatementRow[]; periods: string[] } {
  const map = new Map<string, StatementRow>();
  const periodSet = new Set<string>();
  const hasComparativo = data.some((r) => r.valor_gerencial !== undefined);
  for (const r of data) {
    const identity = r.codigo_conta ?? `sub:${r.descricao}`;
    const key = `${r.linha_ordem}|${identity}`;
    if (!map.has(key)) {
      map.set(key, {
        descricao: r.descricao,
        codigo_conta: r.codigo_conta,
        nivel: r.nivel ?? 0,
        is_subtotal: r.is_subtotal ?? false,
        values: {},
        valuesGer: hasComparativo ? {} : undefined,
        linha_ordem: r.linha_ordem ?? 0,
      });
    }
    const row = map.get(key)!;
    row.values[r.periodo] = Number(r.valor) || 0;
    if (hasComparativo) {
      row.valuesGer![r.periodo] = Number(r.valor_gerencial) || 0;
    }
    periodSet.add(r.periodo);
  }
  return {
    rows: Array.from(map.values()).sort((a, b) => a.linha_ordem - b.linha_ordem),
    periods: Array.from(periodSet).sort(),
  };
}


export function makeStatementPage(tipo: string, title: string, avBase?: string, opts?: { categoryFilter?: boolean }) {
  return function Page() {
    const { companyId, company } = useDashboardCompany();
    const { periodos } = useFilters();
    const { data, isLoading } = useMonthlyStatement(companyId, tipo, periodos);
    // AV% da DRE: DUAS bases, um botão para cada.
    //
    // Antes era um botão só e ele acendia as duas colunas de uma vez —
    // três colunas por período, e sem escolha. "Sobre a Receita Bruta" e
    // "sobre a Receita Líquida" respondem perguntas diferentes; quem
    // está olhando decide qual quer.
    const [avRB, setAvRB] = useState(false);
    const [avRL, setAvRL] = useState(false);
    const showAV = avRB || avRL;
    const avSelecionadas = [
      avRB ? "AV% RB" : null,
      avRL ? "AV% RL" : null,
    ].filter((x): x is string => x != null);
    const [showAH, setShowAH] = useState(false);
    const [category, setCategory] = useState<"all" | "receita" | "despesa">("all");

    const { rows: allRows, periods: dataPeriods } = useMemo(() => buildRows(data ?? []), [data]);
    const periods = useMemo(() => {
      if (periodos.length === 0) return dataPeriods;
      const set = new Set(periodos);
      const filtered = dataPeriods.filter((p) => set.has(p));
      return filtered.length > 0 ? filtered : dataPeriods;
    }, [dataPeriods, periodos]);
    const basePeriod = periods[0];

    const rows = useMemo(() => {
      if (!opts?.categoryFilter || category === "all") return allRows;
      const receitaKw = /receita|venda|faturamento|outras receitas|reversão/i;
      const despesaKw = /despesa|custo|cmv|cpv|cusst|tribut|imposto|deduç|provis|perda|amortizaç|depreciaç|juros pass|financeira/i;
      return allRows.filter((r) => {
        const d = r.descricao ?? "";
        if (category === "receita") return receitaKw.test(d);
        return despesaKw.test(d);
      });
    }, [allRows, category]);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
            <VisaoBadge />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {opts?.categoryFilter && (
              <div className="inline-flex rounded-lg border border-border bg-card p-0.5 mr-1">
                {(["all", "receita", "despesa"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={
                      "px-3 h-7 text-xs font-medium rounded-md transition-colors " +
                      (category === c
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {c === "all" ? "Todos" : c === "receita" ? "Receitas" : "Despesas"}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground mr-0.5">AV%</span>
              <Button size="sm" variant={avRB ? "default" : "outline"}
                title="Análise vertical sobre a RECEITA BRUTA — cada linha como % do faturamento total"
                onClick={() => setAvRB((v) => !v)}>RB</Button>
              <Button size="sm" variant={avRL ? "default" : "outline"}
                title="Análise vertical sobre a RECEITA LÍQUIDA — cada linha como % da receita já sem as deduções"
                onClick={() => setAvRL((v) => !v)}>RL</Button>
            </div>
            <Button
            size="sm"
            variant={showAH ? "default" : "outline"}
            disabled={periods.length < 2}
            title={periods.length < 2
              ? "A análise horizontal compara períodos — selecione pelo menos dois meses no filtro."
              : "Variação por coluna (período anterior ou base fixa, selecionável na tabela)"}
            onClick={() => setShowAH((v) => !v)}
          >AH%</Button>
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
            showTotal
            basePeriod={basePeriod}
            avBaseCodigo={avBase}
            avSelecionadas={avSelecionadas}
            initialExpandLevel={1}
            variante={tipo === "DFC" ? "dfc" : "dre"}
            padraoMaxNivel={tipo === "DRE" ? 1 : undefined}
          />
        )}
      </div>
    );
  };
}

export const Route = createFileRoute("/dashboard/dre")({
  component: makeStatementPage("DRE", "Demonstração do Resultado (DRE)", "Receita Bruta", { categoryFilter: true }),
});
