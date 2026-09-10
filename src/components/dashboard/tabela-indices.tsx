import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useVisaoGerencial } from "@/hooks/use-visao-gerencial";
import type { EngineContext, ResolverLinha } from "@/lib/indicadores/engine";
import {
  useIndicadorData,
  useDemoValues,
  useEstruturaPadrao,
  criarResolverLinha,
  isCtxPair,
  isDemoPair,
} from "@/hooks/use-indicador-data";
import type { DemoDre } from "@/lib/indicadores/linhas";
import {
  INDICES_DASHBOARD,
  formatarIndice,
  rotuloMes,
  type BasesIndice,
  type DefIndice,
} from "@/lib/dashboard/indices-financeiros";
import { ensureDashboardConfig, lerIndicesDashboard } from "@/lib/dashboard/ensure-config";
import {
  anoCurto,
  gruposMesAnoAAno,
  ordenarPeriodosMesAnoAAno,
} from "@/lib/dre-acumulo";

interface Props {
  tenantId: string | undefined;
  companyId: string | undefined;
  periodos: string[];
}

function n(v: number | null | undefined): number {
  return Number(v) || 0;
}

function basesDe(resolver: ResolverLinha, p: string): BasesIndice {
  return {
    ac: n(resolver("ATIVO_CIRCULANTE", p)),
    pc: n(resolver("PASSIVO_CIRCULANTE", p)),
    estoques: n(resolver("ESTOQUES", p)),
    disponivel: n(resolver("DISPONIVEL", p)),
    emprestimos: n(resolver("EMPRESTIMOS", p)),
    pl: n(resolver("PATRIMONIO_LIQUIDO", p)),
    lucroBruto: n(resolver("LUCRO_BRUTO", p)),
    ebitda: n(resolver("EBITDA", p)),
    lucroLiquido: n(resolver("LUCRO_LIQUIDO", p)),
    receitaLiquida: n(resolver("RECEITA_LIQUIDA", p)),
  };
}

