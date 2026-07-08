// Grade de indicadores para a visão do cliente.
// Reutilizado tanto na aba /dashboard/indicadores quanto no /dashboard (home),
// filtrando por visibilidade.
//
// Etapa 6 (Visão Gerencial): a grade respeita o seletor global de visão.
//  - contabil   → calcula sobre o ctx contábil (comportamento original)
//  - gerencial  → calcula sobre o ctx gerencial (contábil + ajustes)
//  - comparativo→ calcula os dois e passa ambos para o card, que exibe
//                 lado a lado com a diferença.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useIndicadorData,
  useDemoValues,
  criarResolverLinha,
  isCtxPair,
  isDemoPair,
} from "@/hooks/use-indicador-data";
import {
  aplicarModo,
  calcularSerie,
  classificarFaixa,
  type EngineContext,
  type IndicadorEmpresa,
  type SeriePonto,
  type Visibilidade,
} from "@/lib/indicadores/engine";
import type { DemoDre } from "@/lib/indicadores/linhas";
import { Card } from "@/components/ui/card";
import { IndicadorCardCliente } from "./indicador-card-cliente";
import { useVisaoGerencial } from "@/hooks/use-visao-gerencial";

interface Props {
  tenantId: string | undefined;
  companyId: string | undefined;
  periodos: string[]; // períodos selecionados no filtro do cliente
  visibilidade: Visibilidade[]; // ex: ["indicadores","ambos"] ou ["dashboard","ambos"]
  compacto?: boolean; // no dashboard-home mostra só o valor principal (sem série)
  emptyMessage?: string;
  hideWhenEmpty?: boolean;
}

function computeOne(
  ind: IndicadorEmpresa,
  periodos: string[],
  ctx: EngineContext,
  demoDre: DemoDre | undefined,
) {
  const resolver = criarResolverLinha(ctx, demoDre);
  const serie = calcularSerie(ind, periodos, ctx, resolver);
  const { serie: serieMostrar, valorPrincipal } = aplicarModo(serie, ind.modo_analise);
  const valor = valorPrincipal == null || !isFinite(valorPrincipal) ? null : valorPrincipal;
  return { serie: serieMostrar, valor };
}

export function IndicadoresClienteGrid({
  tenantId, companyId, periodos, visibilidade, emptyMessage, hideWhenEmpty,
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
      const { data, error } = await supabase
        .from("indicadores_empresa" as any)
        .select("*")
        .eq("company_id", companyId!)
        .in("visibilidade", visibilidade)
        .order("categoria")
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as IndicadorEmpresa[];
    },
  });

  const {
    data: ctxData,
    isLoading: loadingCtx,
    error: errorCtx,
  } = useIndicadorData(tenantId, companyId, visao);

  // Um ctx qualquer só para descobrir períodos disponíveis quando o filtro estiver vazio.
  const ctxSample: EngineContext | undefined = ctxData
    ? isCtxPair(ctxData) ? ctxData.contabil : ctxData
    : undefined;

  const periodosEfetivos = periodos.length > 0 ? periodos : (ctxSample?.periodosDisponiveis ?? []);
  const {
    data: demoData,
    isLoading: loadingDemo,
  } = useDemoValues(tenantId, companyId, periodosEfetivos, visao);

  const isLoading = loadingInd || loadingCtx || loadingDemo;
  const carregamentoErro = errorInd ?? errorCtx;
  const [calcErro, setCalcErro] = useState<string | null>(null);

  const calculados = useMemo(() => {
    if (!ctxData || !indicadores) return [] as Array<{
      ind: IndicadorEmpresa;
      serie: SeriePonto[];
      valor: number | null;
      faixa: ReturnType<typeof classificarFaixa>;
      serieGerencial?: SeriePonto[];
      valorGerencial?: number | null;
      faixaGerencial?: ReturnType<typeof classificarFaixa>;
      isComparativo?: boolean;
    }>;
    try {
      const isDual = isCtxPair(ctxData);
      const out = indicadores.map((ind) => {
        const periodosUsar =
          periodos.length > 0
            ? periodos
            : (isDual ? ctxData.contabil : ctxData).periodosDisponiveis;

        if (isDual && isDemoPair(demoData)) {
          const c = computeOne(ind, periodosUsar, ctxData.contabil, demoData.contabil);
          const g = computeOne(ind, periodosUsar, ctxData.gerencial, demoData.gerencial);
          return {
            ind,
            serie: c.serie,
            valor: c.valor,
            faixa: classificarFaixa(c.valor, ind.faixas),
            serieGerencial: g.serie,
            valorGerencial: g.valor,
            faixaGerencial: classificarFaixa(g.valor, ind.faixas),
            isComparativo: true,
          };
        }
        const ctxSingle = ctxData as EngineContext;
        const demoSingle = (demoData as DemoDre | undefined) ?? undefined;
        const r = computeOne(ind, periodosUsar, ctxSingle, demoSingle);
        return {
          ind,
          serie: r.serie,
          valor: r.valor,
          faixa: classificarFaixa(r.valor, ind.faixas),
        };
      });
      setCalcErro(null);
      return out;
    } catch (e: any) {
      console.error("[indicadores] erro no cálculo:", e);
      setCalcErro(e?.message ?? String(e));
      return [];
    }
  }, [ctxData, indicadores, periodos, demoData]);

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

      {porCategoria.map(([cat, items]) => (
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
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
