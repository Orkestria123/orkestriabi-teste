// Renderização no dashboard das análises configuradas pelo escritório
// (Admin → Análises). Também expõe o hook da NCG configurada para a
// aba Capital de Giro.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  serieAnalise,
  useAnaliseConfigs,
  type AnaliseConfigRow,
} from "@/lib/analise-configs";
import {
  useDemoValues,
  useEstruturaPadrao,
  useIndicadorData,
  criarResolverLinha,
  isCtxPair,
  isDemoPair,
} from "@/hooks/use-indicador-data";
import {
  aplicarModo,
  avaliarExpressao,
  formatarValor,
  formulaParaTexto,
  tokensDaFormula,
  valoresTermosFormula,
  type EngineContext,
  type ModoAnalise,
  type SeriePonto,
} from "@/lib/indicadores/engine";
import { labelLinha } from "@/lib/indicadores/linhas";
import { formatBRLCompact } from "@/lib/format";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE } from "@/lib/chart-config";

export interface NcgConfigurada {
  valor: number | null;
  componentes: { label: string; valor: number | null }[];
}

interface CalcAnalise {
  config: AnaliseConfigRow;
  serie: SeriePonto[];
  valorPrincipal: number | null;
}

function rotuloCtx(ctx: EngineContext, ref: string): string {
  const p = (ctx.planoByClass.get(ref) ??
    ctx.planoByCodigo.get(ref)) as { descricao?: string } | undefined;
  return p?.descricao ? `${ref} · ${p.descricao}` : ref;
}

