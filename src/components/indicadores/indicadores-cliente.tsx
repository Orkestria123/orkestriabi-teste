// Grade de indicadores para a visão do cliente.
// Reutilizado tanto na aba /dashboard/indicadores quanto no /dashboard (home),
// filtrando por visibilidade.
//
// Etapa 6 (Visão Gerencial): a grade respeita o seletor global de visão.
//  - contabil   → calcula sobre o ctx contábil (comportamento original)
//  - gerencial  → calcula sobre o ctx gerencial (contábil + ajustes)
//  - comparativo→ calcula os dois e passa ambos para o card, que exibe
//                 lado a lado com a diferença.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useIndicadorData,
  useDemoValues,
  criarResolverLinha,
  useEstruturaPadrao,
  isCtxPair,
  isDemoPair,
} from "@/hooks/use-indicador-data";
import {
  aplicarModo,
  calcularSerie,
  calcularSerieComBase,
  classificarFaixa,
  valoresTermosFormula,
  tokensDaFormula,
  tokensComBaseReceita,
  type EngineContext,
  type IndicadorEmpresa,
  type SeriePonto,
  type Visibilidade,
} from "@/lib/indicadores/engine";
import { labelLinha, valorEbitEbitdaDaDre, type DemoDre } from "@/lib/indicadores/linhas";
import { nomeBateIndicadorEbit } from "@/lib/indicadores/ebit-fonte";
import type { PapelEstrutura } from "@/lib/plano/estrutura";
import { Card } from "@/components/ui/card";
import { IndicadorCardCliente } from "./indicador-card-cliente";
import { useVisaoGerencial } from "@/hooks/use-visao-gerencial";

type BaseAV = "rb" | "rl";

interface Props {
  tenantId: string | undefined;
  companyId: string | undefined;
  periodos: string[]; // períodos selecionados no filtro do cliente
  visibilidade: Visibilidade[]; // ex: ["indicadores","ambos"] ou ["dashboard","ambos"]
  compacto?: boolean; // no dashboard-home mostra só o valor principal (sem série)
  emptyMessage?: string;
  hideWhenEmpty?: boolean;
  baseAV?: BaseAV;
}

function computeOne(
  ind: IndicadorEmpresa,
  periodos: string[],
  ctx: EngineContext,
  demoDre: DemoDre | undefined,
  estruturaPadrao: PapelEstrutura[] | undefined,
  baseAV?: BaseAV,
) {
  const alvoEbit = nomeBateIndicadorEbit(ind.nome, "ebitda")
    ? "EBITDA"
    : nomeBateIndicadorEbit(ind.nome, "ebit")
      ? "EBIT"
      : null;
  if (alvoEbit) {
    const serie = periodos.map((p) => ({
      periodo: p,
      valor: valorEbitEbitdaDaDre(demoDre, alvoEbit, p),
    }));
    const { serie: serieMostrar, valorPrincipal } = aplicarModo(serie, ind.modo_analise);
    const valor = valorPrincipal == null || !isFinite(valorPrincipal) ? null : valorPrincipal;
    return { serie: serieMostrar, valor, termos: [] };
  }
  const resolver = criarResolverLinha(ctx, demoDre, estruturaPadrao);
  const tokens = tokensComBaseReceita(tokensDaFormula(ind.formula), baseAV);
  const usaBase = !!baseAV;
  const serie = usaBase
    ? calcularSerieComBase(ind, periodos, ctx, resolver, baseAV)
    : calcularSerie(ind, periodos, ctx, resolver);

  const { serie: serieMostrar, valorPrincipal } = aplicarModo(serie, ind.modo_analise);
  const valor = valorPrincipal == null || !isFinite(valorPrincipal) ? null : valorPrincipal;
  const periodo = periodos[periodos.length - 1];
  const termos = periodo
    ? valoresTermosFormula(tokens, periodo, ctx, resolver, labelLinha)
    : [];
  return { serie: serieMostrar, valor, termos };
}

