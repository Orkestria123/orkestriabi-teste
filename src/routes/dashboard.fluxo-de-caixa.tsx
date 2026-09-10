import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useMonthlyStatement } from "@/hooks/use-financial-data";
import { makeStatementPage } from "./dashboard.dre";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/kpi-card";
import { ValidationBadge } from "@/components/validation-badge";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Cell, ReferenceLine, LabelList, AreaChart, Area,
} from "recharts";
import { formatBRLCompact, formatBRL, periodoLabel } from "@/lib/format";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE, ANIMATION, CHART_COLORS } from "@/lib/chart-config";

const StatementPage = makeStatementPage("DFC", "Demonstração do Fluxo de Caixa");

function val(rows: any[], desc: string, periodo: string): number {
  return rows.find((r) => r.descricao === desc && r.periodo === periodo)?.valor ?? 0;
}

function DFCContent() {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const { data: rows } = useMonthlyStatement(companyId, "DFC", periodos);

  const blocks = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const periodosOrd = Array.from(new Set(rows.map((r: any) => r.periodo))).sort() as string[];
    const last = periodosOrd[periodosOrd.length - 1];
    const prev = periodosOrd[periodosOrd.length - 2];

    const perPeriodo = periodosOrd.map((p) => ({
      periodo: p,
      label: periodoLabel(p),
      operacional: val(rows, "(=) Caixa das Atividades Operacionais", p),
      investimento: val(rows, "(=) Caixa das Atividades de Investimento", p),
      financiamento: val(rows, "(=) Caixa das Atividades de Financiamento", p),
      caixaIni: val(rows, "Caixa no Início do Período", p),
      caixaFim: val(rows, "Caixa no Final do Período", p),
      lucroLiq: val(rows, "Lucro Líquido do Exercício", p),
    }));

    const lastP = perPeriodo[perPeriodo.length - 1];
    const prevP = prev ? perPeriodo[perPeriodo.length - 2] : null;

    // Validação badge: pegar a linha de validação
    const validRow = rows.find(
      (r: any) => r.periodo === last && (r.descricao || "").startsWith("✓ Validação CPC") || r.periodo === last && (r.descricao || "").startsWith("⚠ Validação CPC"),
    );
    const validado = (validRow?.descricao || "").startsWith("✓");

    // Soma do período total (todos meses)
    const totalOp = perPeriodo.reduce((a, b) => a + b.operacional, 0);
    const totalInv = perPeriodo.reduce((a, b) => a + b.investimento, 0);
    const totalFin = perPeriodo.reduce((a, b) => a + b.financiamento, 0);
    const caixaInicialRange = perPeriodo[0]?.caixaIni ?? 0;
    const caixaFinalRange = lastP?.caixaFim ?? 0;

    return {
      perPeriodo, last, lastP, prevP, validado,
      totalOp, totalInv, totalFin,
      caixaInicialRange, caixaFinalRange,
    };
  }, [rows]);

  if (!blocks) {
    return <Card className="p-6 text-sm text-muted-foreground">Carregando fluxo de caixa…</Card>;
  }

  const { perPeriodo, lastP, prevP, validado, totalOp, totalInv, totalFin, caixaInicialRange, caixaFinalRange } = blocks;
  const fcl = totalOp + totalInv; // fluxo de caixa livre
  const receitaPeriodo = 0; // (poderíamos buscar da DRE; deixar simples)
  void receitaPeriodo;

  // Waterfall do total agregado
  const cIni = caixaInicialRange;
  const afterOp = cIni + totalOp;
  const afterInv = afterOp + totalInv;
  const afterFin = afterInv + totalFin;
  const waterfall = [
    { name: "Caixa Inicial", base: 0, valor: cIni, total: cIni, kind: "total" },
    { name: "Operacional", base: Math.min(cIni, afterOp), valor: Math.abs(totalOp), total: totalOp, kind: totalOp >= 0 ? "pos" : "neg" },
    { name: "Investimento", base: Math.min(afterOp, afterInv), valor: Math.abs(totalInv), total: totalInv, kind: totalInv >= 0 ? "pos" : "neg" },
    { name: "Financiamento", base: Math.min(afterInv, afterFin), valor: Math.abs(totalFin), total: totalFin, kind: totalFin >= 0 ? "pos" : "neg" },
    { name: "Caixa Final", base: 0, valor: afterFin, total: afterFin, kind: "total" },
  ];

  const insights: string[] = [
    totalOp > 0
      ? `A empresa gerou ${formatBRL(totalOp)} de caixa nas operações — sinal de sustentabilidade.`
      : `As operações consumiram ${formatBRL(Math.abs(totalOp))} de caixa. Atenção ao capital de giro.`,
    totalOp > 0 && totalInv < 0
      ? `Padrão de empresa em expansão: investindo ${formatBRL(Math.abs(totalInv))} com caixa próprio.`
      : "",
    totalOp < 0 && totalFin > 0
      ? `Operações sustentadas por captação (${formatBRL(totalFin)}) — modelo não sustentável a longo prazo.`
      : "",
    fcl > 0
      ? `Fluxo de Caixa Livre positivo de ${formatBRL(fcl)} — disponível para sócios ou amortização.`
      : `Fluxo de Caixa Livre negativo de ${formatBRL(Math.abs(fcl))}.`,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">Demonstração do Fluxo de Caixa</h2>
        <ValidationBadge
          ok={validado}
          label={validado ? "Variação de caixa conferida com o Balanço (CPC 03)" : "Divergência na variação de caixa (CPC 03)"}
        />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Caixa Operacional" value={totalOp} previousValue={prevP?.operacional} tone={totalOp >= 0 ? "positive" : "negative"} />
        <KpiCard label="Fluxo de Caixa Livre" value={fcl} tone={fcl >= 0 ? "positive" : "negative"} hint="Operacional + Investimento" />
        <KpiCard label="Variação de Caixa" value={caixaFinalRange - caixaInicialRange} tone={(caixaFinalRange - caixaInicialRange) >= 0 ? "positive" : "negative"} />
        <KpiCard label="Caixa Final" value={caixaFinalRange} tone="default" />
      </div>

      {/* Gráfico 1: Waterfall */}
      <Card className="p-5">
        <h3 className="font-semibold mb-4">Cascata do Fluxo de Caixa — período {periodoLabel(perPeriodo[0].periodo)} a {periodoLabel(lastP.periodo)}</h3>
        <div className="h-80">
          <ResponsiveContainer>
            <BarChart data={waterfall} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="name" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatBRLCompact(v)} width={72} />
              <Tooltip contentStyle={TOOLTIP_STYLE}
                formatter={(_v: any, _n: any, p: any) => [formatBRL(p?.payload?.total), p?.payload?.name]}
                labelFormatter={() => ""} />
              <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
              <Bar dataKey="base" stackId="a" fill="transparent" />
              <Bar dataKey="valor" stackId="a" radius={[5, 5, 0, 0]} {...ANIMATION}>
                <LabelList dataKey="total" position="top" fontSize={11} formatter={(v: number) => formatBRLCompact(v)} fill="var(--foreground)" />
                {waterfall.map((d, i) => (
                  <Cell key={i} fill={
                    d.kind === "total" ? "var(--chart-1)" :
                    d.kind === "pos" ? "var(--success)" : "var(--destructive)"
                  } />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Gráfico 2: Área caixa operacional */}
        <Card className="p-5">
          <h3 className="font-semibold mb-4">Evolução do Caixa Operacional</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={perPeriodo}>
                <defs>
                  <linearGradient id="gradOp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--success)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatBRLCompact(v)} width={64} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => formatBRL(Number(v))} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Area type="monotone" dataKey="operacional" stroke="var(--chart-2)" strokeWidth={2.5}
                  fill="url(#gradOp)" {...ANIMATION} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Gráfico 3: Barras agrupadas */}
        <Card className="p-5">
          <h3 className="font-semibold mb-4">Composição por Atividade</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={perPeriodo} barGap={3} barCategoryGap="28%">
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatBRLCompact(v)} width={64} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => formatBRL(Number(v))} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Bar dataKey="operacional" name="Operacional" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} {...ANIMATION} />
                <Bar dataKey="investimento" name="Investimento" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} {...ANIMATION} />
                <Bar dataKey="financiamento" name="Financiamento" fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} {...ANIMATION} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Insights */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3">💡 Leitura Automática</h3>
        <ul className="space-y-2 text-sm">
          {insights.map((i, idx) => (
            <li key={idx} className="rounded-md bg-muted/40 px-3 py-2 border border-border/40">{i}</li>
          ))}
        </ul>
      </Card>

      <StatementPage />
    </div>
  );
}

export const Route = createFileRoute("/dashboard/fluxo-de-caixa")({ component: DFCContent });
