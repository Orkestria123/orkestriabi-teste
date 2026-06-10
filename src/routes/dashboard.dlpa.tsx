import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useDashboardCompany } from "./dashboard";
import { useFilters } from "@/components/filter-bar";
import { useFinancialStatement } from "@/hooks/use-financial-data";
import { makeStatementPage } from "./dashboard.dre";
import { Card } from "@/components/ui/card";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import { formatBRLCompact, formatBRL, periodoLabel } from "@/lib/format";

const StatementPage = makeStatementPage("DLPA", "Demonstração de Lucros e Prejuízos Acumulados");

function DLPAExtras() {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const { data } = useFinancialStatement(companyId, "DLPA", periodos);

  const chartData = useMemo(() => {
    if (!data) return [];
    // pega o último valor não-subtotal por período (heurística: linha "saldo final")
    return periodos.map((p) => {
      const finais = data.filter(
        (r: any) =>
          r.periodo === p &&
          /saldo.+final|saldo final.+lucros/i.test(r.descricao ?? ""),
      );
      const saldoFinal = finais.reduce((acc: number, r: any) => acc + (Number(r.valor) || 0), 0);
      // fallback: soma de todas as linhas analíticas
      const totalSeRequerido = data
        .filter((r: any) => r.periodo === p)
        .reduce((acc: number, r: any) => acc + (Number(r.valor) || 0), 0);
      return {
        periodo: periodoLabel(p),
        Saldo: saldoFinal !== 0 ? saldoFinal : totalSeRequerido,
      };
    });
  }, [data, periodos]);

  const ultimo = chartData[chartData.length - 1]?.Saldo ?? 0;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Evolução do Saldo de Lucros/Prejuízos Acumulados</h3>
        <span className={`text-sm font-medium ${ultimo < 0 ? "text-red-600" : "text-emerald-600"}`}>
          {ultimo < 0 ? "Prejuízos Acumulados: " : "Lucros Acumulados: "}{formatBRL(ultimo)}
        </span>
      </div>
      <div className="h-72">
        <ResponsiveContainer>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.012 260)" />
            <XAxis dataKey="periodo" fontSize={12} />
            <YAxis fontSize={12} tickFormatter={(v) => formatBRLCompact(v)} />
            <Tooltip formatter={(v: any) => formatBRL(Number(v))} />
            <ReferenceLine y={0} stroke="oklch(0.6 0.01 260)" />
            <Line
              type="monotone"
              dataKey="Saldo"
              stroke="oklch(0.54 0.20 277)"
              strokeWidth={2.5}
              dot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function DLPAPage() {
  return (
    <div className="space-y-6">
      <DLPAExtras />
      <StatementPage />
    </div>
  );
}

export const Route = createFileRoute("/dashboard/dlpa")({ component: DLPAPage });
