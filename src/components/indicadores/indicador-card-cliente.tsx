// Card de indicador (visão do cliente) com gráfico de evolução em destaque.
// 1 período  -> número grande e limpo.
// 2+ períodos -> AreaChart com gradiente, hover, último ponto destacado
//                e (opcional) faixa saudável como banda de fundo.
// Análise em linguagem clara gerada por IA (cache por indicador+série).

import { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  formatarValor,
  formulaParaTexto,
  type FaixaChave,
  type Faixas,
  type IndicadorEmpresa,
  type ModoAnalise,
  type SeriePonto,
} from "@/lib/indicadores/engine";
import { labelLinha } from "@/lib/indicadores/linhas";
import { explicarIndicador } from "@/lib/api/indicador-explicacao.functions";
import { Sparkles } from "lucide-react";


interface Props {
  ind: IndicadorEmpresa;
  serie: SeriePonto[]; // já no modo de exibição (aplicarModo)
  valor: number | null;
  faixa: FaixaChave;
  onClick?: () => void;
}

const FAIXA_COLOR: Record<FaixaChave, string> = {
  otimo: "var(--success, #10b981)",
  bom: "#22c55e",
  atencao: "var(--warning, #f59e0b)",
  critico: "var(--destructive)",
  neutro: "var(--primary)",
};

const FAIXA_LABEL: Record<FaixaChave, string> = {
  otimo: "Ótimo",
  bom: "Bom",
  atencao: "Atenção",
  critico: "Crítico",
  neutro: "—",
};

const FAIXA_BADGE: Record<FaixaChave, string> = {
  otimo: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  bom: "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300",
  atencao: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  critico: "border-destructive/40 bg-destructive/10 text-destructive",
  neutro: "border-border bg-muted text-muted-foreground",
};