export function IndicadoresClienteGrid({
  tenantId, companyId, periodos, visibilidade, emptyMessage, hideWhenEmpty,
  baseAV,
}: Props) {
  const { visao } = useVisaoGerencial();

  const {
    data: indicadores,
    isLoading: loadingInd,
    error: errorInd,
  } = useQuery({
    queryKey: ["cliente-indicadores", companyId, visibilidade.join(",")],
    enabled: !!companyId,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("indicadores_da_empresa", {
        _company_id: companyId,
      });
      if (error) throw error;
      const vis = new Set(visibilidade);
      return ((data ?? []) as any[])
        .filter((i) => vis.has(i.visibilidade))
        .sort((a, b) =>
          (a.categoria ?? "").localeCompare(b.categoria ?? "") ||
          (a.ordem ?? 0) - (b.ordem ?? 0) ||
          a.nome.localeCompare(b.nome)) as unknown as IndicadorEmpresa[];
    },
  });

  const {
    data: ctxData,
    isLoading: loadingCtx,
    error: errorCtx,
  } = useIndicadorData(tenantId, companyId, visao);

  const ctxSample: EngineContext | undefined = ctxData
    ? isCtxPair(ctxData) ? ctxData.contabil : ctxData
    : undefined;

  const periodosEfetivos = periodos.length > 0 ? periodos : (ctxSample?.periodosDisponiveis ?? []);
  const {
    data: demoData,
    isLoading: loadingDemo,
  } = useDemoValues(tenantId, companyId, periodosEfetivos, visao);

  const { data: estruturaPadrao, isLoading: loadingEstrutura } = useEstruturaPadrao();

  const isLoading = loadingInd || loadingCtx || loadingDemo || loadingEstrutura;
  const carregamentoErro = errorInd ?? errorCtx;

  const { lista: calculados, erro: calcErro } = useMemo((): {
    lista: Array<{
      ind: IndicadorEmpresa;
      serie: SeriePonto[];
      valor: number | null;
      faixa: ReturnType<typeof classificarFaixa>;
      termos: { label: string; valor: number | null; origem: string }[];
      serieGerencial?: SeriePonto[];
      valorGerencial?: number | null;
      faixaGerencial?: ReturnType<typeof classificarFaixa>;
      isComparativo?: boolean;
    }>;
    erro: string | null;
  } => {
    if (!ctxData || !indicadores || !demoData) return { lista: [], erro: null };
    try {
      const isDual = isCtxPair(ctxData);
      const out = indicadores.map((ind) => {
        const periodosUsar =
          periodos.length > 0
            ? periodos
            : (isDual ? ctxData.contabil : ctxData).periodosDisponiveis;

        if (isDual && isDemoPair(demoData)) {
          const c = computeOne(ind, periodosUsar, ctxData.contabil, demoData.contabil, estruturaPadrao, baseAV);
          const g = computeOne(ind, periodosUsar, ctxData.gerencial, demoData.gerencial, estruturaPadrao, baseAV);
          return {
            ind,
            serie: c.serie,
            valor: c.valor,
            faixa: classificarFaixa(c.valor, ind.faixas),
            termos: c.termos,
            serieGerencial: g.serie,
            valorGerencial: g.valor,
            faixaGerencial: classificarFaixa(g.valor, ind.faixas),
            isComparativo: true,
          };
        }
        const ctxSingle = ctxData as EngineContext;
        const demoSingle = (demoData as DemoDre | undefined) ?? undefined;
        const r = computeOne(ind, periodosUsar, ctxSingle, demoSingle, estruturaPadrao, baseAV);
        return {
          ind,
          serie: r.serie,
          valor: r.valor,
          faixa: classificarFaixa(r.valor, ind.faixas),
          termos: r.termos,
        };
      });
      return { lista: out, erro: null };
    } catch (e: any) {
      console.error("[indicadores] erro no cálculo:", e);
      return { lista: [], erro: e?.message ?? String(e) };
    }
  }, [ctxData, indicadores, periodos, demoData, estruturaPadrao, baseAV]);

  const porCategoria = useMemo(() => {
    const m = new Map<string, typeof calculados>();
    for (const c of calculados) {
      const key = c.ind.categoria || "Personalizado";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(c);
    }
    return Array.from(m.entries());
  }, [calculados]);

  const nada = !isLoading && !carregamentoErro && (indicadores?.length ?? 0) === 0;
  if (nada && hideWhenEmpty) return null;

  return (
    <div className="space-y-4">
      {isLoading && <div className="text-sm text-muted-foreground">Calculando…</div>}

      {!isLoading && carregamentoErro && (
        <Card className="p-4 text-sm border-destructive/40 bg-destructive/5">
          <div className="font-semibold text-destructive mb-1">Erro ao carregar indicadores</div>
          <div className="text-muted-foreground">{(carregamentoErro as Error).message}</div>
        </Card>
      )}

      {!isLoading && !carregamentoErro && calcErro && (
        <Card className="p-4 text-sm border-destructive/40 bg-destructive/5">
          <div className="font-semibold text-destructive mb-1">Erro no cálculo do indicador</div>
          <div className="text-muted-foreground">{calcErro}</div>
        </Card>
      )}

      {nada && !hideWhenEmpty && (
        <Card className="p-6 text-sm text-muted-foreground text-center">
          {emptyMessage ?? "Nenhum indicador configurado para esta empresa."}
        </Card>
      )}

      {!isLoading && porCategoria.map(([cat, items]) => (
        <section key={cat}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{cat}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c) => (
              <IndicadorCardCliente
                key={c.ind.id}
                ind={c.ind}
                serie={c.serie}
                valor={c.valor}
                faixa={c.faixa}
                visao={visao}
                serieGerencial={c.serieGerencial}
                valorGerencial={c.valorGerencial}
                faixaGerencial={c.faixaGerencial}
                termos={c.termos}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}