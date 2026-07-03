import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIndicadorData } from "@/hooks/use-indicador-data";
import {
  aplicarModo,
  calcularSerie,
  classificarFaixa,
  formatarValor,
  formulaParaTexto,
  type IndicadorEmpresa,
} from "@/lib/indicadores/engine";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/indicadores")({
  component: Page,
});

const CORES: Record<string, string> = {
  otimo: "text-emerald-600 border-emerald-500/40 bg-emerald-500/5",
  bom: "text-blue-600 border-blue-500/40 bg-blue-500/5",
  atencao: "text-amber-600 border-amber-500/40 bg-amber-500/5",
  critico: "text-destructive border-destructive/40 bg-destructive/5",
  neutro: "text-foreground border-border bg-card",
};

function Page() {
  const { companyId, company } = useDashboardCompany();
  const { periodos } = useFilters();

  const {
    data: indicadores,
    isLoading: loadingInd,
    error: errorInd,
  } = useQuery({
    queryKey: ["cliente-indicadores", companyId],
    enabled: !!companyId,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("indicadores_empresa" as any)
        .select("*")
        .eq("company_id", companyId!)
        .in("visibilidade", ["indicadores", "ambos"])
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
  } = useIndicadorData(
    company?.tenant_id ?? undefined,
    companyId ?? undefined,
  );

  const isLoading = loadingInd || loadingCtx;
  const carregamentoErro = errorInd ?? errorCtx;

  const [calcErro, setCalcErro] = useState<string | null>(null);

  const calculados = useMemo(() => {
    if (!ctx || !indicadores) return [];
    try {
      const out = indicadores.map((ind) => {
        const periodosUsar = periodos.length > 0 ? periodos : ctx.periodosDisponiveis;
        const serie = calcularSerie(ind, periodosUsar, ctx);
        const { serie: serieMostrar, valorPrincipal } = aplicarModo(serie, ind.modo_analise);
        const valor = valorPrincipal == null || !isFinite(valorPrincipal) ? null : valorPrincipal;
        const faixa = classificarFaixa(valor, ind.faixas);
        return { ind, serie: serieMostrar, valor, faixa };
      });
      setCalcErro(null);
      return out;
    } catch (e: any) {
      // Nunca deixa a tela travada: registra erro e devolve lista vazia
      console.error("[indicadores] erro no cálculo:", e);
      setCalcErro(e?.message ?? String(e));
      return [];
    }
  }, [ctx, indicadores, periodos]);

  const porCategoria = useMemo(() => {
    const m = new Map<string, typeof calculados>();
    for (const c of calculados) {
      const key = c.ind.categoria || "Personalizado";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(c);
    }
    return Array.from(m.entries());
  }, [calculados]);

  const periodoLabel =
    periodos.length === 0
      ? "todos os períodos disponíveis"
      : periodos.length === 1
      ? periodos[0].slice(0, 7)
      : `${periodos[0].slice(0, 7)} a ${periodos[periodos.length - 1].slice(0, 7)}`;

  const semIndicadores = !isLoading && !carregamentoErro && (indicadores?.length ?? 0) === 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Indicadores</h2>
        <p className="mt-1 text-sm text-muted-foreground">{periodoLabel}</p>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Calculando…</div>}

      {!isLoading && carregamentoErro && (
        <Card className="p-6 text-sm border-destructive/40 bg-destructive/5">
          <div className="font-semibold text-destructive mb-1">Erro ao carregar indicadores</div>
          <div className="text-muted-foreground">{(carregamentoErro as Error).message}</div>
        </Card>
      )}

      {!isLoading && !carregamentoErro && calcErro && (
        <Card className="p-6 text-sm border-destructive/40 bg-destructive/5">
          <div className="font-semibold text-destructive mb-1">Erro no cálculo do indicador</div>
          <div className="text-muted-foreground">{calcErro}</div>
        </Card>
      )}

      {semIndicadores && (
        <Card className="p-6 text-sm text-muted-foreground text-center">
          Nenhum indicador configurado para esta empresa. Fale com seu contador.
        </Card>
      )}

      {porCategoria.map(([cat, items]) => (
        <section key={cat}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{cat}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map(({ ind, valor, serie, faixa }) => (
              <Card key={ind.id} className={cn("p-4 border", CORES[faixa])}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="font-semibold truncate">{ind.nome}</h4>
                    <p className="text-[11px] font-mono text-muted-foreground truncate">
                      {formulaParaTexto(ind.formula, () => "")}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[9px]">{ind.categoria}</Badge>
                </div>
                <div className="mt-3 text-2xl font-semibold tabular-nums">
                  {formatarValor(valor, ind.modo_analise)}
                </div>
                {serie.length > 1 && (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {serie.map((p) => (
                      <span key={p.periodo}>
                        {p.periodo.slice(0, 7)}: <span className="font-mono">{formatarValor(p.valor, ind.modo_analise)}</span>
                      </span>
                    ))}
                  </div>
                )}
                {ind.descricao && (
                  <p className="mt-2 text-[11px] text-muted-foreground">{ind.descricao}</p>
                )}
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
