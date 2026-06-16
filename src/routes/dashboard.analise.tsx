import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDashboardCompany } from "@/components/dashboard-context";
import {
  useAvailablePeriods,
  useMonthlyStatement,
} from "@/hooks/use-financial-data";
import {
  useReceitaDespesaDetalhado,
  useReceitaDespesaPorPeriodo,
} from "@/hooks/use-receita-despesa";
import {
  agregarPorPeriodos,
  anosDisponiveis,
  periodoMesLabel,
  resolverPeriodos,
  type Granularidade,
  type MonthlyRow,
} from "@/lib/analise-helpers";
import {
  rankingDespesas,
  paretoDespesas,
  despesaPorCentro,
  composicaoReceita,
} from "@/lib/analise-receita-despesa";
import { PeriodPicker } from "@/components/analise/period-picker";
import { HighlightCard } from "@/components/analise/highlight-card";
import {
  ComparativoTable,
  type CompRow,
} from "@/components/analise/comparativo-table";
import { ComparativoBarChart } from "@/components/analise/comparativo-bar-chart";
import { CascataResultado } from "@/components/analise/cascata-resultado";
import { RankingDespesas } from "@/components/analise/ranking-despesas";
import { ParetoDespesas } from "@/components/analise/pareto-despesas";
import { DespesaPorCentro } from "@/components/analise/despesa-por-centro";
import { ComposicaoReceita } from "@/components/analise/composicao-receita";
import { EvolucaoReceitaDespesa } from "@/components/analise/evolucao-receita-despesa";
import { ResumoExecutivo } from "@/components/analise/resumo-executivo";
import { cn } from "@/lib/utils";
import { Maximize2, Minimize2 } from "lucide-react";
import { computeIndicators, formatIndicator } from "@/lib/indicators";
import { formatPct } from "@/lib/format";

export const Route = createFileRoute("/dashboard/analise")({ component: Page });

type Tipo = "DRE" | "BP_ATIVO" | "BP_PASSIVO" | "DFC" | "INDICADORES";

const TABS: { id: Tipo; label: string }[] = [
  { id: "DRE", label: "DRE" },
  { id: "BP_ATIVO", label: "Balanço · Ativo" },
  { id: "BP_PASSIVO", label: "Balanço · Passivo" },
  { id: "DFC", label: "DFC" },
  { id: "INDICADORES", label: "Indicadores" },
];

const RECEITA_KW = /receita líquida|receita liquida|receita bruta/i;
const LUCRO_KW = /lucro líquido|lucro liquido|resultado líquido/i;

function findValor(rows: { descricao: string; valor: number }[], kw: RegExp): number | null {
  const matched = rows.filter((r) => kw.test(r.descricao ?? ""));
  if (matched.length === 0) return null;
  return matched.reduce(
    (best, cur) => (Math.abs(cur.valor) > Math.abs(best) ? cur.valor : best),
    matched[0].valor,
  );
}

