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
import { useReceitaDespesaDetalhado } from "@/hooks/use-receita-despesa";

import {
  agregarPorPeriodos,
  anosDisponiveis,
  resolverPeriodosMulti,
  rotuloSelecao,
  type Granularidade,
  type MonthlyRow,
} from "@/lib/analise-helpers";
import { type NoArvore } from "@/lib/analise-receita-despesa";
import { PeriodPicker } from "@/components/analise/period-picker";
import { HighlightCard } from "@/components/analise/highlight-card";
import {
  ComparativoTable,
  type CompRow,
} from "@/components/analise/comparativo-table";
import { ComparativoBarChart } from "@/components/analise/comparativo-bar-chart";
import { PontoEquilibrioPanel } from "@/components/analise/ponto-equilibrio-panel";

import {
  calcularPontoEquilibrio,
  type DespesaItem,
} from "@/lib/analise-ponto-equilibrio";
import { tipoCustoEfetivo } from "@/lib/plano/tipo-custo";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Maximize2, Minimize2, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  PainelAnalisesConfiguraveis,
  useCapitalGiroEstrutura,
} from "@/components/analise/analises-dinamicas";
import { CapitalGiroEstrutural } from "@/components/analise/capital-giro-estrutural";

export const Route = createFileRoute("/dashboard/analise")({ component: Page });

type Tipo = "DRE" | "BP_ATIVO" | "BP_PASSIVO" | "DFC";

