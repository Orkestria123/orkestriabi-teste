// Três gráficos de evolução (Receita / Custo / Despesa) que substituem
// os cards de "Total Orçado / Realizado / Variação". Cada gráfico compara
// Orçado vs Realizado por período (respeitando o agrupador temporal) e
// destaca o desvio com área semântica (verde/vermelho).
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE } from "@/lib/chart-config";
import { formatBRL, formatBRLCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface NaturezaCell {
  orcado: number | null;
  realizado: number | null;
}

export interface NaturezaLinha {
  tipo: string | null;
  cells: NaturezaCell[];
  totalCell: NaturezaCell;
}

export interface NaturezaColuna {
  key: string;
  label: string;
}

export type Natureza = "receita" | "custo" | "despesa";

interface NaturezaDef {
  key: Natureza;
  titulo: string;
  cor: string; // cor do realizado
}

const NATUREZAS: NaturezaDef[] = [
  { key: "receita", titulo: "Receita", cor: "var(--chart-2)" },
  { key: "custo", titulo: "Custo", cor: "var(--chart-4)" },
  { key: "despesa", titulo: "Despesa", cor: "var(--chart-5)" },
];

function ehBom(natureza: Natureza, realizado: number, orcado: number) {
  // Receita: real > orc => bom. Custo/Despesa: real < orc => bom.
  if (natureza === "receita") return realizado >= orcado;
  return realizado <= orcado;
}

function agregarPorNatureza(
  grid: NaturezaLinha[],
  colunas: NaturezaColuna[],
  natureza: Natureza,
) {
  const linhas = grid.filter((l) => (l.tipo ?? "").toLowerCase() === natureza);
  if (linhas.length === 0) return null;

  const pontos = colunas.map((c, idx) => {
    let orc = 0;
    let real = 0;
    let temOrc = false;
    let temReal = false;
    for (const l of linhas) {
      const cell = l.cells[idx];
      if (cell?.orcado !== null && cell?.orcado !== undefined) {
        orc += Math.abs(cell.orcado);
        temOrc = true;
      }
      if (cell?.realizado !== null && cell?.realizado !== undefined) {
        real += Math.abs(cell.realizado);
        temReal = true;
      }
    }
    const orcado = temOrc ? orc : null;
    const realizado = temReal ? real : null;

    // Bandas: min como baseline invisível; parte "acima do min" pintada de
    // verde ou vermelho conforme o sinal daquela natureza.
    let bandBase: number | null = null;
    let bandGood = 0;
    let bandBad = 0;
    if (orcado !== null && realizado !== null) {
      bandBase = Math.min(orcado, realizado);
      const diff = Math.abs(orcado - realizado);
      if (ehBom(natureza, realizado, orcado)) bandGood = diff;
      else bandBad = diff;
    }

    return {
      periodo: c.label,
      orcado,
      realizado,
      bandBase,
      bandGood,
      bandBad,
    };
  });

  // Totais acumulados (só considera pontos com ambos)
  let totOrc = 0;
  let totReal = 0;
  let temOrcT = false;
  let temRealT = false;
  for (const l of linhas) {
    if (l.totalCell.orcado !== null) {
      totOrc += Math.abs(l.totalCell.orcado);
      temOrcT = true;
    }
    if (l.totalCell.realizado !== null) {
      totReal += Math.abs(l.totalCell.realizado);
      temRealT = true;
    }
  }

  return {
    pontos,
    totalOrcado: temOrcT ? totOrc : null,
    totalRealizado: temRealT ? totReal : null,
  };
}

function statusDeVariacao(
  natureza: Natureza,
  varPct: number | null,
): "verde" | "vermelho" | "neutro" {
  if (varPct === null) return "neutro";
  const bom = natureza === "receita" ? varPct >= 0 : varPct <= 0;
  return bom ? "verde" : "vermelho";
}

function corDeStatus(s: "verde" | "vermelho" | "neutro") {
  if (s === "verde") return "text-emerald-600 dark:text-emerald-400";
  if (s === "vermelho") return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

function fmtPct(v: number | null) {
  if (v === null || !isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")}%`;
}

function GraficoNatureza({
  def,
  dados,
}: {
  def: NaturezaDef;
  dados: ReturnType<typeof agregarPorNatureza>;
}) {
  if (!dados) {
    return (
      <Card className="p-4 flex flex-col justify-center items-center text-center min-h-[220px]">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {def.titulo}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Nenhum item de {def.titulo.toLowerCase()} orçado.
        </p>
      </Card>
    );
  }
  const { pontos, totalOrcado, totalRealizado } = dados;
  const varAbs =
    totalOrcado !== null && totalRealizado !== null ? totalRealizado - totalOrcado : null;
  const varPct =
    varAbs !== null && totalOrcado !== null && totalOrcado !== 0
      ? (varAbs / Math.abs(totalOrcado)) * 100
      : null;
  const status = statusDeVariacao(def.key, varPct);
  const corVar = corDeStatus(status);

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {def.titulo}
        </div>
        <div className={cn("text-xs font-semibold tabular-nums", corVar)}>
          {fmtPct(varPct)}
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground tabular-nums mb-2">
        Orçado {totalOrcado === null ? "—" : formatBRLCompact(totalOrcado)} · Realizado{" "}
        {totalRealizado === null ? "—" : formatBRLCompact(totalRealizado)}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart
          data={pontos}
          margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="periodo" {...AXIS_PROPS} />
          <YAxis
            {...AXIS_PROPS}
            tickFormatter={(v) => formatBRLCompact(Number(v))}
            width={60}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }}
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              const p = payload[0].payload as (typeof pontos)[number];
              const dif =
                p.orcado !== null && p.realizado !== null ? p.realizado - p.orcado : null;
              const difPct =
                dif !== null && p.orcado !== null && p.orcado !== 0
                  ? (dif / Math.abs(p.orcado)) * 100
                  : null;
              const s = statusDeVariacao(def.key, difPct);
              return (
                <div
                  className="rounded-md border bg-card p-2 text-xs shadow-md"
                  style={{ minWidth: 180 }}
                >
                  <div className="font-medium mb-1">{label}</div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Orçado</span>
                    <span className="tabular-nums">
                      {p.orcado === null ? "—" : formatBRL(p.orcado)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Realizado</span>
                    <span className="tabular-nums">
                      {p.realizado === null ? "—" : formatBRL(p.realizado)}
                    </span>
                  </div>
                  <div
                    className={cn("flex justify-between gap-4 mt-1 pt-1 border-t", corDeStatus(s))}
                  >
                    <span>Variação</span>
                    <span className="tabular-nums font-medium">
                      {dif === null
                        ? "—"
                        : `${dif > 0 ? "+" : ""}${formatBRL(dif)} (${fmtPct(difPct)})`}
                    </span>
                  </div>
                </div>
              );
            }}
          />
          {/* Bandas: base invisível + área boa + área ruim (stack) */}
          <Area
            type="monotone"
            dataKey="bandBase"
            stackId="band"
            stroke="none"
            fill="transparent"
            isAnimationActive={false}
            activeDot={false}
            legendType="none"
          />
          <Area
            type="monotone"
            dataKey="bandGood"
            stackId="band"
            stroke="none"
            fill="var(--success, #10b981)"
            fillOpacity={0.15}
            isAnimationActive
            animationDuration={600}
            activeDot={false}
            legendType="none"
          />
          <Area
            type="monotone"
            dataKey="bandBad"
            stackId="band"
            stroke="none"
            fill="var(--destructive, #ef4444)"
            fillOpacity={0.15}
            isAnimationActive
            animationDuration={600}
            activeDot={false}
            legendType="none"
          />
          <Line
            type="monotone"
            dataKey="orcado"
            name="Orçado"
            stroke="var(--muted-foreground)"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={{ r: 2.5 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
            isAnimationActive
            animationDuration={600}
          />
          <Line
            type="monotone"
            dataKey="realizado"
            name="Realizado"
            stroke={def.cor}
            strokeWidth={2.5}
            dot={{ r: 3, fill: def.cor }}
            activeDot={{ r: 6, fill: def.cor, stroke: "var(--card)", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive
            animationDuration={700}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-2">
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block w-3 h-0 border-t-2 border-dashed"
            style={{ borderColor: "var(--muted-foreground)" }}
          />
          Orçado
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block w-3 h-[2px]"
            style={{ backgroundColor: def.cor }}
          />
          Realizado
        </span>
      </div>
    </Card>
  );
}

export function NaturezaCharts({
  grid,
  colunas,
}: {
  grid: NaturezaLinha[];
  colunas: NaturezaColuna[];
}) {
  const dadosPorNatureza = useMemo(() => {
    return NATUREZAS.map((def) => ({
      def,
      dados: agregarPorNatureza(grid, colunas, def.key),
    }));
  }, [grid, colunas]);

  // Resultado = Receita − Custo − Despesa (por período e total)
  const resultado = useMemo(() => {
    const pontos = colunas.map((c, idx) => {
      let orc = 0;
      let real = 0;
      let temOrc = false;
      let temReal = false;
      for (const l of grid) {
        const t = (l.tipo ?? "").toLowerCase();
        if (t !== "receita" && t !== "custo" && t !== "despesa") continue;
        const sinal = t === "receita" ? 1 : -1;
        const cell = l.cells[idx];
        if (cell?.orcado !== null && cell?.orcado !== undefined) {
          orc += sinal * Math.abs(cell.orcado);
          temOrc = true;
        }
        if (cell?.realizado !== null && cell?.realizado !== undefined) {
          real += sinal * Math.abs(cell.realizado);
          temReal = true;
        }
      }
      return {
        periodo: c.label,
        orcado: temOrc ? orc : null,
        realizado: temReal ? real : null,
      };
    });
    let totOrc = 0;
    let totReal = 0;
    let temOrcT = false;
    let temRealT = false;
    for (const l of grid) {
      const t = (l.tipo ?? "").toLowerCase();
      if (t !== "receita" && t !== "custo" && t !== "despesa") continue;
      const sinal = t === "receita" ? 1 : -1;
      if (l.totalCell.orcado !== null) {
        totOrc += sinal * Math.abs(l.totalCell.orcado);
        temOrcT = true;
      }
      if (l.totalCell.realizado !== null) {
        totReal += sinal * Math.abs(l.totalCell.realizado);
        temRealT = true;
      }
    }
    return {
      pontos,
      totalOrcado: temOrcT ? totOrc : null,
      totalRealizado: temRealT ? totReal : null,
    };
  }, [grid, colunas]);

  const varRes =
    resultado.totalOrcado !== null && resultado.totalRealizado !== null
      ? resultado.totalRealizado - resultado.totalOrcado
      : null;
  const varResPct =
    varRes !== null && resultado.totalOrcado !== null && resultado.totalOrcado !== 0
      ? (varRes / Math.abs(resultado.totalOrcado)) * 100
      : null;
  const resStatus = statusDeVariacao("receita", varResPct); // resultado maior = melhor

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {dadosPorNatureza.map(({ def, dados }) => (
          <GraficoNatureza key={def.key} def={def} dados={dados} />
        ))}
      </div>
      {/* Resultado — lucro planejado vs realizado */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Resultado (Receita − Custo − Despesa)
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Lucro planejado × Lucro realizado
            </div>
          </div>
          <div className="flex items-baseline gap-6 flex-wrap">
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Orçado</div>
              <div className="text-lg font-semibold tabular-nums">
                {resultado.totalOrcado === null ? "—" : formatBRL(resultado.totalOrcado)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Realizado</div>
              <div className="text-lg font-semibold tabular-nums">
                {resultado.totalRealizado === null
                  ? "—"
                  : formatBRL(resultado.totalRealizado)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Variação</div>
              <div
                className={cn(
                  "text-lg font-semibold tabular-nums",
                  corDeStatus(resStatus),
                )}
              >
                {varRes === null
                  ? "—"
                  : `${varRes > 0 ? "+" : ""}${formatBRL(varRes)}`}{" "}
                <span className="text-xs opacity-80">({fmtPct(varResPct)})</span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default NaturezaCharts;