function Page() {
  const { companyId, company } = useDashboardCompany();
  const { data: availablePeriods = [] } = useAvailablePeriods(companyId);

  const [granularidade, setGranularidade] = useState<Granularidade>("ano");
  const [periodoA, setPeriodoA] = useState<string>("");
  const [periodoB, setPeriodoB] = useState<string>("");
  const [tipo, setTipo] = useState<Tipo>("DRE");
  const [presentation, setPresentation] = useState(false);
  const [secao, setSecao] = useState<string>("resumo");

  useEffect(() => {
    if (availablePeriods.length === 0) return;
    if (granularidade === "ano") {
      const anos = anosDisponiveis(availablePeriods);
      if (!periodoA || !anos.includes(parseInt(periodoA, 10))) {
        setPeriodoA(String(anos[anos.length - 2] ?? anos[anos.length - 1] ?? ""));
      }
      if (!periodoB || !anos.includes(parseInt(periodoB, 10))) {
        setPeriodoB(String(anos[anos.length - 1] ?? ""));
      }
    } else {
      if (!periodoA || !availablePeriods.includes(periodoA)) {
        setPeriodoA(availablePeriods[Math.max(0, availablePeriods.length - 13)]);
      }
      if (!periodoB || !availablePeriods.includes(periodoB)) {
        setPeriodoB(availablePeriods[availablePeriods.length - 1]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availablePeriods, granularidade]);

  const periodosA = useMemo(
    () => resolverPeriodos(granularidade, periodoA, availablePeriods),
    [granularidade, periodoA, availablePeriods],
  );
  const periodosB = useMemo(
    () => resolverPeriodos(granularidade, periodoB, availablePeriods),
    [granularidade, periodoB, availablePeriods],
  );
  const allPeriodos = useMemo(
    () => Array.from(new Set([...periodosA, ...periodosB])).sort(),
    [periodosA, periodosB],
  );

  const fetchTipo = tipo === "INDICADORES" ? "DRE" : tipo;
  const { data: rows = [], isLoading } = useMonthlyStatement(companyId, fetchTipo, allPeriodos);
  const { data: dreRows = [] } = useMonthlyStatement(
    companyId,
    "DRE",
    tipo === "INDICADORES" ? allPeriodos : [],
  );
  const { data: bpAtivoRows = [] } = useMonthlyStatement(
    companyId,
    "BP_ATIVO",
    tipo === "INDICADORES" ? allPeriodos : [],
  );
  const { data: bpPassivoRows = [] } = useMonthlyStatement(
    companyId,
    "BP_PASSIVO",
    tipo === "INDICADORES" ? allPeriodos : [],
  );

  const labelA = granularidade === "ano" ? periodoA : periodoA ? periodoMesLabel(periodoA) : "—";
  const labelB = granularidade === "ano" ? periodoB : periodoB ? periodoMesLabel(periodoB) : "—";

  // Receita × Despesa detalhado para período B (atual) e A (anterior)
  const { data: rdAtual } = useReceitaDespesaDetalhado(companyId, periodosB);
  const { data: rdAnterior } = useReceitaDespesaDetalhado(companyId, periodosA);
  // Evolução mensal (cada competência do período B)
  const competenciasMensais = useMemo(
    () => periodosB.map((c) => ({ periodo: c, competencias: [c] })),
    [periodosB],
  );
  const { data: rdMensal } = useReceitaDespesaPorPeriodo(companyId, competenciasMensais);

  const compRows: CompRow[] = useMemo(() => {
    if (tipo === "INDICADORES") return [];
    const ar = agregarPorPeriodos(rows as MonthlyRow[], fetchTipo, periodosA).byLinha;
    const br = agregarPorPeriodos(rows as MonthlyRow[], fetchTipo, periodosB).byLinha;
    const allLinhas = new Set<number>([...ar.keys(), ...br.keys()]);
    const out: CompRow[] = [];
    for (const ln of allLinhas) {
      const ref = ar.get(ln) ?? br.get(ln)!;
      out.push({
        linha_ordem: ln,
        descricao: ref.descricao,
        nivel: ref.nivel ?? 0,
        is_subtotal: ref.is_subtotal ?? false,
        valorA: ar.get(ln)?.valor ?? 0,
        valorB: br.get(ln)?.valor ?? 0,
      });
    }
    return out.sort((a, b) => a.linha_ordem - b.linha_ordem);
  }, [rows, fetchTipo, periodosA, periodosB, tipo]);

  const { data: dreForHighlights = [] } = useMonthlyStatement(
    companyId,
    "DRE",
    tipo === "DRE" || tipo === "INDICADORES" ? [] : allPeriodos,
  );
  const dreSource = (tipo === "DRE" ? rows : tipo === "INDICADORES" ? dreRows : dreForHighlights) as MonthlyRow[];

  const highlights = useMemo(() => {
    const a = agregarPorPeriodos(dreSource, "DRE", periodosA).ordered;
    const b = agregarPorPeriodos(dreSource, "DRE", periodosB).ordered;
    const recA = findValor(a, RECEITA_KW);
    const recB = findValor(b, RECEITA_KW);
    const lucA = findValor(a, LUCRO_KW);
    const lucB = findValor(b, LUCRO_KW);
    const margA = recA && recA !== 0 && lucA != null ? (lucA / recA) * 100 : null;
    const margB = recB && recB !== 0 && lucB != null ? (lucB / recB) * 100 : null;
    return { recA, recB, lucA, lucB, margA, margB };
  }, [dreSource, periodosA, periodosB]);

  const indicadoresAB = useMemo(() => {
    if (tipo !== "INDICADORES") return null;
    const aggA = [
      ...agregarPorPeriodos(dreRows as MonthlyRow[], "DRE", periodosA).ordered.map((r) => ({ ...r, tipo_demonstracao: "DRE" })),
      ...agregarPorPeriodos(bpAtivoRows as MonthlyRow[], "BP_ATIVO", periodosA).ordered.map((r) => ({ ...r, tipo_demonstracao: "BP" })),
      ...agregarPorPeriodos(bpPassivoRows as MonthlyRow[], "BP_PASSIVO", periodosA).ordered.map((r) => ({ ...r, tipo_demonstracao: "BP" })),
    ];
    const aggB = [
      ...agregarPorPeriodos(dreRows as MonthlyRow[], "DRE", periodosB).ordered.map((r) => ({ ...r, tipo_demonstracao: "DRE" })),
      ...agregarPorPeriodos(bpAtivoRows as MonthlyRow[], "BP_ATIVO", periodosB).ordered.map((r) => ({ ...r, tipo_demonstracao: "BP" })),
      ...agregarPorPeriodos(bpPassivoRows as MonthlyRow[], "BP_PASSIVO", periodosB).ordered.map((r) => ({ ...r, tipo_demonstracao: "BP" })),
    ];
    const rowsForIndicators = [
      ...aggA.map((r) => ({ ...r, periodo: "A" })),
      ...aggB.map((r) => ({ ...r, periodo: "B" })),
    ];
    return computeIndicators(rowsForIndicators as any, ["A", "B"]);
  }, [tipo, dreRows, bpAtivoRows, bpPassivoRows, periodosA, periodosB]);

  useEffect(() => {
    if (presentation) document.body.classList.add("presentation-mode");
    else document.body.classList.remove("presentation-mode");
    return () => document.body.classList.remove("presentation-mode");
  }, [presentation]);

  // Derivados para Resumo e Receita × Despesa
  const receitaB = rdAtual?.receita_total ?? 0;
  const despesaB = rdAtual?.despesa_total ?? 0;
  const receitaA = rdAnterior?.receita_total ?? 0;
  const despesaA = rdAnterior?.despesa_total ?? 0;
  const lucroB = highlights.lucB ?? receitaB - despesaB;
  const lucroA = highlights.lucA ?? receitaA - despesaA;
  const margemB = receitaB ? (lucroB / receitaB) * 100 : 0;
  const varPct = (b: number, a: number) => (a ? ((b - a) / Math.abs(a)) * 100 : null);

  const ranking = useMemo(() => (rdAtual ? rankingDespesas(rdAtual, 10) : []), [rdAtual]);
  const pareto = useMemo(() => (rdAtual ? paretoDespesas(rdAtual) : []), [rdAtual]);
  const centros = useMemo(() => (rdAtual ? despesaPorCentro(rdAtual) : []), [rdAtual]);
  const origens = useMemo(() => (rdAtual ? composicaoReceita(rdAtual) : []), [rdAtual]);

  const evolucao = useMemo(() => {
    if (!rdMensal) return [];
    return rdMensal.map((m) => {
      const rec = m.dados.receita_total;
      const desp = m.dados.despesa_total;
      const d = new Date(m.periodo);
      const mes = `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`;
      return { mes, receita: rec, despesaTotal: desp, margem: rec - desp };
    });
  }, [rdMensal]);

  const maiorDespesa = ranking[0];

  if (!companyId) {
    return (
      <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
        Selecione uma empresa para iniciar a análise.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Análise</h2>
          <p className="text-sm text-muted-foreground mt-1">
            De onde vem o dinheiro, para onde ele vai, e o que fazer a respeito.
          </p>
        </div>
        <Button
          size="sm"
          variant={presentation ? "default" : "outline"}
          onClick={() => setPresentation((v) => !v)}
          className="gap-2"
        >
          {presentation ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          {presentation ? "Sair" : "Modo Apresentação"}
        </Button>
      </div>

      {presentation && (
        <Card className="p-4 bg-gradient-to-r from-primary/10 to-transparent">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Apresentação</p>
          <p className="text-lg font-semibold mt-1">
            {company?.razao_social ?? company?.name} — {labelA} vs {labelB}
          </p>
        </Card>
      )}

      <Card className="p-4">
        <PeriodPicker
          granularidade={granularidade}
          setGranularidade={setGranularidade}
          periodoA={periodoA}
          periodoB={periodoB}
          setPeriodoA={setPeriodoA}
          setPeriodoB={setPeriodoB}
          availablePeriods={availablePeriods}
        />
      </Card>

      <Tabs value={secao} onValueChange={setSecao}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="receitaDespesa">Receita × Despesa</TabsTrigger>
          <TabsTrigger value="comparativo">Comparativo</TabsTrigger>
          <TabsTrigger value="tendencia" disabled>Tendência</TabsTrigger>
          <TabsTrigger value="equilibrio" disabled>Ponto de Equilíbrio</TabsTrigger>
          <TabsTrigger value="capitalGiro" disabled>Capital de Giro</TabsTrigger>
          <TabsTrigger value="projecao" disabled>Projeção</TabsTrigger>
        </TabsList>

        {/* ============ RESUMO ============ */}
        <TabsContent value="resumo" className="space-y-5 mt-5">
          <p className="text-xs text-muted-foreground">
            Em 30 segundos, como sua empresa está em {labelB}.
          </p>
          <ResumoExecutivo
            receita={receitaB}
            despesa={despesaB}
            lucro={lucroB}
            margem={margemB}
            varReceita={varPct(receitaB, receitaA)}
            varDespesa={varPct(despesaB, despesaA)}
            varLucro={varPct(lucroB, lucroA)}
            maiorDespesaNome={maiorDespesa?.descricao}
            maiorDespesaPct={maiorDespesa?.pct_receita}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EvolucaoReceitaDespesa data={evolucao} />
            <ComposicaoReceita data={origens} />
          </div>
        </TabsContent>

        {/* ============ RECEITA × DESPESA ============ */}
        <TabsContent value="receitaDespesa" className="space-y-5 mt-5">
          <p className="text-xs text-muted-foreground">
            De onde vem seu dinheiro, para onde ele vai, e o que está pesando mais.
          </p>
          <CascataResultado data={rdAtual ?? emptyRd()} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RankingDespesas ranking={ranking} />
            <DespesaPorCentro data={centros} />
          </div>
          <ParetoDespesas data={pareto} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EvolucaoReceitaDespesa data={evolucao} />
            <ComposicaoReceita data={origens} />
          </div>
        </TabsContent>

        {/* ============ COMPARATIVO (preservado) ============ */}
        <TabsContent value="comparativo" className="space-y-5 mt-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <HighlightCard label="Lucro Líquido" valorA={highlights.lucA} valorB={highlights.lucB} labelA={labelA} labelB={labelB} />
            <HighlightCard label="Receita Líquida" valorA={highlights.recA} valorB={highlights.recB} labelA={labelA} labelB={labelB} />
            <HighlightCard label="Margem Líquida" valorA={highlights.margA} valorB={highlights.margB} labelA={labelA} labelB={labelB} format="percent" />
          </div>

          <div className="flex flex-wrap gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTipo(t.id)}
                className={cn(
                  "px-4 h-9 text-sm font-medium border-b-2 -mb-px transition-colors",
                  tipo === t.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tipo !== "INDICADORES" ? (
            <>
              {!presentation && compRows.length > 0 && (
                <ComparativoBarChart rows={compRows} labelA={labelA} labelB={labelB} />
              )}
              {isLoading ? (
                <div className="text-sm text-muted-foreground">Carregando…</div>
              ) : (
                <ComparativoTable rows={compRows} labelA={labelA} labelB={labelB} presentation={presentation} />
              )}
            </>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {(indicadoresAB ?? []).map((ind) => {
                const va = ind.values["A"];
                const vb = ind.values["B"];
                const variacao =
                  va != null && vb != null
                    ? ind.format === "percent"
                      ? vb - va
                      : va !== 0 ? ((vb - va) / Math.abs(va)) * 100 : null
                    : null;
                return (
                  <Card key={ind.key} className="p-4">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{ind.category}</p>
                    <p className="text-sm font-semibold mt-0.5">{ind.label}</p>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{labelA}</p>
                        <p className="text-base font-semibold tabular-nums">{formatIndicator(va ?? null, ind.format)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{labelB}</p>
                        <p className="text-base font-semibold tabular-nums">{formatIndicator(vb ?? null, ind.format)}</p>
                      </div>
                    </div>
                    {variacao != null && (
                      <p className={cn("mt-2 text-xs font-medium", variacao > 0 ? "text-success" : variacao < 0 ? "text-destructive" : "text-muted-foreground")}>
                        {variacao > 0 ? "▲" : variacao < 0 ? "▼" : ""} {ind.format === "percent" ? `${Math.abs(variacao).toFixed(2).replace(".", ",")} p.p.` : formatPct(Math.abs(variacao), 1)}
                      </p>
                    )}
                    <p className="mt-2 text-[10px] text-muted-foreground">{ind.description}</p>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {presentation && (
        <Button
          size="sm"
          variant="default"
          onClick={() => setPresentation(false)}
          className="fixed bottom-6 right-6 z-50 shadow-[var(--shadow-elegant)] gap-2"
        >
          <Minimize2 className="h-4 w-4" /> Sair do Modo Apresentação
        </Button>
      )}
    </div>
  );
}

function emptyRd() {
  const r = { classificacao: "", descricao: "Receita", nivel: 0, valor: 0, filhos: [] };
  const d = { classificacao: "", descricao: "Despesa", nivel: 0, valor: 0, filhos: [] };
  return { competencias: [], receita_total: 0, despesa_total: 0, raiz_receita: r, raiz_despesa: d } as any;
}
