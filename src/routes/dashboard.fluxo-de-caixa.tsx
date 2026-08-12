import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useVisaoGerencial } from "@/hooks/use-visao-gerencial";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Loader2, Settings2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Cell, ReferenceLine, LabelList,
} from "recharts";
import { formatBRL, formatBRLCompact, formatBRLPlain } from "@/lib/format";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE, ANIMATION } from "@/lib/chart-config";
import {
  calcularDfcIndireto,
  type Agrupador,
  type DfcLinhaCalc,
} from "@/lib/dfc/calcular-indireto";
import { calcularDfcDireto, type DfcResultadoDireto } from "@/lib/dfc/calcular-direto";
import { BLOCO_LABEL } from "@/lib/dfc/estrutura";
import { validarDfc } from "@/lib/dfc/validacao";
import { DfcValidacaoPanel } from "@/components/dfc/dfc-validacao-panel";
import { detalharLinhaDfc } from "@/lib/dfc/detalhe-linha";
import { ExportMenu } from "@/components/export-menu";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { StatementRow } from "@/components/statement-table";

const AGRUPADORES: { value: Agrupador; label: string }[] = [
  { value: "mes", label: "Mês" },
  { value: "trimestre", label: "Trimestre" },
  { value: "semestre", label: "Semestre" },
  { value: "ano", label: "Ano" },
];

type Metodo = "indireto" | "direto";

