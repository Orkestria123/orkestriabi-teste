import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMonthlyStatement } from "@/hooks/use-financial-data";
import { useEstruturaPadrao } from "@/hooks/use-indicador-data";
import { ensureDashboardConfig, lerDashboardBlocos } from "@/lib/dashboard/ensure-config";
import {
  BLOCOS_CATALOGO, KPI_DESTAQUE, KPI_LABEL, KPI_PAPEL, KPI_VIA_INDICADOR,
} from "@/lib/dashboard/catalogo";
import { Card } from "@/components/ui/card";
import { formatBRLCompact, formatPct, periodoLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { indexarDemoDre, valorPapelDemo, valorCustosDemo, valorEbitEbitdaDaDre } from "@/lib/indicadores/linhas";

type BaseComp = "mes_anterior" | "ano_anterior" | "orcado";

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

function somaPapel(
  demo: ReturnType<typeof indexarDemoDre> | undefined,
  papel: string | undefined,
  periods: string[],
  estrutura: Parameters<typeof valorPapelDemo>[3],
): number | null {
  if (!papel || !demo || periods.length === 0) return null;
  let total = 0;
  let hit = false;
  for (const p of periods) {
    const v =
      papel === "CUSTOS"
        ? valorCustosDemo(demo, p, estrutura)
        : valorPapelDemo(demo, papel, p, estrutura);
    if (v == null) continue;
    total += v;
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
  tenantId,
  activePeriods,
}: {
  companyId: string;
  tenantId?: string;
  activePeriods: string[];
}) {
  const qc = useQueryClient();
  const { data: configRows } = useQuery({
    queryKey: ["dashboard-config", tenantId, companyId],
    enabled: !!tenantId,
    queryFn: () => lerDashboardBlocos(tenantId!, companyId),
  });

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const criou = await ensureDashboardConfig(tenantId, companyId);
      if (criou) qc.invalidateQueries({ queryKey: ["dashboard-config", tenantId, companyId] });
    })();
  }, [tenantId, companyId, qc]);

  const kpiCatalog = useMemo(
    () => new Set(BLOCOS_CATALOGO.filter((b) => b.categoria === "kpi").map((b) => b.key)),
    [],
  );

  const kpiRows = useMemo(() => {
    const visiveis = (configRows ?? []).filter((r) => r.visivel && kpiCatalog.has(r.bloco));
    const destaque = KPI_DESTAQUE.map((k) => visiveis.find((r) => r.bloco === k)).filter(
      Boolean,
    ) as DashboardConfigRow[];
    const resto = visiveis
      .filter((r) => !(KPI_DESTAQUE as readonly string[]).includes(r.bloco))
      .sort((a, b) => a.ordem - b.ordem);
    return [...destaque, ...resto];
  }, [configRows, kpiCatalog]);

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
  const { data: estrutura } = useEstruturaPadrao();

  const demo = useMemo(
    () => (dre ? indexarDemoDre(dre as any, estrutura) : undefined),
    [dre, estrutura],
  );

  const lastPeriod = activePeriods[activePeriods.length - 1] ?? null;
  const anoRef = lastPeriod ? Number(lastPeriod.slice(0, 4)) : null;

  const usaOrcado = useMemo(
    () => kpiRows.some((r) => (r.config as any)?.base_comparacao === "orcado"),
    [kpiRows],
  );
  const { data: orcadoAgg } = useQuery({
    queryKey: ["dashboard-orcado", companyId, anoRef],
    enabled: usaOrcado && !!anoRef,
    queryFn: async () => {
      const { data: orcs, error: e1 } = await supabase
        .from("orcamentos")
        .select("id, nome, ano")
        .eq("company_id", companyId)
        .eq("ano", anoRef!);
      if (e1) throw e1;
      if (!orcs || orcs.length === 0) return { itens: [], valores: [] };
      const orc = orcs[0];
      const [{ data: itens }, { data: valores }] = await Promise.all([
        supabase.from("orcamento_itens").select("id, rotulo, tipo_conta").eq("orcamento_id", orc.id),
        supabase
          .from("orcamento_valores")
          .select("item_id, competencia, valor_orcado")
          .eq("orcamento_id", orc.id),
      ]);
      return {
        itens: (itens ?? []) as { id: string; rotulo: string; tipo_conta: string }[],
        valores: (valores ?? []) as { item_id: string; competencia: string; valor_orcado: number }[],
      };
    },
  });

  if (!kpiRows.length) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {kpiRows.map((row) => {
        const base = ((row.config as any)?.base_comparacao ?? "mes_anterior") as BaseComp;
        const papel = ((row.config as any)?.papel as string | undefined) ?? KPI_PAPEL[row.bloco];
        const label = KPI_LABEL[row.bloco] ?? row.bloco;
        const via = KPI_VIA_INDICADOR[row.bloco];
        const daDre = via
          ? (p: string[]) => {
              let total = 0;
              let hit = false;
              for (const per of p) {
                const v = valorEbitEbitdaDaDre(
                  demo,
                  via === "ebitda" ? "EBITDA" : "EBIT",
                  per,
                );
                if (v == null) continue;
                total += v;
                hit = true;
              }
              return hit ? total : null;
            }
          : null;
        const atual = daDre
          ? (daDre(activePeriods) ?? somaPapel(demo, papel, activePeriods, estrutura))
          : somaPapel(demo, papel, activePeriods, estrutura);
        const prevMes = activePeriods.map((p) => shiftPeriod(p, -1));
        const prevAno = activePeriods.map((p) => shiftPeriod(p, -12));
        const somaPrev = (ps: string[]) =>
          daDre
            ? (daDre(ps) ?? somaPapel(demo, papel, ps, estrutura))
            : somaPapel(demo, papel, ps, estrutura);

        let anterior: number | null = null;
        let baseAusente = false;
        if (base === "mes_anterior") {
          anterior = somaPrev(prevMes);
        } else if (base === "ano_anterior") {
          anterior = somaPrev(prevAno);
        } else if (base === "orcado") {
          if (!orcadoAgg || orcadoAgg.itens.length === 0) {
            baseAusente = true;
          } else {
            const rx = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
            const itensMatch = orcadoAgg.itens.filter((it) => rx.test(it.rotulo ?? ""));
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
            key={row.bloco}
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
  const isSigned = blocoKey === "kpi_lucro_liquido" || blocoKey === "kpi_ebit";
  const variation =
    prev != null && prev !== 0 && value != null
      ? ((value - prev) / Math.abs(prev)) * 100
      : null;

  let tone: "positive" | "negative" | "neutral" = "neutral";
  if (isSigned && value != null) {
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

  const resultadoSuffix =
    isSigned && value != null ? (value >= 0 ? "· Superávit" : "· Déficit") : "";

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
            {(variation > 0 ? "+" : "") + formatPct(Math.abs(variation))}
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
