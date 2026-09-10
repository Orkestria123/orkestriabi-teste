import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import {
  AreaChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, ReferenceLine,
} from "recharts";
import { periodoLabel, formatBRLCompact, formatBRL } from "@/lib/format";
import {
  AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE, ANIMATION, tooltipFormatBRLCompact,
} from "@/lib/chart-config";
import { useMonthlyStatement } from "@/hooks/use-financial-data";
import { useEstruturaPadrao } from "@/hooks/use-indicador-data";
import { ensureDashboardConfig, lerDashboardBlocos } from "@/lib/dashboard/ensure-config";
import {
  indexarDemoDre,
  valorPapelDemo,
  valorCustosDemo,
  labelLinha,
  type DemoDre,
} from "@/lib/indicadores/linhas";
import type { PapelEstrutura } from "@/lib/plano/estrutura";

function valorLinha(
  demo: DemoDre | undefined,
  papel: string,
  periodo: string,
  estrutura: PapelEstrutura[] | undefined,
): number {
  if (papel === "CUSTOS") {
    const v = valorCustosDemo(demo, periodo, estrutura);
    return v == null ? 0 : v;
  }
  const v = valorPapelDemo(demo, papel, periodo, estrutura);
  return v == null ? 0 : v;
}

export function DashboardCharts({
  companyId,
  tenantId,
  activePeriods,
}: {
  companyId: string;
  tenantId?: string;
  activePeriods: string[];
}) {
  const qc = useQueryClient();
  const { data: configRows } = useQuery({
    queryKey: ["dashboard-config", tenantId, companyId],
    enabled: !!tenantId,
    queryFn: () => lerDashboardBlocos(tenantId!, companyId),
  });

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const criou = await ensureDashboardConfig(tenantId, companyId);
      if (criou) qc.invalidateQueries({ queryKey: ["dashboard-config", tenantId, companyId] });
    })();
  }, [tenantId, companyId, qc]);

  const recVsCusto = configRows?.find((r) => r.bloco === "grafico_receita_despesa");
  const tendencia = configRows?.find((r) => r.bloco === "grafico_tendencia");
  const showRec = recVsCusto?.visivel !== false;
  const showLucro = tendencia?.visivel !== false;

  const { data: dre } = useMonthlyStatement(companyId, "DRE", activePeriods);
  const { data: estrutura } = useEstruturaPadrao();
  const demo = useMemo(
    () => (dre ? indexarDemoDre(dre as any, estrutura) : undefined),
    [dre, estrutura],
  );

  const papelReceita = (recVsCusto?.config as any)?.papel_receita ?? "RECEITA_LIQUIDA";
  const papelCustos = (recVsCusto?.config as any)?.papel_custos ?? "CUSTOS";
  const papelLucro = (tendencia?.config as any)?.papel_lucro ?? "LUCRO_LIQUIDO";

  const chartData = useMemo(() => {
    return activePeriods.map((p) => {
      const lucro = valorLinha(demo, papelLucro, p, estrutura);
      const custosRaw = valorLinha(demo, papelCustos, p, estrutura);
      return {
        periodo: periodoLabel(p),
        Receita: valorLinha(demo, papelReceita, p, estrutura),
        Custos: Math.abs(custosRaw),
        Lucro: lucro,
        LucroPos: lucro >= 0 ? lucro : 0,
        LucroNeg: lucro < 0 ? lucro : 0,
      };
    });
  }, [demo, activePeriods, estrutura, papelReceita, papelCustos, papelLucro]);

  if (!showRec && !showLucro) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {showRec && (
        <Card className="p-5 shadow-[var(--shadow-soft)]">
          <h3 className="font-semibold mb-1">Receita vs Custos</h3>
          <p className="text-xs text-muted-foreground mb-4">
            {labelLinha(papelReceita)} · {labelLinha(papelCustos)} — mesma origem dos indicadores
          </p>
          <div className="h-72">
            <ResponsiveContainer>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gReceita" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.18} />
                    <stop offset="85%" stopColor="var(--chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="periodo" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatBRLCompact(v)} width={72} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatBRLCompact} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 16 }} iconType="circle" iconSize={8} />
                <Area
                  type="monotone"
                  dataKey="Receita"
                  stroke="var(--chart-2)"
                  strokeWidth={2.5}
                  fill="url(#gReceita)"
                  dot={{ r: 3.5, fill: "var(--chart-2)", strokeWidth: 2, stroke: "var(--card)" }}
                  activeDot={{ r: 6, fill: "var(--chart-2)", stroke: "var(--card)", strokeWidth: 2 }}
                  {...ANIMATION}
                />
                <Area
                  type="monotone"
                  dataKey="Custos"
                  stroke="var(--chart-5)"
                  strokeWidth={1.8}
                  strokeDasharray="5 3"
                  fill="transparent"
                  dot={{ r: 3, fill: "var(--chart-5)", strokeWidth: 1.5, stroke: "var(--card)" }}
                  activeDot={{ r: 5 }}
                  {...ANIMATION}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      {showLucro && (
        <Card className="p-5 shadow-[var(--shadow-soft)]">
          <h3 className="font-semibold mb-1">{labelLinha(papelLucro)}</h3>
          <p className="text-xs text-muted-foreground mb-4">Tendência do resultado — mesma origem dos indicadores</p>
          <div className="h-72">
            <ResponsiveContainer>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gLucroPos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--success)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gLucroNeg" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="var(--destructive)" stopOpacity={0.20} />
                    <stop offset="100%" stopColor="var(--destructive)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="periodo" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatBRLCompact(v)} width={72} />
                <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const item = payload.find((p) => p.dataKey === "Lucro") ?? payload[0];
                    if (item?.value == null) return null;
                    return (
                      <div style={TOOLTIP_STYLE}>
                        <div className="text-muted-foreground text-[11px] mb-1">{label}</div>
                        <div className="font-medium tabular-nums">
                          {formatBRL(Number(item.value))}
                          <span className="ml-1.5 text-muted-foreground font-normal">{labelLinha(papelLucro)}</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Area type="monotone" dataKey="LucroPos" stroke="transparent" fill="url(#gLucroPos)" tooltipType="none" legendType="none" {...ANIMATION} />
                <Area type="monotone" dataKey="LucroNeg" stroke="transparent" fill="url(#gLucroNeg)" tooltipType="none" legendType="none" {...ANIMATION} />
                <Line
                  type="monotone"
                  dataKey="Lucro"
                  stroke="var(--chart-4)"
                  strokeWidth={2.5}
                  dot={(props: any) => {
                    const { cx, cy, value, index } = props;
                    if (cx == null || cy == null) return null;
                    const color = (value ?? 0) >= 0 ? "var(--success)" : "var(--destructive)";
                    return <circle key={index} cx={cx} cy={cy} r={4} fill={color} stroke="var(--card)" strokeWidth={2} />;
                  }}
                  activeDot={{ r: 6, stroke: "var(--card)", strokeWidth: 2 }}
                  {...ANIMATION}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  );
}