export function TabelaIndices({ tenantId, companyId, periodos }: Props) {
  const { visao } = useVisaoGerencial();
  const comparativo = visao === "comparativo";
  const { data: ctxRaw, isLoading: loadCtx } = useIndicadorData(
    tenantId,
    companyId,
    visao,
  );
  const { data: demoRaw, isLoading: loadDemo } = useDemoValues(
    tenantId,
    companyId,
    periodos,
    visao,
  );
  const { data: estrutura } = useEstruturaPadrao();

  const { data: cfgIndices, isLoading: loadCfg } = useQuery({
    queryKey: ["dashboard-indices-visiveis", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      await ensureDashboardConfig(tenantId!);
      return lerIndicesDashboard(tenantId!);
    },
  });

  const linhas = useMemo(() => {
    const byKey = new Map((cfgIndices ?? []).map((r) => [r.key, r]));
    return INDICES_DASHBOARD
      .map((def) => {
        const row = byKey.get(def.key);
        return {
          def,
          visivel: row?.visivel ?? true,
          ordem: row?.ordem ?? 10_000,
        };
      })
      .filter((x) => x.visivel)
      .sort((a, b) => {
        if (a.def.key === "resultado") return -1;
        if (b.def.key === "resultado") return 1;
        return a.ordem - b.ordem || a.def.label.localeCompare(b.def.label);
      });
  }, [cfgIndices]);

  const ctxC: EngineContext | undefined = ctxRaw
    ? isCtxPair(ctxRaw)
      ? ctxRaw.contabil
      : ctxRaw
    : undefined;
  const ctxG: EngineContext | undefined = isCtxPair(ctxRaw)
    ? ctxRaw.gerencial
    : undefined;
  const demoC: DemoDre | undefined = demoRaw
    ? isDemoPair(demoRaw)
      ? demoRaw.contabil
      : demoRaw
    : undefined;
  const demoG: DemoDre | undefined = isDemoPair(demoRaw)
    ? demoRaw.gerencial
    : undefined;

  const resolverC = useMemo(
    () => criarResolverLinha(ctxC, demoC, estrutura),
    [ctxC, demoC, estrutura],
  );
  const resolverG = useMemo(
    () => (ctxG ? criarResolverLinha(ctxG, demoG, estrutura) : null),
    [ctxG, demoG, estrutura],
  );

  const ordenados = useMemo(() => ordenarPeriodosMesAnoAAno(periodos), [periodos]);
  const multiAno = useMemo(
    () => new Set(ordenados.map((p) => p.slice(0, 4))).size > 1,
    [ordenados],
  );
  const gruposYoY = useMemo(
    () => (multiAno ? gruposMesAnoAAno(ordenados) : []),
    [multiAno, ordenados],
  );

  const porPeriodo = useMemo(() => {
    const map = new Map<
      string,
      { c: Record<string, number | null>; g?: Record<string, number | null> }
    >();
    if (!ctxC) return map;
    for (const p of ordenados) {
      const bc = basesDe(resolverC, p);
      const c: Record<string, number | null> = {};
      for (const def of INDICES_DASHBOARD) c[def.key] = def.compute(bc);
      let g: Record<string, number | null> | undefined;
      if (comparativo && resolverG) {
        const bg = basesDe(resolverG, p);
        g = {};
        for (const def of INDICES_DASHBOARD) g[def.key] = def.compute(bg);
      }
      map.set(p, { c, g });
    }
    return map;
  }, [ctxC, resolverC, resolverG, ordenados, comparativo]);

  const loading = loadCtx || loadDemo || loadCfg;
  const colunasDados = comparativo ? ordenados.length * 2 : ordenados.length;
  const colSpan = colunasDados + 1;

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/20">
        <h3 className="text-base font-semibold leading-tight">Índices financeiros</h3>
        {comparativo && (
          <p className="text-xs text-muted-foreground mt-1">
            Em cada mês: <span className="text-muted-foreground">Cont.</span> = contábil
            {" · "}
            <span className="font-medium text-foreground">Ger.</span> = gerencial
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-max text-sm border-collapse">
          <thead>
            {comparativo && multiAno ? (
              <>
                <tr className="bg-muted/30">
                  <th
                    rowSpan={3}
                    className="text-left font-medium text-xs uppercase tracking-wider text-muted-foreground px-4 py-2.5 sticky left-0 z-10 bg-muted border-b align-bottom"
                  >
                    Indicador
                  </th>
                  {gruposYoY.map((g) => (
                    <th
                      key={g.mes}
                      colSpan={g.periodos.length * 2}
                      className="text-center font-medium text-xs text-muted-foreground px-2 pt-2.5 pb-0 whitespace-nowrap border-b border-l"
                    >
                      {g.rotulo}
                    </th>
                  ))}
                </tr>
                <tr className="bg-muted/30">
                  {gruposYoY.flatMap((g) =>
                    g.periodos.map((p) => (
                      <th
                        key={p}
                        colSpan={2}
                        className="text-center font-medium text-xs text-muted-foreground px-2 py-1 whitespace-nowrap border-b border-l"
                      >
                        {anoCurto(p)}
                      </th>
                    )),
                  )}
                </tr>
                <tr className="bg-muted/30 border-b">
                  {ordenados.map((p) => (
                    <MesSubcabecalhos key={p} />
                  ))}
                </tr>
              </>
            ) : comparativo ? (
              <>
                <tr className="bg-muted/30">
                  <th
                    rowSpan={2}
                    className="text-left font-medium text-xs uppercase tracking-wider text-muted-foreground px-4 py-2.5 sticky left-0 z-10 bg-muted border-b align-bottom"
                  >
                    Indicador
                  </th>
                  {ordenados.map((p) => (
                    <th
                      key={p}
                      colSpan={2}
                      className="text-center font-medium text-xs text-muted-foreground px-2 pt-2.5 pb-0 whitespace-nowrap border-b border-l"
                    >
                      {rotuloMes(p, multiAno)}
                    </th>
                  ))}
                </tr>
                <tr className="bg-muted/30 border-b">
                  {ordenados.map((p) => (
                    <MesSubcabecalhos key={p} />
                  ))}
                </tr>
              </>
            ) : multiAno ? (
              <>
                <tr className="bg-muted/30">
                  <th
                    rowSpan={2}
                    className="text-left font-medium text-xs uppercase tracking-wider text-muted-foreground px-4 py-2.5 sticky left-0 z-10 bg-muted border-b align-bottom"
                  >
                    Indicador
                  </th>
                  {gruposYoY.map((g) => (
                    <th
                      key={g.mes}
                      colSpan={g.periodos.length}
                      className="text-center font-medium text-xs text-muted-foreground px-3 pt-2.5 pb-0 whitespace-nowrap border-b border-l"
                    >
                      {g.rotulo}
                    </th>
                  ))}
                </tr>
                <tr className="border-b bg-muted/30">
                  {gruposYoY.flatMap((g) =>
                    g.periodos.map((p) => (
                      <th
                        key={p}
                        className="text-right font-medium text-xs text-muted-foreground px-3 py-1.5 whitespace-nowrap min-w-[6.5rem] border-l"
                      >
                        {anoCurto(p)}
                      </th>
                    )),
                  )}
                </tr>
              </>
            ) : (
              <tr className="border-b bg-muted/30">
                <th className="text-left font-medium text-xs uppercase tracking-wider text-muted-foreground px-4 py-2.5 sticky left-0 z-10 bg-muted whitespace-nowrap">
                  Indicador
                </th>
                {ordenados.map((p) => (
                  <th
                    key={p}
                    className="text-right font-medium text-xs text-muted-foreground px-3 py-2.5 whitespace-nowrap min-w-[6.5rem]"
                  >
                    {rotuloMes(p, false)}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-10 text-center text-muted-foreground">
                  Carregando índices…
                </td>
              </tr>
            )}
            {!loading && linhas.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-10 text-center text-muted-foreground">
                  Nenhuma linha visível. Ative-as em Configurações → Indicadores.
                </td>
              </tr>
            )}
            {!loading &&
              linhas.map(({ def }, i) => (
                <LinhaIndice
                  key={def.key}
                  def={def}
                  i={i}
                  comparativo={comparativo}
                  ordenados={ordenados}
                  porPeriodo={porPeriodo}
                  colSpan={colSpan}
                  destaque={def.key === "resultado"}
                  multiAno={multiAno}
                />
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MesSubcabecalhos() {
  return (
    <>
      <th className="text-right font-medium text-[11px] uppercase tracking-wide text-muted-foreground px-3 py-1.5 whitespace-nowrap border-l min-w-[5.5rem]">
        Cont.
      </th>
      <th className="text-right font-medium text-[11px] uppercase tracking-wide text-foreground/80 px-3 py-1.5 whitespace-nowrap bg-primary/[0.04] min-w-[5.5rem]">
        Ger.
      </th>
    </>
  );
}

function LinhaIndice({
  def,
  i,
  comparativo,
  ordenados,
  porPeriodo,
  colSpan,
  destaque,
  multiAno,
}: {
  def: DefIndice;
  i: number;
  comparativo: boolean;
  ordenados: string[];
  porPeriodo: Map<string, { c: Record<string, number | null>; g?: Record<string, number | null> }>;
  colSpan: number;
  destaque?: boolean;
  multiAno?: boolean;
}) {
  const [verFormula, setVerFormula] = useState(false);
  const zebra = !destaque && i % 2 === 1;
  return (
    <Fragment>
      <tr className={cn(
        "border-b border-border/60",
        destaque && "font-semibold bg-muted/40 border-b-2",
        zebra && "bg-muted/20",
      )}>
        <td
          className={cn(
            "px-4 py-2 sticky left-0 z-10 font-medium whitespace-nowrap",
            destaque ? "bg-muted" : zebra ? "bg-muted" : "bg-card",
          )}
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setVerFormula((v) => !v)}
              className="shrink-0 grid place-items-center h-5 w-5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              aria-expanded={verFormula}
              aria-label={verFormula ? "Ocultar fórmula" : "Ver fórmula"}
              title={verFormula ? "Ocultar fórmula" : "Ver fórmula"}
            >
              {verFormula ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
            {def.label}
          </div>
        </td>
        {ordenados.map((p) => {
          const cell = porPeriodo.get(p);
          const contabil = cell?.c[def.key] ?? null;
          const gerencial = cell?.g?.[def.key] ?? null;
          if (!comparativo) {
            return (
              <td
                key={p}
                className={cn(
                  "px-3 py-2 text-right tabular-nums whitespace-nowrap min-w-[6.5rem]",
                  multiAno && "border-l",
                )}
              >
                {formatarIndice(contabil, def.formato)}
              </td>
            );
          }
          return (
            <ParComparativo
              key={p}
              zebra={zebra}
              contabil={contabil}
              gerencial={gerencial}
              formato={def.formato}
            />
          );
        })}
      </tr>
      {verFormula && (
        <tr className={cn("border-b border-border/60", zebra && "bg-muted/20")}>
          <td
            colSpan={colSpan}
            className={cn(
              "px-4 py-2 pl-11 text-xs text-muted-foreground",
              zebra ? "bg-muted/30" : "bg-muted/10",
            )}
          >
            <span className="font-medium text-foreground/80">Fórmula: </span>
            {def.formula}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function ParComparativo({
  zebra,
  contabil,
  gerencial,
  formato,
}: {
  zebra: boolean;
  contabil: number | null;
  gerencial: number | null;
  formato: DefIndice["formato"];
}) {
  return (
    <>
      <td
        className={cn(
          "px-3 py-2 text-right tabular-nums whitespace-nowrap text-muted-foreground border-l min-w-[5.5rem]",
          zebra && "bg-muted/20",
        )}
      >
        {formatarIndice(contabil, formato)}
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium bg-primary/[0.04] min-w-[5.5rem]",
          zebra && "bg-primary/[0.07]",
        )}
      >
        {formatarIndice(gerencial, formato)}
      </td>
    </>
  );
}
