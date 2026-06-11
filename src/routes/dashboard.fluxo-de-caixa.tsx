import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useFinancialStatement } from "@/hooks/use-financial-data";
import { makeStatementPage } from "./dashboard.dre";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Cell, ReferenceLine, LabelList,
} from "recharts";
import { formatBRLCompact, formatBRL, periodoLabel } from "@/lib/format";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE, ANIMATION } from "@/lib/chart-config";

const StatementPage = makeStatementPage("DFC", "Demonstração do Fluxo de Caixa");

function findSum(rows: any[], periodo: string, keywords: string[]): number {
  const ks = keywords.map((k) => k.toLowerCase());
  return rows
    .filter((r) => r.periodo === periodo && r.is_subtotal)
    .filter((r) => ks.some((k) => r.descricao?.toLowerCase().includes(k)))
    .reduce((acc, r) => acc + (Number(r.valor) || 0), 0);
}

function DFCExtras() {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const { data } = useFinancialStatement(companyId, "DFC", periodos);
  const lastPeriod = periodos[periodos.length - 1];

  const blocks = useMemo(() => {
    if (!data || !lastPeriod) return null;
    const op = findSum(data, lastPeriod, ["atividades operacionais", "operacional"]);
    const inv = findSum(data, lastPeriod, ["atividades de investimento", "investimento"]);
    const fin = findSum(data, lastPeriod, ["atividades de financiamento", "financiamento"]);
    const caixaIni = findSum(data, lastPeriod, ["caixa no in", "saldo inicial de caixa"]);
    const variacao = op + inv + fin;
    const caixaFim = caixaIni + variacao;
    return { op, inv, fin, caixaIni, caixaFim, variacao };
  }, [data, lastPeriod]);

  if (!blocks) return null;

  // Waterfall data: cada barra mostra base+delta
  const waterfall = [
    { name: "Caixa Inicial", base: 0, valor: blocks.caixaIni, total: blocks.caixaIni, kind: "total" },
    { name: "Operacional", base: Math.min(blocks.caixaIni, blocks.caixaIni + blocks.op), valor: Math.abs(blocks.op), total: blocks.op, kind: blocks.op >= 0 ? "pos" : "neg" },
    { name: "Investimento", base: Math.min(blocks.caixaIni + blocks.op, blocks.caixaIni + blocks.op + blocks.inv), valor: Math.abs(blocks.inv), total: blocks.inv, kind: blocks.inv >= 0 ? "pos" : "neg" },
    { name: "Financiamento", base: Math.min(blocks.caixaIni + blocks.op + blocks.inv, blocks.caixaFim), valor: Math.abs(blocks.fin), total: blocks.fin, kind: blocks.fin >= 0 ? "pos" : "neg" },
    { name: "Caixa Final", base: 0, valor: blocks.caixaFim, total: blocks.caixaFim, kind: "total" },
  ];

  // Semáforo
  const semaforo =
    blocks.op > 0 && blocks.inv < 0
      ? { cor: "bg-blue-500", label: "Expansão saudável — gerando caixa e investindo" }
      : blocks.op > 0
        ? { cor: "bg-emerald-500", label: "Geração de caixa operacional positiva" }
        : { cor: "bg-red-500", label: "Atenção: caixa operacional negativo" };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="p-5 lg:col-span-2">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Cascata do Fluxo de Caixa — {periodoLabel(lastPeriod)}</h3>
          <Badge variant="secondary">{periodoLabel(lastPeriod)}</Badge>
        </div>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={waterfall} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.012 260)" />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => formatBRLCompact(v)} />
              <Tooltip
                formatter={(_v: any, _n: any, p: any) => [formatBRL(p?.payload?.total), p?.payload?.name]}
                labelFormatter={() => ""}
              />
              <ReferenceLine y={0} stroke="oklch(0.6 0.01 260)" />
              <Bar dataKey="base" stackId="a" fill="transparent" />
              <Bar dataKey="valor" stackId="a" radius={[4, 4, 0, 0]}>
                {waterfall.map((d, i) => (
                  <Cell
                    key={i}
                    fill={
                      d.kind === "total"
                        ? "oklch(0.54 0.20 277)"
                        : d.kind === "pos"
                          ? "oklch(0.65 0.18 150)"
                          : "oklch(0.62 0.22 25)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h3 className="font-semibold">Saúde do Caixa</h3>
        <div className="flex items-center gap-3">
          <div className={`h-4 w-4 rounded-full ${semaforo.cor}`} />
          <span className="text-sm">{semaforo.label}</span>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt>Operacional</dt><dd className={blocks.op >= 0 ? "text-emerald-600" : "text-red-600"}>{formatBRL(blocks.op)}</dd></div>
          <div className="flex justify-between"><dt>Investimento</dt><dd className={blocks.inv >= 0 ? "text-emerald-600" : "text-red-600"}>{formatBRL(blocks.inv)}</dd></div>
          <div className="flex justify-between"><dt>Financiamento</dt><dd className={blocks.fin >= 0 ? "text-emerald-600" : "text-red-600"}>{formatBRL(blocks.fin)}</dd></div>
          <div className="flex justify-between font-semibold border-t pt-2"><dt>Variação Líquida</dt><dd>{formatBRL(blocks.variacao)}</dd></div>
        </dl>
      </Card>
    </div>
  );
}

function DFCPage() {
  return (
    <div className="space-y-6">
      <DFCExtras />
      <StatementPage />
    </div>
  );
}

export const Route = createFileRoute("/dashboard/fluxo-de-caixa")({ component: DFCPage });