function formatMes(periodo: string) {
  // "YYYY-MM-01" -> "Jan/25"
  const [y, m] = periodo.split("-");
  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${meses[Number(m) - 1] ?? m}/${y.slice(2)}`;
}

/** Escala faixas para a mesma unidade da série plotada. */
function faixasNoMesmoEscalar(faixas: Faixas | null | undefined, modo: ModoAnalise): Faixas | null {
  if (!faixas) return null;
  const mul = modo === "percentual" ? 100 : 1;
  return {
    direcao: faixas.direcao ?? "maior_melhor",
    otimo: faixas.otimo != null ? faixas.otimo * mul : null,
    bom: faixas.bom != null ? faixas.bom * mul : null,
    atencao: faixas.atencao != null ? faixas.atencao * mul : null,
    critico: faixas.critico != null ? faixas.critico * mul : null,
  };
}

export function IndicadorCardCliente({ ind, serie, valor, faixa, onClick }: Props) {
  const uid = useId().replace(/:/g, "");
  const cor = FAIXA_COLOR[faixa];
  const pontos = useMemo(
    () =>
      serie.map((p) => ({
        periodo: p.periodo,
        mes: formatMes(p.periodo),
        valor: p.valor == null || !isFinite(p.valor) ? null : p.valor,
      })),
    [serie],
  );
  const ultimoIdx = pontos.length - 1;
  const temSerie = pontos.filter((p) => p.valor != null).length >= 2;
  const faixasEsc = faixasNoMesmoEscalar(ind.faixas, ind.modo_analise);
  const formulaTexto = formulaParaTexto(ind.formula, () => "", labelLinha);

  const explicarFn = useServerFn(explicarIndicador);
  const chaveSerie = serie
    .map((p) => `${p.periodo.slice(0, 7)}:${p.valor == null ? "-" : p.valor.toFixed(4)}`)
    .join("|");
  const { data: analise, isLoading: analiseLoading } = useQuery({
    queryKey: ["indic-explicacao", ind.id, faixa, chaveSerie],
    enabled: serie.some((p) => p.valor != null && isFinite(p.valor)),
    staleTime: 24 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 0,
    queryFn: () =>
      explicarFn({
        data: {
          nome: ind.nome,
          categoria: ind.categoria,
          formulaTexto,
          modo: ind.modo_analise,
          faixa,
          serie: serie.map((p) => ({ periodo: p.periodo, valor: p.valor })),
        },
      }),
  });

  // Banda saudável (só quando faixas configuradas com bom/otimo)
  let band: { y1: number; y2: number } | null = null;
  if (faixasEsc && faixasEsc.bom != null && faixasEsc.otimo != null) {
    const dir = faixasEsc.direcao ?? "maior_melhor";
    if (dir === "maior_melhor") {
      band = { y1: Math.min(faixasEsc.bom, faixasEsc.otimo), y2: Math.max(faixasEsc.bom, faixasEsc.otimo) };
    } else {
      band = { y1: Math.min(faixasEsc.otimo, faixasEsc.bom), y2: Math.max(faixasEsc.otimo, faixasEsc.bom) };
    }
  }




  return (
    <Card
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden p-4 transition-all",
        onClick && "cursor-pointer hover:shadow-[var(--shadow-elegant)] hover:-translate-y-0.5",
      )}
    >
      {/* barra lateral da faixa */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1"
        style={{ background: cor }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {ind.categoria}
          </p>
          <h4 className="mt-0.5 text-sm font-semibold leading-tight truncate">{ind.nome}</h4>
        </div>
        {faixa !== "neutro" && (
          <Badge
            variant="outline"
            className={cn("shrink-0 text-[10px] font-semibold", FAIXA_BADGE[faixa])}
          >
            {FAIXA_LABEL[faixa]}
          </Badge>
        )}
      </div>

      {temSerie ? (
        <div className="mt-3 -mx-1">
          <div className="mb-1 flex items-baseline justify-between px-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Evolução
            </span>
            <span className="text-sm font-semibold tabular-nums" style={{ color: cor }}>
              {formatarValor(valor, ind.modo_analise)}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart
              data={pontos}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id={`grad-${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={cor} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={cor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} opacity={0.5} />
              <XAxis
                dataKey="mes"
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis hide domain={["auto", "auto"]} />
              {band && (
                <ReferenceArea
                  y1={band.y1}
                  y2={band.y2}
                  fill="var(--success, #10b981)"
                  fillOpacity={0.08}
                  stroke="none"
                />
              )}
              <Tooltip
                cursor={{ stroke: cor, strokeDasharray: "3 3", strokeOpacity: 0.5 }}
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--card)",
                  boxShadow: "var(--shadow-elegant)",
                  fontSize: 12,
                  padding: "8px 12px",
                }}
                labelStyle={{ color: "var(--muted-foreground)", fontSize: 11 }}
                formatter={(v: any) => [formatarValor(Number(v), ind.modo_analise), ind.nome]}
                labelFormatter={(l: any) => String(l)}
              />
              <Area
                type="monotone"
                dataKey="valor"
                stroke={cor}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={`url(#grad-${uid})`}
                isAnimationActive
                animationDuration={600}
                animationEasing="ease-out"
                connectNulls
                dot={(props: any) => {
                  const isLast = props.index === ultimoIdx;
                  return (
                    <circle
                      key={props.index}
                      cx={props.cx}
                      cy={props.cy}
                      r={isLast ? 5 : 2.5}
                      fill={cor}
                      stroke="var(--card)"
                      strokeWidth={isLast ? 2 : 1}
                    />
                  );
                }}
                activeDot={{
                  r: 6,
                  fill: cor,
                  stroke: "var(--card)",
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-4 flex flex-col items-start">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {pontos[0]?.mes ?? "Valor atual"}
          </span>
          <span
            className="mt-1 text-4xl font-semibold tabular-nums tracking-tight"
            style={{ color: cor }}
          >
            {formatarValor(valor, ind.modo_analise)}
          </span>
        </div>
      )}

      <p className="mt-3 truncate font-mono text-[10px] text-muted-foreground/80" title={formulaTexto}>
        {formulaTexto}
      </p>
      {ind.descricao && (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground line-clamp-2">
          {ind.descricao}
        </p>
      )}
    </Card>
  );
}
