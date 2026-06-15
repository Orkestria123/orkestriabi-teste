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
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { formatBRL, formatBRLCompact, formatPct, periodoLabel } from "@/lib/format";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE, ANIMATION, CHART_COLORS } from "@/lib/chart-config";

const StatementPage = makeStatementPage("DVA", "Demonstração do Valor Adicionado");

function val(rows: any[], desc: string, periodo: string): number {
  return rows.find((r) => r.descricao === desc && r.periodo === periodo)?.valor ?? 0;
}

function DVAContent() {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const { data: rows } = useMonthlyStatement(companyId, "DVA", periodos);

  const blocks = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const periodosOrd = Array.from(new Set(rows.map((r: any) => r.periodo))).sort() as string[];
    const last = periodosOrd[periodosOrd.length - 1];

    const perPeriodo = periodosOrd.map((p) => ({
      label: periodoLabel(p),
      pessoal: val(rows, "Pessoal e Encargos", p),
      governo: val(rows, "Impostos, Taxas e Contribuições", p),
      terceiros: val(rows, "Remuneração de Capitais de Terceiros", p),
      socios: val(rows, "Remuneração de Capitais Próprios", p),
    }));

    const pessoal = val(rows, "Pessoal e Encargos", last);
    const governo = val(rows, "Impostos, Taxas e Contribuições", last);
    const terceiros = val(rows, "Remuneração de Capitais de Terceiros", last);
    const socios = val(rows, "Remuneração de Capitais Próprios", last);
    const vaTotal = val(rows, "(=) Valor Adicionado Total a Distribuir", last);
    const receitas = val(rows, "Receitas", last);
    const totalDist = pessoal + governo + terceiros + socios;

    const validRow = rows.find((r: any) => r.periodo === last && /Validação CPC 09/i.test(r.descricao ?? ""));
    const validado = (validRow?.descricao || "").startsWith("✓");

    return { perPeriodo, last, pessoal, governo, terceiros, socios, vaTotal, receitas, totalDist, validado };
  }, [rows]);

  if (!blocks) {
    return <Card className="p-6 text-sm text-muted-foreground">Carregando DVA…</Card>;
  }

  const { perPeriodo, last, pessoal, governo, terceiros, socios, vaTotal, receitas, totalDist, validado } = blocks;

  const distribuicao = [
    { name: "Pessoal", value: pessoal, color: CHART_COLORS[0] },
    { name: "Governo", value: governo, color: CHART_COLORS[4] },
    { name: "Financiadores", value: terceiros, color: CHART_COLORS[1] },
    { name: "Sócios/Retenção", value: socios, color: CHART_COLORS[3] },
  ].filter((d) => d.value > 0);

  const cargaTrib = vaTotal > 0 ? (governo / vaTotal) * 100 : 0;
  const taxaVA = receitas > 0 ? (vaTotal / receitas) * 100 : 0;
  const retencaoSoc = vaTotal > 0 ? (socios / vaTotal) * 100 : 0;
  const fatiaPessoal = vaTotal > 0 ? (pessoal / vaTotal) * 100 : 0;

  const maior = distribuicao.length > 0
    ? distribuicao.reduce((a, b) => (a.value > b.value ? a : b))
    : { name: "—", value: 0 };

  const insights = [
    `A empresa gerou ${formatBRL(vaTotal)} de riqueza no período.`,
    distribuicao.length > 0
      ? `Maior fatia (${formatPct((maior.value / totalDist) * 100, 1)}) destinada a ${maior.name}.`
      : "",
    cargaTrib > 30
      ? `Carga tributária elevada: ${formatPct(cargaTrib, 1)} da riqueza foi para o governo.`
      : `Carga tributária de ${formatPct(cargaTrib, 1)} sobre o valor adicionado.`,
    `Para cada R$ 1,00 de riqueza, R$ ${(pessoal / Math.max(vaTotal, 1)).toFixed(2)} ficaram com os colaboradores.`,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">Demonstração do Valor Adicionado</h2>
        <ValidationBadge
          ok={validado}
          label={validado ? "Valor gerado = valor distribuído (CPC 09)" : "Geração diferente da distribuição (CPC 09)"}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Valor Adicionado Total" value={vaTotal} tone="positive" />
        <KpiCard label="Carga Tributária" value={cargaTrib} format="pct" tone={cargaTrib > 30 ? "negative" : "neutral"} hint="Sobre o VA" />
        <KpiCard label="Taxa de VA" value={taxaVA} format="pct" hint="VA / Receita" />
        <KpiCard label="Retenção Sócios" value={retencaoSoc} format="pct" />
      </div>

      <Card className="p-5">
        <h3 className="font-semibold mb-4">Distribuição do Valor Adicionado — {periodoLabel(last)}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          <div className="h-80 relative">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={distribuicao} dataKey="value" nameKey="name"
                  innerRadius={75} outerRadius={110} paddingAngle={3}
                  startAngle={90} endAngle={-270}
                  label={({ percent }: any) => `${((percent as number) * 100).toFixed(1)}%`}
                  {...ANIMATION}>
                  {distribuicao.map((d, i) => <Cell key={i} fill={d.color} stroke="var(--card)" strokeWidth={3} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => formatBRL(Number(v))} />
                <Legend layout="horizontal" verticalAlign="bottom" align="center"
                  wrapperStyle={{ fontSize: 11, paddingTop: 12 }} iconType="circle" iconSize={8} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 grid place-items-center pointer-events-none top-[-2rem]">
              <div className="text-center">
                <div className="text-xs uppercase text-muted-foreground tracking-wider">VA Total</div>
                <div className="text-lg font-semibold">{formatBRLCompact(vaTotal)}</div>
              </div>
            </div>
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
                  <span className="text-muted-foreground">({formatPct((d.value / Math.max(totalDist, 1)) * 100)})</span>
                </dd>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 font-semibold">
              <dt>Total Distribuído</dt>
              <dd>{formatBRL(totalDist)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold mb-4">Evolução da Distribuição (100%)</h3>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={perPeriodo} stackOffset="expand">
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="label" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} width={48} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => formatBRL(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              <Bar dataKey="pessoal" name="Pessoal" stackId="a" fill={CHART_COLORS[0]} {...ANIMATION} />
              <Bar dataKey="governo" name="Governo" stackId="a" fill={CHART_COLORS[4]} {...ANIMATION} />
              <Bar dataKey="terceiros" name="Financiadores" stackId="a" fill={CHART_COLORS[1]} {...ANIMATION} />
              <Bar dataKey="socios" name="Sócios" stackId="a" fill={CHART_COLORS[3]} {...ANIMATION} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold mb-3">💡 Leitura Automática</h3>
        <ul className="space-y-2 text-sm">
          {insights.map((i, idx) => (
            <li key={idx} className="rounded-md bg-muted/40 px-3 py-2 border border-border/40">{i}</li>
          ))}
        </ul>
        <div className="text-xs text-muted-foreground mt-3">
          Riqueza por R$ de receita: <strong>{formatPct(taxaVA, 1)}</strong> · Fatia Pessoal: <strong>{formatPct(fatiaPessoal, 1)}</strong>
        </div>
      </Card>

      <StatementPage />
    </div>
  );
}

export const Route = createFileRoute("/dashboard/dva")({ component: DVAContent });
