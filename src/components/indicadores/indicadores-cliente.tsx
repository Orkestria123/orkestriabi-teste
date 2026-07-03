// Grade de indicadores para a visão do cliente.
// Reutilizado tanto na aba /dashboard/indicadores quanto no /dashboard (home),
// filtrando por visibilidade.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIndicadorData, useDemoValues, criarResolverLinha } from "@/hooks/use-indicador-data";
import {
  aplicarModo,
  calcularSerie,
  classificarFaixa,
  type IndicadorEmpresa,
  type Visibilidade,
} from "@/lib/indicadores/engine";
import { Card } from "@/components/ui/card";
import { IndicadorCardCliente } from "./indicador-card-cliente";

interface Props {
  tenantId: string | undefined;
  companyId: string | undefined;
  periodos: string[]; // períodos selecionados no filtro do cliente
  visibilidade: Visibilidade[]; // ex: ["indicadores","ambos"] ou ["dashboard","ambos"]
  compacto?: boolean; // no dashboard-home mostra só o valor principal (sem série)
  emptyMessage?: string;
  hideWhenEmpty?: boolean;
}

export function IndicadoresClienteGrid({
  tenantId, companyId, periodos, visibilidade, compacto, emptyMessage, hideWhenEmpty,
}: Props) {
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
    data: ctx,
    isLoading: loadingCtx,
    error: errorCtx,
  } = useIndicadorData(tenantId, companyId);

  const periodosEfetivos = periodos.length > 0 ? periodos : (ctx?.periodosDisponiveis ?? []);
  const {
    data: demoDre,
    isLoading: loadingDemo,
  } = useDemoValues(tenantId, companyId, periodosEfetivos);

  const isLoading = loadingInd || loadingCtx || loadingDemo;
  const carregamentoErro = errorInd ?? errorCtx;
  const [calcErro, setCalcErro] = useState<string | null>(null);

  const calculados = useMemo(() => {
    if (!ctx || !indicadores) return [];
    try {
      const resolver = criarResolverLinha(ctx, demoDre);
      const out = indicadores.map((ind) => {
        const periodosUsar = periodos.length > 0 ? periodos : ctx.periodosDisponiveis;
        const serie = calcularSerie(ind, periodosUsar, ctx, resolver);
        const { serie: serieMostrar, valorPrincipal } = aplicarModo(serie, ind.modo_analise);
        const valor = valorPrincipal == null || !isFinite(valorPrincipal) ? null : valorPrincipal;
        const faixa = classificarFaixa(valor, ind.faixas);
        return { ind, serie: serieMostrar, valor, faixa };
      });
      setCalcErro(null);
      return out;
    } catch (e: any) {
      console.error("[indicadores] erro no cálculo:", e);
      setCalcErro(e?.message ?? String(e));
      return [];
    }
  }, [ctx, indicadores, periodos, demoDre]);

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
            {items.map(({ ind, valor, serie, faixa }) => (
              <IndicadorCardCliente
                key={ind.id}
                ind={ind}
                serie={compacto ? serie.slice(-1) : serie}
                valor={valor}
                faixa={faixa}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