function DFCContent() {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const { visao } = useVisaoGerencial();
  const [agrupador, setAgrupador] = useState<Agrupador>("mes");
  const [milhar, setMilhar] = useState(false);
  const [metodo, setMetodo] = useState<Metodo>("indireto");
  const [metodoTocado, setMetodoTocado] = useState(false);
  const [expandida, setExpandida] = useState<string | null>(null);

  // método padrão configurado pelo contador (dfc_config.metodo_padrao)
  const { data: cfgPadrao } = useQuery({
    queryKey: ["dfc-config-padrao", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase
        .from("dfc_config" as any)
        .select("metodo_padrao")
        .eq("company_id", companyId!)
        .maybeSingle();
      return ((data as any)?.metodo_padrao as Metodo | undefined) ?? null;
    },
  });
  useEffect(() => {
    if (!metodoTocado && (cfgPadrao === "direto" || cfgPadrao === "indireto")) setMetodo(cfgPadrao);
  }, [cfgPadrao, metodoTocado]);

  const visaoDfc = visao === "gerencial" ? "gerencial" : "contabil";

  const { data, isLoading } = useQuery({
    queryKey: ["dfc", metodo, companyId, periodos.join(","), agrupador, visaoDfc],
    enabled: !!companyId && periodos.length > 0,
    queryFn: () =>
      metodo === "direto"
        ? calcularDfcDireto({ companyId: companyId!, periodos, agrupador, visao: visaoDfc })
        : calcularDfcIndireto({ companyId: companyId!, periodos, agrupador, visao: visaoDfc }),
  });

  const { data: validacao, isLoading: loadingValidacao } = useQuery({
    queryKey: ["dfc-validacao", companyId, periodos.join(","), agrupador, visaoDfc],
    enabled: !!companyId && periodos.length > 0,
    queryFn: () =>
      validarDfc({ companyId: companyId!, periodos, agrupador, visao: visaoDfc }),
  });

  const direto = metodo === "direto" ? (data as DfcResultadoDireto | undefined) : undefined;

  const escala = milhar ? 1000 : 1;
  const fmt = (v: number | undefined | null) =>
    v == null ? "—" : formatBRLPlain(v, { digits: milhar ? 1 : 2, scale: escala });

  const waterfall = useMemo(() => {
    if (!data) return [];
    const t = data.totais;
    const ini = t["fech_caixa_inicial"] ?? 0;
    const op = t[metodo === "direto" ? "op_dir_total" : "op_ind_total"] ?? 0;
    const inv = t["inv_total"] ?? 0;
    const fin = t["fin_total"] ?? 0;
    const afterOp = ini + op;
    const afterInv = afterOp + inv;
    const afterFin = afterInv + fin;
    return [
      { name: "Caixa Inicial", base: 0, valor: Math.abs(ini), total: ini, kind: "total" },
      { name: "Operacional", base: Math.min(ini, afterOp), valor: Math.abs(op), total: op, kind: op >= 0 ? "pos" : "neg" },
      { name: "Investimento", base: Math.min(afterOp, afterInv), valor: Math.abs(inv), total: inv, kind: inv >= 0 ? "pos" : "neg" },
      { name: "Financiamento", base: Math.min(afterInv, afterFin), valor: Math.abs(fin), total: fin, kind: fin >= 0 ? "pos" : "neg" },
      { name: "Caixa Final", base: 0, valor: Math.abs(afterFin), total: afterFin, kind: "total" },
    ];
  }, [data, metodo]);

  if (isLoading || !data) {
    return (
      <Card className="p-8 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Calculando o fluxo de caixa (método{" "}
        {metodo})…
      </Card>
    );
  }

  if (data.colunas.length === 0) {
    return <Card className="p-6 text-sm text-muted-foreground">Selecione um período.</Card>;
  }

  if (!data.temConfig) {
    return (
      <Card className="p-8 space-y-2 text-center">
        <Settings2 className="h-6 w-6 mx-auto text-muted-foreground" />
        <h2 className="text-base font-semibold">DFC não configurada</h2>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          Nenhuma conta foi vinculada às linhas do fluxo de caixa desta empresa. Configure a DFC na
          área do tenant (Empresas → Dados → Fluxo de Caixa) para que a demonstração seja calculada.
        </p>
      </Card>
    );
  }

  const val = data.validacaoTotal;
  const ok = Math.abs(val.diferenca) < 0.01;
  const semConfig = data.linhas.filter((l) => l.semContas);

  const blocos: DfcLinhaCalc["bloco"][] = [
    "operacional",
    "investimento",
    "financiamento",
    "fechamento",
  ];

  const exportRows: StatementRow[] = data.linhas
    .filter((l) => blocos.includes(l.bloco))
    .map((l, i) => ({
      descricao: l.label,
      codigo_conta: null,
      nivel: l.calculada ? 0 : 1,
      is_subtotal: !!l.calculada,
      values: {
        ...Object.fromEntries(data.colunas.map((c) => [c.key, l.valores[c.key] ?? 0])),
        __total__: data.totais[l.key] ?? 0,
      },
      linha_ordem: i,
    }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Demonstração do Fluxo de Caixa</h2>
          <p className="text-xs text-muted-foreground">
            Método {metodo === "direto" ? "direto" : "indireto"} (CPC 03) — visão{" "}
            {visaoDfc === "gerencial" ? "gerencial" : "contábil"}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground mr-1">Método</span>
            {(["indireto", "direto"] as Metodo[]).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={metodo === m ? "secondary" : "ghost"}
                className="h-7 px-2 text-[11px] capitalize"
                onClick={() => {
                  setMetodoTocado(true);
                  setMetodo(m);
                  setExpandida(null);
                }}
              >
                {m}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground mr-1">Totalizar por</span>
            {AGRUPADORES.map((a) => (
              <Button
                key={a.value}
                size="sm"
                variant={agrupador === a.value ? "secondary" : "ghost"}
                className="h-7 px-2 text-[11px]"
                onClick={() => setAgrupador(a.value)}
              >
                {a.label}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant={milhar ? "secondary" : "outline"}
            className="h-7 px-2 text-[11px]"
            onClick={() => setMilhar((v) => !v)}
          >
            Mostrar em R$ mil
          </Button>
          <ExportMenu
            rows={exportRows}
            periods={[...data.colunas.map((c) => c.key), "__total__"]}
            periodLabels={[...data.colunas.map((c) => c.label), "Total"]}
            filename={`dfc-${metodo}`}
            title={`Demonstração do Fluxo de Caixa — método ${metodo}`}
            subtitle={`Visão ${visaoDfc === "gerencial" ? "gerencial" : "contábil"}`}
          />
        </div>
      </div>

      {/* Painel de validação de fechamento (3 validações + cobertura) */}
      <DfcValidacaoPanel data={validacao} isLoading={loadingValidacao} />

      {(data.semContasCaixa || semConfig.length > 0) && (
        <Card className="p-3 border border-amber-500/50 bg-amber-500/5">
          <div className="flex items-start gap-2 text-[11px]">
            <Settings2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
            <div className="space-y-0.5">
              {data.semContasCaixa && (
                <div className="text-amber-700 dark:text-amber-400">
                  Nenhuma conta de Caixa/Disponível configurada na DFC.
                </div>
              )}
              {semConfig.length > 0 && (
                <div className="text-muted-foreground">
                  Linhas ainda sem contas vinculadas: {semConfig.map((l) => l.label).join(", ")}.
                </div>
              )}
            </div>
          </div>
        </Card>
      )}





      {/* Tabela */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="sticky left-0 z-10 bg-muted/40 text-left font-medium px-3 py-2 min-w-[280px]">
                  Linha {milhar && <span className="text-muted-foreground">(R$ mil)</span>}
                </th>
                {data.colunas.map((c) => (
                  <th key={c.key} className="text-right font-medium px-3 py-2 whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
                <th className="text-right font-semibold px-3 py-2 whitespace-nowrap bg-muted/60">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {blocos.map((bloco) => {
                const linhas = data.linhas.filter((l) => l.bloco === bloco);
                if (linhas.length === 0) return null;
                return (
                  <Fragment key={bloco}>
                    <tr className="bg-muted/20 border-b border-border/60">
                      <td
                        className="sticky left-0 z-10 bg-muted/20 px-3 py-1.5 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground"
                        colSpan={1}
                      >
                        {BLOCO_LABEL[bloco]}
                      </td>
                      <td colSpan={data.colunas.length + 1} />
                    </tr>
                    {linhas.map((l) => {
                      const forte = l.calculada;
                      const drillable = l.contas.length > 0;
                      const aberta = expandida === l.key;
                      return (
                        <Fragment key={l.key}>
                        <tr
                          className={cn(
                            "border-b border-border/40",
                            forte && "bg-muted/30 font-semibold",
                            drillable && "cursor-pointer hover:bg-muted/20",
                          )}
                          onClick={
                            drillable ? () => setExpandida(aberta ? null : l.key) : undefined
                          }
                        >
                          <td
                            className={cn(
                              "sticky left-0 z-10 px-3 py-1.5 whitespace-nowrap",
                              forte ? "bg-muted/30" : "bg-background",
                            )}
                          >
                            {drillable &&
                              (aberta ? (
                                <ChevronDown className="inline h-3 w-3 mr-1 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="inline h-3 w-3 mr-1 text-muted-foreground" />
                              ))}
                            <span>{l.label}</span>
                            {l.semContas && (
                              <Badge
                                variant="outline"
                                className="ml-2 text-[9px] border-amber-500/60 py-0"
                              >
                                sem contas
                              </Badge>
                            )}
                          </td>
                          {data.colunas.map((c) => {
                            const v = l.valores[c.key] ?? 0;
                            return (
                              <td
                                key={c.key}
                                className={cn(
                                  "text-right px-3 py-1.5 whitespace-nowrap",
                                  v < 0 && "text-destructive",
                                )}
                              >
                                {fmt(v)}
                              </td>
                            );
                          })}
                          <td
                            className={cn(
                              "text-right px-3 py-1.5 whitespace-nowrap font-semibold bg-muted/40",
                              (data.totais[l.key] ?? 0) < 0 && "text-destructive",
                            )}
                          >
                            {fmt(data.totais[l.key] ?? 0)}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
              {/* Linha de validação por coluna */}
              <tr className="border-t border-border bg-muted/10">
                <td className="sticky left-0 z-10 bg-muted/10 px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                  Diferença vs. Disponível do Balanço
                </td>
                {data.colunas.map((c) => {
                  const d = data.validacao[c.key]?.diferenca ?? 0;
                  const okc = Math.abs(d) < 0.01;
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        "text-right px-3 py-1.5 whitespace-nowrap",
                        okc ? "text-emerald-600" : "text-amber-600",
                      )}
                    >
                      {fmt(d)}
                    </td>
                  );
                })}
                <td
                  className={cn(
                    "text-right px-3 py-1.5 whitespace-nowrap bg-muted/40",
                    ok ? "text-emerald-600" : "text-amber-600",
                  )}
                >
                  {fmt(val.diferenca)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Cascata do período */}
      <Card className="p-5">
        <h3 className="font-semibold mb-4 text-sm">
          Cascata do Fluxo de Caixa — {data.colunas[0].label} a{" "}
          {data.colunas[data.colunas.length - 1].label}
        </h3>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={waterfall} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="name" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatBRLCompact(v)} width={72} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(_v: any, _n: any, p: any) => [formatBRL(p?.payload?.total), p?.payload?.name]}
                labelFormatter={() => ""}
              />
              <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
              <Bar dataKey="base" stackId="a" fill="transparent" />
              <Bar dataKey="valor" stackId="a" radius={[5, 5, 0, 0]} {...ANIMATION}>
                <LabelList
                  dataKey="total"
                  position="top"
                  fontSize={11}
                  formatter={(v: number) => formatBRLCompact(v)}
                  fill="var(--foreground)"
                />
                {waterfall.map((d, i) => (
                  <Cell
                    key={i}
                    fill={
                      d.kind === "total"
                        ? "var(--chart-1)"
                        : d.kind === "pos"
                          ? "var(--success)"
                          : "var(--destructive)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/dashboard/fluxo-de-caixa")({
  component: DFCContent,
  head: () => ({
    meta: [
      { title: "Fluxo de Caixa (DFC) | Orkestria BI" },
      {
        name: "description",
        content:
          "Demonstração do Fluxo de Caixa pelo método indireto (CPC 03), com validação do caixa final contra o Balanço.",
      },
      { property: "og:title", content: "Fluxo de Caixa (DFC) | Orkestria BI" },
      {
        property: "og:description",
        content: "DFC pelo método indireto com validação automática do caixa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
