import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useDashboardCompany } from "./dashboard";
import { useFilters } from "@/components/filter-bar";
import { useFinancialStatement } from "@/hooks/use-financial-data";
import { makeStatementPage } from "./dashboard.dre";
import { Card } from "@/components/ui/card";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
} from "recharts";
import { formatBRL, formatPct } from "@/lib/format";

const StatementPage = makeStatementPage("DVA", "Demonstração do Valor Adicionado");

const FATIAS = [
  { key: "Pessoal", color: "#6366F1", kws: ["pessoal", "remunera", "fgts", "benef"] },
  { key: "Governo", color: "#F59E0B", kws: ["imposto", "tribut", "contribui", "tax"] },
  { key: "Financiadores", color: "#3B82F6", kws: ["terceiros", "juros", "alugu", "financ"] },
  { key: "Acionistas/Retenção", color: "#10B981", kws: ["pr\u00f3prio", "dividend", "lucro retido", "preju\u00edzo do exerc"] },
];

function DVAExtras() {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const { data } = useFinancialStatement(companyId, "DVA", periodos);
  const lastPeriod = periodos[periodos.length - 1];

  const distribuicao = useMemo(() => {
    if (!data || !lastPeriod) return [];
    // Considera apenas linhas analíticas (não-subtotal) do bloco de distribuição
    const rows = data.filter((r: any) => r.periodo === lastPeriod && !r.is_subtotal);
    return FATIAS.map((f) => {
      const valor = rows
        .filter((r: any) =>
          f.kws.some((k) => (r.descricao ?? "").toLowerCase().includes(k.toLowerCase())),
        )
        .reduce((acc: number, r: any) => acc + Math.abs(Number(r.valor) || 0), 0);
      return { name: f.key, value: valor, color: f.color };
    }).filter((d) => d.value > 0);
  }, [data, lastPeriod]);

  const total = distribuicao.reduce((acc, d) => acc + d.value, 0);

  if (distribuicao.length === 0) return null;

  return (
    <Card className="p-5">
      <h3 className="font-semibold mb-4">Distribuição do Valor Adicionado</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
        <div className="h-72">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={distribuicao}
                dataKey="value"
                nameKey="name"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
              >
                {distribuicao.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip formatter={(v: any) => formatBRL(Number(v))} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <dl className="space-y-2 text-sm">
          {distribuicao.map((d) => (
            <div key={d.name} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: d.color }} />
                <dt>{d.name}</dt>
              </div>
              <dd className="font-medium">
                {formatBRL(d.value)}{" "}
                <span className="text-muted-foreground">({formatPct((d.value / total) * 100)})</span>
              </dd>
            </div>
          ))}
          <div className="flex justify-between border-t pt-2 font-semibold">
            <dt>Total Distribuído</dt>
            <dd>{formatBRL(total)}</dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}

function DVAPage() {
  return (
    <div className="space-y-6">
      <DVAExtras />
      <StatementPage />
    </div>
  );
}

export const Route = createFileRoute("/dashboard/dva")({ component: DVAPage });