const TABS: { id: Tipo; label: string }[] = [
  { id: "DRE", label: "DRE" },
  { id: "BP_ATIVO", label: "Balanço · Ativo" },
  { id: "BP_PASSIVO", label: "Balanço · Passivo" },
  { id: "DFC", label: "DFC" },
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
  const [selA, setSelA] = useState<string[]>([]);
  const [selB, setSelB] = useState<string[]>([]);
  const [tipo, setTipo] = useState<Tipo>("DRE");
  const [presentation, setPresentation] = useState(false);
  const [secao, setSecao] = useState<string>("comparativo");

  useEffect(() => {
    if (availablePeriods.length === 0) return;
    if (granularidade === "ano") {
      const anos = anosDisponiveis(availablePeriods).map(String);
      const validos = (v: string[]) => v.filter((x) => anos.includes(x));
      setSelA((prev) =>
        validos(prev).length > 0
          ? validos(prev)
          : [anos[anos.length - 2] ?? anos[anos.length - 1]].filter(Boolean),
      );
      setSelB((prev) =>
        validos(prev).length > 0 ? validos(prev) : [anos[anos.length - 1]].filter(Boolean),
      );
    } else {
      const validos = (v: string[]) => v.filter((x) => availablePeriods.includes(x));
      setSelA((prev) =>
        validos(prev).length > 0
          ? validos(prev)
          : [availablePeriods[Math.max(0, availablePeriods.length - 13)]].filter(Boolean),
      );
      setSelB((prev) =>
        validos(prev).length > 0
          ? validos(prev)
          : [availablePeriods[availablePeriods.length - 1]].filter(Boolean),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availablePeriods, granularidade]);

  const periodosA = useMemo(
    () => resolverPeriodosMulti(granularidade, selA, availablePeriods),
    [granularidade, selA, availablePeriods],
  );
  const periodosB = useMemo(
    () => resolverPeriodosMulti(granularidade, selB, availablePeriods),
    [granularidade, selB, availablePeriods],
  );
  const allPeriodos = useMemo(
    () => Array.from(new Set([...periodosA, ...periodosB])).sort(),
    [periodosA, periodosB],
  );

  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const cgEstrutura = useCapitalGiroEstrutura(tenantId, companyId ?? "", periodosB);

  const { data: rows = [], isLoading } = useMonthlyStatement(companyId, tipo, allPeriodos);



  const labelA = rotuloSelecao(granularidade, selA);
  const labelB = rotuloSelecao(granularidade, selB);

  // Receita × Despesa detalhado — usado apenas pelo Ponto de Equilíbrio.
  const { data: rdAtual } = useReceitaDespesaDetalhado(
    companyId,
    periodosB,
    secao === "equilibrio",
  );


  // Mapeamento tipo_custo (fixo/variavel) para Ponto de Equilíbrio
  const { data: tipoCustoPlano = [] } = useQuery({
    queryKey: ["plano-tipo-custo", companyId],
    enabled: !!companyId && secao === "equilibrio",
    queryFn: async () => {
      const { data: c, error: ce } = await supabase
        .from("companies")
        .select("tenant_id")
        .eq("id", companyId!)
        .maybeSingle();
      if (ce) throw ce;
      const tenantId = (c as { tenant_id?: string } | null)?.tenant_id;
      if (!tenantId) return [] as { classificacao: string; tipo_custo: string | null }[];
      const { data, error } = await supabase
        .from("plano_contas")
        .select("classificacao, tipo_custo, company_id")
        .eq("tenant_id", tenantId)
        .or(`company_id.is.null,company_id.eq.${companyId}`)
        .not("tipo_custo", "is", null);
      if (error) throw error;
      const porCls = new Map<string, { classificacao: string; tipo_custo: string | null }>();
      for (const r of data ?? []) {
        if (r.company_id == null) porCls.set(r.classificacao, r);
      }
      for (const r of data ?? []) {
        if (r.company_id === companyId) porCls.set(r.classificacao, r);
      }
      return Array.from(porCls.values());
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });



  const compRows: CompRow[] = useMemo(() => {
    const ar = agregarPorPeriodos(rows as MonthlyRow[], tipo, periodosA).byLinha;
    const br = agregarPorPeriodos(rows as MonthlyRow[], tipo, periodosB).byLinha;
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
  }, [rows, periodosA, periodosB, tipo]);

  const { data: dreForHighlights = [] } = useMonthlyStatement(
    companyId,
    "DRE",
    tipo === "DRE" ? [] : allPeriodos,
  );
  const dreSource = (tipo === "DRE" ? rows : dreForHighlights) as MonthlyRow[];

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

  useEffect(() => {
    if (presentation) document.body.classList.add("presentation-mode");
    else document.body.classList.remove("presentation-mode");
    return () => document.body.classList.remove("presentation-mode");
  }, [presentation]);


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
          periodosA={selA}
          periodosB={selB}
          setPeriodosA={setSelA}
          setPeriodosB={setSelB}
          availablePeriods={availablePeriods}
        />
      </Card>

      <Tabs value={secao} onValueChange={setSecao}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="comparativo">Comparativo</TabsTrigger>
          <TabsTrigger value="equilibrio">Ponto de Equilíbrio</TabsTrigger>
          <TabsTrigger value="capitalGiro">Capital de Giro</TabsTrigger>
          <TabsTrigger value="analises">Análises</TabsTrigger>
        </TabsList>


        {/* ============ CAPITAL DE GIRO (estrutural) ============ */}
        <TabsContent value="capitalGiro" className="space-y-5 mt-5">
          {(() => {
            if (!cgEstrutura) {
              return (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  Nenhuma fórmula de Capital de Giro configurada. O escritório pode montá-la em
                  Configurações → Análises.
                </Card>
              );
            }
            if (cgEstrutura.carregando) {
              return (
                <Card className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando dados…
                </Card>
              );
            }
            return <CapitalGiroEstrutural dados={cgEstrutura} />;
          })()}
        </TabsContent>

        {/* ============ PONTO DE EQUILÍBRIO ============ */}
        <TabsContent value="equilibrio" className="space-y-5 mt-5">
          <p className="text-xs text-muted-foreground">
            Qual a receita mínima para a empresa não dar prejuízo? Quanto pode cair antes do vermelho?
          </p>
          {(() => {
            if (!rdAtual) {
              return (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  Carregando dados de despesa…
                </Card>
              );
            }
            // Coletar folhas de despesa com tipo_custo via matching de prefixo (mais longo)
            const folhas: DespesaItem[] = [];
            const walk = (n: NoArvore) => {
              if (n.filhos.length === 0 && n.classificacao) {
                folhas.push({
                  classificacao: n.classificacao,
                  descricao: n.descricao,
                  valor: Math.abs(n.valor),
                  tipo_custo: tipoCustoEfetivo(n.classificacao, tipoCustoPlano),
                });
              } else {
                n.filhos.forEach(walk);
              }
            };
            walk(rdAtual.raiz_despesa);
            const resultado = calcularPontoEquilibrio(rdAtual.receita_total, folhas);
            return <PontoEquilibrioPanel resultado={resultado} labelPeriodo={labelB} />;
          })()}
        </TabsContent>

        {/* ============ ANÁLISES CONFIGURÁVEIS ============ */}
        <TabsContent value="analises" className="space-y-5 mt-5">
          <p className="text-xs text-muted-foreground">
            Análises montadas pelo escritório com a mesma lógica de fórmulas dos indicadores.
          </p>
          {companyId && (
            <PainelAnalisesConfiguraveis
              tenantId={tenantId}
              companyId={companyId}
              periodos={periodosB}
            />
          )}
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

          {!presentation && compRows.length > 0 && (
            <ComparativoBarChart rows={compRows} labelA={labelA} labelB={labelB} />
          )}
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Carregando…</div>
          ) : (
            <ComparativoTable rows={compRows} labelA={labelA} labelB={labelB} presentation={presentation} />
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
