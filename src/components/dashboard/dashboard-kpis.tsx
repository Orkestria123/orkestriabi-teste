import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMonthlyStatement } from "@/hooks/use-financial-data";
import { Card } from "@/components/ui/card";
import { formatBRLCompact, formatPct, periodoLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { BLOCOS_CATALOGO } from "@/components/dashboard/dashboard-config-panel";

// -------- catálogo local: só os KPIs --------
type BaseComp = "mes_anterior" | "ano_anterior" | "orcado";

const KPI_KEYWORDS: Record<string, RegExp> = {
  kpi_receita_liquida: /receita\s*l[íi]quida/i,
  kpi_ebitda: /\bebitda\b|lajida/i,
  kpi_lucro_liquido: /lucro\s*l[íi]quido|resultado\s*l[íi]quido|resultado\s*do\s*exerc[íi]cio/i,
  kpi_resultado_mes: /lucro\s*l[íi]quido|resultado\s*l[íi]quido|resultado\s*do\s*exerc[íi]cio/i,
};

const KPI_LABEL: Record<string, string> = {
  kpi_receita_liquida: "Receita Líquida",
  kpi_ebitda: "EBITDA",
  kpi_lucro_liquido: "Lucro Líquido",
  kpi_resultado_mes: "Resultado do Mês",
};

const BASE_LABEL: Record<BaseComp, string> = {
  mes_anterior: "vs mês anterior",
  ano_anterior: "vs mesmo mês do ano anterior",
  orcado: "vs orçado",
};

function shiftPeriod(periodo: string, months: number): string {
  const d = new Date(periodo + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function sumByKeyword(rows: any[], periods: string[], kw: RegExp): number | null {
  let total = 0;
  let hit = false;
  const set = new Set(periods);
  for (const r of rows) {
    if (!set.has(r.periodo)) continue;
    if (!kw.test(r.descricao ?? "")) continue;
    total += Number(r.valor) || 0;
    hit = true;
  }
  return hit ? total : null;
}

interface DashboardConfigRow {
  id: string;
  bloco: string;
  visivel: boolean;
  ordem: number;
  config: Record<string, any> | null;
}

export function DashboardKpisGrid({
  companyId,
  activePeriods,
}: {
  companyId: string;
  activePeriods: string[];
}) {
  // config
  const { data: configRows } = useQuery({
    queryKey: ["dashboard-config", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dashboard_config" as any)
        .select("*")
        .eq("company_id", companyId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as unknown as DashboardConfigRow[];
    },
  });

  const kpiCatalog = useMemo(
    () => new Set(BLOCOS_CATALOGO.filter((b) => b.categoria === "kpi").map((b) => b.key)),
    [],
  );

  const kpiRows = useMemo(() => {
    return (configRows ?? [])
      .filter((r) => r.visivel && kpiCatalog.has(r.bloco))
      .sort((a, b) => a.ordem - b.ordem);
  }, [configRows, kpiCatalog]);

  // Períodos a buscar: activePeriods ∪ shift(-1) ∪ shift(-12)
  const allPeriods = useMemo(() => {
    if (activePeriods.length === 0) return [];
    const s = new Set<string>(activePeriods);
    for (const p of activePeriods) {
      s.add(shiftPeriod(p, -1));
      s.add(shiftPeriod(p, -12));
    }
    return Array.from(s).sort();
  }, [activePeriods]);

  const { data: dre } = useMonthlyStatement(companyId, "DRE", allPeriods);

  // Ano de referência = último período selecionado
  const lastPeriod = activePeriods[activePeriods.length - 1] ?? null;
  const anoRef = lastPeriod ? Number(lastPeriod.slice(0, 4)) : null;

  // Orçamento oficial do ano de referência (para KPIs com base=orcado)
  const usaOrcado = useMemo(
    () => kpiRows.some((r) => (r.config as any)?.base_comparacao === "orcado"),
    [kpiRows],
  );
  const { data: orcadoAgg } = useQuery({
    queryKey: ["dashboard-orcado", companyId, anoRef],
    enabled: usaOrcado && !!anoRef,
    queryFn: async () => {
      // Pega o(s) orçamento(s) do ano de referência
      const { data: orcs, error: e1 } = await supabase
        .from("orcamentos")
        .select("id, nome, ano")
        .eq("company_id", companyId)
        .eq("ano", anoRef!);
      if (e1) throw e1;
      if (!orcs || orcs.length === 0) return { itens: [], valores: [] };
      // Pega o mais recentemente atualizado (heurística: 1º)
      const orc = orcs[0];
      const [{ data: itens }, { data: valores }] = await Promise.all([
        supabase
          .from("orcamento_itens")
          .select("id, rotulo, tipo_conta")
          .eq("orcamento_id", orc.id),
        supabase
          .from("orcamento_valores")
          .select("item_id, competencia, valor_orcado")
          .eq("orcamento_id", orc.id),
      ]);
      return {
        itens: (itens ?? []) as { id: string; rotulo: string; tipo_conta: string }[],
        valores: (valores ?? []) as {
          item_id: string;
          competencia: string;
          valor_orcado: number;
        }[],
      };
    },
  });

  if (!kpiRows.length) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {kpiRows.map((row) => {
        const base = ((row.config as any)?.base_comparacao ?? "mes_anterior") as BaseComp;
        const kw = KPI_KEYWORDS[row.bloco];
        const label = KPI_LABEL[row.bloco] ?? row.bloco;

        const atual = kw ? sumByKeyword(dre ?? [], activePeriods, kw) : null;

        let anterior: number | null = null;
        let baseAusente = false;
        if (base === "mes_anterior") {
          const prev = activePeriods.map((p) => shiftPeriod(p, -1));
          anterior = kw ? sumByKeyword(dre ?? [], prev, kw) : null;
        } else if (base === "ano_anterior") {
          const prev = activePeriods.map((p) => shiftPeriod(p, -12));
          anterior = kw ? sumByKeyword(dre ?? [], prev, kw) : null;
        } else if (base === "orcado") {
          if (!orcadoAgg || orcadoAgg.itens.length === 0) {
            baseAusente = true;
          } else {
            const itensMatch = orcadoAgg.itens.filter((it) => kw && kw.test(it.rotulo ?? ""));
            if (itensMatch.length === 0) {
              baseAusente = true;
            } else {
              const ids = new Set(itensMatch.map((i) => i.id));
              const comps = new Set(activePeriods);
              let total = 0;
              let hit = false;
              for (const v of orcadoAgg.valores) {
                if (!ids.has(v.item_id)) continue;
                if (!comps.has(v.competencia)) continue;
                total += Number(v.valor_orcado) || 0;
                hit = true;
              }
              if (!hit) baseAusente = true;
              else anterior = total;
            }
          }
        }

        return (
          <KpiConfigCard
            key={row.id}
            blocoKey={row.bloco}
            label={label}
            value={atual}
            prev={anterior}
            base={base}
            baseAusente={baseAusente}
            periodoLabelStr={
              activePeriods.length === 1 && lastPeriod ? periodoLabel(lastPeriod) : undefined
            }
          />
        );
      })}
    </div>
  );
}

function KpiConfigCard({
  blocoKey,
  label,
  value,
  prev,
  base,
  baseAusente,
  periodoLabelStr,
}: {
  blocoKey: string;
  label: string;
  value: number | null;
  prev: number | null;
  base: BaseComp;
  baseAusente: boolean;
  periodoLabelStr?: string;
}) {
  const isResultadoMes = blocoKey === "kpi_resultado_mes";
  const variation =
    prev != null && prev !== 0 && value != null
      ? ((value - prev) / Math.abs(prev)) * 100
      : null;

  // Tom / cor da lateral do card
  let tone: "positive" | "negative" | "neutral" = "neutral";
  if (isResultadoMes && value != null) {
    tone = value >= 0 ? "positive" : "negative";
  } else if (variation != null) {
    tone = variation >= 0 ? "positive" : "negative";
  }
  const accentClass =
    tone === "positive"
      ? "before:bg-success"
      : tone === "negative"
        ? "before:bg-destructive"
        : "before:bg-[var(--brand)]";

  // Rótulo dinâmico para Resultado do Mês
  const resultadoSuffix =
    isResultadoMes && value != null ? (value >= 0 ? "· Superávit" : "· Déficit") : "";

  return (
    <Card
      className={cn(
        "relative overflow-hidden p-5 transition-shadow hover:shadow-[var(--shadow-elegant)]",
        "before:absolute before:left-0 before:top-0 before:h-full before:w-1",
        accentClass,
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-medium flex items-center gap-1.5 flex-wrap">
        <span>{label}</span>
        {resultadoSuffix && (
          <span className={cn("text-[10px] font-semibold", tone === "positive" ? "text-success" : "text-destructive")}>
            {resultadoSuffix}
          </span>
        )}
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums text-foreground">
        {value == null ? "—" : formatBRLCompact(value)}
      </div>
      <div className="mt-2 min-h-[18px]">
        {baseAusente ? (
          <span className="text-[11px] text-muted-foreground italic">sem orçamento no período</span>
        ) : variation != null ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[11px] font-medium",
              variation > 0 && "text-success",
              variation < 0 && "text-destructive",
              variation === 0 && "text-muted-foreground",
            )}
          >
            {variation > 0 ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : variation < 0 ? (
              <ArrowDownRight className="h-3 w-3" />
            ) : (
              <Minus className="h-3 w-3" />
            )}
            {(variation > 0 ? "+" : "") + formatPct(Math.abs(variation), 1)}
            <span className="text-muted-foreground font-normal ml-1">{BASE_LABEL[base]}</span>
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            sem dado de comparação{periodoLabelStr ? ` · ${periodoLabelStr}` : ""}
          </span>
        )}
      </div>
    </Card>
  );
}
