import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useVisaoGerencial } from "@/hooks/use-visao-gerencial";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Loader2, Settings2 } from "lucide-react";
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

  const visaoDfc = visao === "gerencial" ? "gerencial" : "contabil";

  const { data, isLoading } = useQuery({
    queryKey: ["dfc", metodo, companyId, periodos.join(","), agrupador, visaoDfc],
    enabled: !!companyId && periodos.length > 0,
    queryFn: () =>
      metodo === "direto"
        ? calcularDfcDireto({ companyId: companyId!, periodos, agrupador, visao: visaoDfc })
        : calcularDfcIndireto({ companyId: companyId!, periodos, agrupador, visao: visaoDfc }),
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
  }, [data]);

  if (isLoading || !data) {
    return (
      <Card className="p-8 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Calculando o fluxo de caixa (método indireto)…
      </Card>
    );
  }

  if (data.colunas.length === 0) {
    return <Card className="p-6 text-sm text-muted-foreground">Selecione um período.</Card>;
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Demonstração do Fluxo de Caixa</h2>
          <p className="text-xs text-muted-foreground">
            Método indireto (CPC 03) — visão {visaoDfc === "gerencial" ? "gerencial" : "contábil"}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
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
        </div>
      </div>

      {/* Validação de fechamento */}
      <Card
        className={cn(
          "p-4 border",
          ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/50 bg-amber-500/5",
        )}
      >
        <div className="flex items-start gap-3 flex-wrap">
          {ok ? (
            <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
          )}
          <div className="text-xs space-y-1">
            <div className="font-medium">
              {ok
                ? "Caixa final calculado confere com o Disponível do Balanço."
                : "Divergência entre o caixa final calculado e o Disponível do Balanço."}
            </div>
            <div className="text-muted-foreground flex gap-4 flex-wrap tabular-nums">
              <span>Calculado: {formatBRL(val.caixaFinalCalculado)}</span>
              <span>Balanço: {formatBRL(val.caixaFinalBP)}</span>
              <span className={cn(!ok && "text-amber-700 dark:text-amber-400 font-medium")}>
                Diferença: {formatBRL(val.diferenca)}
              </span>
            </div>
            {!ok && semConfig.length > 0 && (
              <div className="text-muted-foreground flex items-start gap-1.5 pt-1">
                <Settings2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Linhas ainda sem contas vinculadas: {semConfig.map((l) => l.label).join(", ")}.
                </span>
              </div>
            )}
            {data.semContasCaixa && (
              <div className="text-amber-700 dark:text-amber-400">
                Nenhuma conta de Caixa/Disponível configurada na DFC.
              </div>
            )}
          </div>
        </div>
      </Card>

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
                      return (
                        <tr
                          key={l.key}
                          className={cn(
                            "border-b border-border/40",
                            forte && "bg-muted/30 font-semibold",
                          )}
                        >
                          <td
                            className={cn(
                              "sticky left-0 z-10 px-3 py-1.5 whitespace-nowrap",
                              forte ? "bg-muted/30" : "bg-background",
                            )}
                          >
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