function labelPeriodo(p: string): string {
  if (/^\d{4}$/.test(p)) return p;
  const d = new Date(`${p}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return p;
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function tickFmt(v: number, modo: ModoAnalise): string {
  if (modo === "reais") return formatBRLCompact(v);
  if (modo === "percentual") return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/** Avalia todas as análises visíveis do tenant para os períodos dados. */
export function useAvaliacaoAnalises(
  tenantId: string | null | undefined,
  companyId: string,
  periodos: string[],
) {
  const { data: configs = [], isLoading: loadCfg } = useAnaliseConfigs(tenantId, true);
  const ativo = !!tenantId && !!companyId && !loadCfg && configs.length > 0 && periodos.length > 0;

  const { data: ctxPair, isLoading: l1 } = useIndicadorData(
    ativo ? (tenantId ?? undefined) : undefined,
    companyId,
    "contabil",
  );
  const { data: demoPair, isLoading: l2 } = useDemoValues(
    ativo ? (tenantId ?? undefined) : undefined,
    companyId,
    periodos,
    "contabil",
  );
  const { data: estrutura, isLoading: l3 } = useEstruturaPadrao();

  const calc = useMemo<CalcAnalise[]>(() => {
    if (!ativo || !ctxPair || !demoPair) return [];
    const ctx = (isCtxPair(ctxPair) ? ctxPair.contabil : ctxPair) as EngineContext;
    const demo = isDemoPair(demoPair) ? demoPair.contabil : demoPair;
    const resolver = criarResolverLinha(ctx, demo, estrutura);
    return configs.map((cfg) => {
      const serieCrua = serieAnalise(cfg.formula, periodos, ctx, resolver);
      const { serie, valorPrincipal } = aplicarModo(serieCrua, cfg.formato as ModoAnalise);
      return { config: cfg, serie, valorPrincipal };
    });
  }, [ativo, ctxPair, demoPair, estrutura, configs, periodos]);

  return { carregando: loadCfg || (ativo && (l1 || l2 || l3)), calc };
}

/** NCG calculada pela fórmula configurada (seção Capital de Giro). */
export function useNcgConfigurada(
  tenantId: string | null | undefined,
  companyId: string,
  periodos: string[],
): NcgConfigurada | null {
  const { data: configs } = useAnaliseConfigs(tenantId, true);
  const cfg = useMemo(
    () => configs?.find((c) => c.secao === "capital_giro") ?? null,
    [configs],
  );
  const ativo = !!cfg && !!tenantId && !!companyId && periodos.length > 0;
  const { data: ctxPair } = useIndicadorData(
    ativo ? (tenantId ?? undefined) : undefined,
    companyId,
    "contabil",
  );
  const { data: demoPair } = useDemoValues(
    ativo ? (tenantId ?? undefined) : undefined,
    companyId,
    periodos,
    "contabil",
  );
  const { data: estrutura } = useEstruturaPadrao();

  return useMemo(() => {
    if (!cfg || !ctxPair || !demoPair) return null;
    const ctx = (isCtxPair(ctxPair) ? ctxPair.contabil : ctxPair) as EngineContext;
    const demo = (isDemoPair(demoPair) ? demoPair.contabil : demoPair) as DemoDre | undefined;
    const resolver = criarResolverLinha(ctx, demo, estrutura);
    const tokens = tokensDaFormula(cfg.formula);
    const ultimo = periodos[periodos.length - 1];
    const valor = avaliarExpressao(tokens, ultimo, ctx, resolver);

    // Componentes com sinal: o operador ANTES do termo define soma/subtração.
    const termos = valoresTermosFormula(tokens, ultimo, ctx, resolver, labelLinha);
    const comps: { label: string; valor: number | null }[] = [];
    let i = 0;
    let pend: "+" | "-" = "+";
    for (const t of tokens) {
      if (t.tipo === "operador") pend = t.valor === "-" ? "-" : "+";
      else if (t.tipo === "termo") {
        const tt = termos[i++];
        if (!tt || t.origem === "demonstracao" || t.linha) continue;
        const refs = t.contas ?? [];
        const label = refs.map((r) => rotuloCtx(ctx, r)).join(" + ") || "(sem contas)";
        comps.push({
          label,
          valor: tt.valor == null ? null : pend === "-" ? -Math.abs(tt.valor) : tt.valor,
        });
      }
    }
    return { valor, componentes: comps };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, ctxPair, demoPair, estrutura, periodos.join(",")]);
}

// ============================================================
// Painel da aba "Análises" no dashboard
// ============================================================

export function PainelAnalisesConfiguraveis({
  tenantId,
  companyId,
  periodos,
}: {
  tenantId: string | null | undefined;
  companyId: string;
  periodos: string[];
}) {
  const { carregando, calc } = useAvaliacaoAnalises(tenantId, companyId, periodos);

  if (carregando) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Carregando análises…
      </Card>
    );
  }
  if (calc.length === 0) {
    return (
      <Card className="p-8 text-center space-y-2">
        <p className="text-sm font-medium">Nenhuma análise configurada.</p>
        <p className="text-xs text-muted-foreground">
          O escritório monta análises com a mesma lógica de fórmulas dos indicadores em{" "}
          <Link to="/admin/analises" className="text-primary underline">
            Admin → Análises
          </Link>
          .
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {calc.map((c) => (
        <CardAnalise key={c.config.id} c={c} />
      ))}
    </div>
  );
}

function CardAnalise({ c }: { c: CalcAnalise }) {
  const { config: cfg, serie, valorPrincipal } = c;
  const ctxParaRotulo = null; // rótulos de conta usam só o código aqui
  void ctxParaRotulo;
  const textoFormula = formulaParaTexto(cfg.formula, (ref) => ref, labelLinha);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
        <div>
          <h3 className="text-sm font-semibold">{cfg.nome}</h3>
          {cfg.descricao && (
            <p className="text-xs text-muted-foreground mt-0.5">{cfg.descricao}</p>
          )}
        </div>
        {cfg.grafico === "valor" && valorPrincipal != null && (
          <p className="text-2xl font-semibold tabular-nums">
            {formatarValor(valorPrincipal, cfg.formato as ModoAnalise)}
          </p>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">{textoFormula}</p>

      {cfg.grafico === "valor" ? (
        <MiniSerie serie={serie} formato={cfg.formato} />
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            {cfg.grafico === "barra" ? (
              <BarChart data={serie.map((p) => ({ periodo: labelPeriodo(p.periodo), valor: p.valor }))} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="periodo" {...AXIS_PROPS} />
                <YAxis tickFormatter={(v) => tickFmt(Number(v), cfg.formato as ModoAnalise)} {...AXIS_PROPS} width={80} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: any) => formatarValor(Number(v), cfg.formato as ModoAnalise)}
                />
                <Bar dataKey="valor" fill="var(--chart-1)" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
              </BarChart>
            ) : cfg.grafico === "area" ? (
              <AreaChart data={serie.map((p) => ({ periodo: labelPeriodo(p.periodo), valor: p.valor }))} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-analise" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="periodo" {...AXIS_PROPS} />
                <YAxis tickFormatter={(v) => tickFmt(Number(v), cfg.formato as ModoAnalise)} {...AXIS_PROPS} width={80} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: any) => formatarValor(Number(v), cfg.formato as ModoAnalise)}
                />
                <Area type="monotone" dataKey="valor" stroke="var(--chart-1)" strokeWidth={2} fill="url(#grad-analise)" />
              </AreaChart>
            ) : (
              <LineChart data={serie.map((p) => ({ periodo: labelPeriodo(p.periodo), valor: p.valor }))} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="periodo" {...AXIS_PROPS} />
                <YAxis tickFormatter={(v) => tickFmt(Number(v), cfg.formato as ModoAnalise)} {...AXIS_PROPS} width={80} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: any) => formatarValor(Number(v), cfg.formato as ModoAnalise)}
                />
                <Line type="monotone" dataKey="valor" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

/** Sparkline discreta usada sob o KPI do tipo "valor". */
function MiniSerie({ serie, formato }: { serie: SeriePonto[]; formato: string }) {
  const pontos = serie.filter((p) => p.valor != null);
  if (pontos.length < 2) return null;
  const modo = formato as ModoAnalise;
  const penultimo = pontos[pontos.length - 2].valor;
  const ultimo = pontos[pontos.length - 1].valor!;
  const variacao = penultimo != null && penultimo !== 0
    ? ((ultimo - penultimo) / Math.abs(penultimo)) * 100
    : null;
  return (
    <div className="flex items-center gap-4">
      <div className="h-14 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={serie.map((p) => ({ periodo: labelPeriodo(p.periodo), valor: p.valor }))}>
            <Line type="monotone" dataKey="valor" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: any) => formatarValor(Number(v), modo)}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {variacao != null && Number.isFinite(variacao) && (
        <p className="text-xs font-medium whitespace-nowrap">
          {variacao >= 0 ? "▲" : "▼"} {Math.abs(variacao).toFixed(1).replace(".", ",")}% vs. período anterior
        </p>
      )}
    </div>
  );
}
