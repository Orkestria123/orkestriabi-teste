import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { computeIndicators, formatIndicator, type IndicatorValue, type AccountRow } from "@/lib/indicators";
import { useMemo, useId } from "react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/indicadores")({ component: Page });

function useAllStatements(companyId: string | null, periodos: string[]) {
  return useQuery({
    queryKey: ["statements-all", companyId, periodos],
    enabled: !!companyId && periodos.length > 0,
    queryFn: async (): Promise<AccountRow[]> => {
      const { data, error } = await supabase
        .from("financial_statements")
        .select("descricao,codigo_conta,periodo,valor,tipo_demonstracao,nivel,is_subtotal")
        .eq("company_id", companyId!)
        .in("periodo", periodos);
      if (error) throw error;
      return (data ?? []).map((d: any) => ({ ...d, valor: Number(d.valor) || 0 }));
    },
  });
}

function MiniSparkline({ values, tone }: { values: (number | null)[]; tone: "up" | "down" | "neutral" }) {
  const uid = useId().replace(/[:]/g, "");
  const clean = values.map((v) => (v == null || !isFinite(v) ? 0 : v));
  if (clean.length < 2) return null;
  const w = 100, h = 28;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  const step = w / (clean.length - 1);
  const pts = clean.map((v, i) => ({ x: i * step, y: h - 3 - ((v - min) / range) * (h - 6) }));
  const d = pts.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`;
    const prev = pts[i - 1];
    const cpx = (prev.x + pt.x) / 2;
    return `${acc} C ${cpx} ${prev.y} ${cpx} ${pt.y} ${pt.x} ${pt.y}`;
  }, "");
  const color = tone === "down" ? "var(--destructive)" : tone === "up" ? "var(--success)" : "var(--brand)";
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 w-full h-7" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`mini-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill={`url(#mini-${uid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r={2.5} fill={color} stroke="var(--card)" strokeWidth={1.2} />
    </svg>
  );
}

function healthOf(ind: IndicatorValue, v: number | null): "green" | "yellow" | "red" | "neutral" {
  if (v == null) return "neutral";
  if (ind.category === "Liquidez") {
    return v >= 1 ? "green" : v >= 0.7 ? "yellow" : "red";
  }
  if (ind.category === "Endividamento") {
    return v <= 50 ? "green" : v <= 70 ? "yellow" : "red";
  }
  if (ind.category === "Rentabilidade") {
    return v >= 10 ? "green" : v > 0 ? "yellow" : "red";
  }
  return "neutral";
}

function IndicatorCard({ ind, periodos }: { ind: IndicatorValue; periodos: string[] }) {
  const last = periodos[periodos.length - 1];
  const prev = periodos[periodos.length - 2];
  const valor = ind.values[last] ?? null;
  const prevValor = prev ? ind.values[prev] ?? null : null;
  const variacao =
    valor != null && prevValor != null && prevValor !== 0
      ? ((valor - prevValor) / Math.abs(prevValor)) * 100
      : null;
  const tone: "up" | "down" | "neutral" =
    variacao == null ? "neutral" : variacao > 0 ? "up" : "down";
  const saude = healthOf(ind, valor);
  const sparkValues = periodos.map((p) => ind.values[p] ?? null);

  return (
    <Card className="p-4 hover:shadow-[var(--shadow-elegant)] transition-shadow">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{ind.category}</p>
          <p className="text-xs font-semibold mt-0.5 truncate">{ind.label}</p>
          <p className="text-2xl font-semibold mt-2 tabular-nums">
            {formatIndicator(valor, ind.format)}
          </p>
        </div>
        <div
          className={cn(
            "h-2.5 w-2.5 rounded-full mt-1 flex-shrink-0",
            saude === "green" && "bg-success",
            saude === "yellow" && "bg-warning",
            saude === "red" && "bg-destructive",
            saude === "neutral" && "bg-muted-foreground/40",
          )}
        />
      </div>

      {variacao != null && (
        <p className={cn("text-xs mt-1 font-medium", variacao > 0 ? "text-success" : "text-destructive")}>
          {variacao > 0 ? "▲" : "▼"} {Math.abs(variacao).toFixed(1).replace(".", ",")}% vs período anterior
        </p>
      )}

      <p className="text-[10px] text-muted-foreground mt-2 line-clamp-2">{ind.description}</p>

      <MiniSparkline values={sparkValues} tone={tone} />
    </Card>
  );
}

function Page() {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const { data, isLoading } = useAllStatements(companyId, periodos);

  const indicators = useMemo(
    () => computeIndicators(data ?? [], periodos),
    [data, periodos],
  );

  const byCategory = useMemo(() => {
    const m = new Map<string, IndicatorValue[]>();
    for (const ind of indicators) {
      if (!m.has(ind.category)) m.set(ind.category, []);
      m.get(ind.category)!.push(ind);
    }
    return Array.from(m.entries());
  }, [indicators]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Indicadores</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Análise calculada automaticamente a partir da DRE e do Balanço Patrimonial.
        </p>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Calculando…</div>}

      {byCategory.map(([cat, items]) => (
        <section key={cat}>
          <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
            {cat}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {items.map((ind) => (
              <IndicatorCard key={ind.key} ind={ind} periodos={periodos} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
