import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PortalShell } from "@/components/portal-shell";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { compareCompanies } from "@/lib/api/comparativo.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, GitCompareArrows, TrendingDown, TrendingUp } from "lucide-react";
import { formatBRLCompact, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/comparativo")({ component: Page });

const KPIS: Array<{ key: keyof Kpis; label: string; format: "brl" | "pct" | "ratio"; better: "high" | "low" }> = [
  { key: "receita", label: "Receita", format: "brl", better: "high" },
  { key: "lucro", label: "Lucro líquido", format: "brl", better: "high" },
  { key: "ebitda", label: "EBITDA", format: "brl", better: "high" },
  { key: "margemBruta", label: "Margem bruta", format: "pct", better: "high" },
  { key: "margemLiquida", label: "Margem líquida", format: "pct", better: "high" },
  { key: "margemEbitda", label: "Margem EBITDA", format: "pct", better: "high" },
  { key: "variacaoReceita", label: "Variação receita", format: "pct", better: "high" },
  { key: "variacaoLucro", label: "Variação lucro", format: "pct", better: "high" },
  { key: "ativoTotal", label: "Ativo total", format: "brl", better: "high" },
  { key: "patrimonio", label: "Patrimônio líquido", format: "brl", better: "high" },
  { key: "liquidezCorrente", label: "Liquidez corrente", format: "ratio", better: "high" },
  { key: "endividamento", label: "Endividamento", format: "pct", better: "low" },
];

type Kpis = {
  receita: number | null;
  lucro: number | null;
  ebitda: number | null;
  lucroBruto: number | null;
  margemLiquida: number | null;
  margemBruta: number | null;
  margemEbitda: number | null;
  variacaoReceita: number | null;
  variacaoLucro: number | null;
  ativoTotal: number | null;
  patrimonio: number | null;
  liquidezCorrente: number | null;
  endividamento: number | null;
};

function fmt(v: number | null, format: "brl" | "pct" | "ratio") {
  if (v == null || !isFinite(v)) return "—";
  if (format === "brl") return formatBRLCompact(v);
  if (format === "pct") return formatPct(v);
  return v.toFixed(2).replace(".", ",");
}

function Page() {
  const { data: companies } = useQuery({
    queryKey: ["all-companies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, razao_social, cnpj")
        .eq("ativo", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 6 ? prev : [...prev, id],
    );

  const compareFn = useServerFn(compareCompanies);
  const { data: comparison, isFetching } = useQuery({
    queryKey: ["comparativo", selected.sort().join(",")],
    enabled: selected.length >= 2,
    queryFn: () => compareFn({ data: { companyIds: selected } }),
  });

  const rows = comparison?.companies ?? [];

  // For each KPI, find best/worst across companies
  const bestWorst = useMemo(() => {
    const map: Record<string, { best: number | null; worst: number | null }> = {};
    for (const k of KPIS) {
      const vals = rows.map((r) => r.kpis[k.key]).filter((v): v is number => v != null && isFinite(v));
      if (vals.length < 2) {
        map[k.key] = { best: null, worst: null };
        continue;
      }
      const hi = Math.max(...vals);
      const lo = Math.min(...vals);
      map[k.key] = k.better === "high" ? { best: hi, worst: lo } : { best: lo, worst: hi };
    }
    return map;
  }, [rows]);

  return (
    <PortalShell variant="admin" title="Comparativo entre empresas">
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <Card className="p-4 h-fit lg:sticky lg:top-4">
          <div className="flex items-center gap-2 mb-3">
            <GitCompareArrows className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">Selecione empresas</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Escolha de 2 a 6 empresas para comparar lado a lado.
          </p>
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
            {(companies ?? []).map((c) => {
              const isSel = selected.includes(c.id);
              const disabled = !isSel && selected.length >= 6;
              return (
                <label
                  key={c.id}
                  className={cn(
                    "flex items-start gap-2 rounded-md px-2 py-2 cursor-pointer transition-colors",
                    isSel ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-accent/50",
                    disabled && "opacity-40 cursor-not-allowed",
                  )}
                >
                  <Checkbox
                    checked={isSel}
                    disabled={disabled}
                    onCheckedChange={() => toggle(c.id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{c.razao_social ?? c.name}</div>
                    {c.cnpj && <div className="text-[10px] text-muted-foreground font-mono">{c.cnpj}</div>}
                  </div>
                </label>
              );
            })}
            {(companies ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma empresa cadastrada.</p>
            )}
          </div>
          {selected.length > 0 && (
            <Button size="sm" variant="ghost" className="w-full mt-3" onClick={() => setSelected([])}>
              Limpar seleção ({selected.length})
            </Button>
          )}
        </Card>

        <div className="min-w-0">
          {selected.length < 2 ? (
            <Card className="p-12 text-center text-sm text-muted-foreground">
              <GitCompareArrows className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
              Selecione pelo menos 2 empresas ao lado para iniciar a comparação.
            </Card>
          ) : isFetching && !comparison ? (
            <Card className="p-12 text-center text-sm text-muted-foreground">Carregando…</Card>
          ) : (
            <>
              <Card className="p-5 mb-4 shadow-[var(--shadow-soft)] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground sticky left-0 bg-card z-10">
                          Indicador
                        </th>
                        {rows.map((c) => (
                          <th key={c.id} className="text-right py-3 px-3 min-w-[180px]">
                            <Link
                              to="/dashboard"
                              search={{ company: c.id }}
                              className="group inline-flex items-center gap-1.5"
                            >
                              <span className="font-semibold truncate max-w-[160px] group-hover:text-primary transition-colors">
                                {c.name}
                              </span>
                              <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition" />
                            </Link>
                            {c.periodo && (
                              <div className="text-[10px] font-normal text-muted-foreground mt-0.5">
                                ref: {c.periodo.slice(0, 7)}
                              </div>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {KPIS.map((k, idx) => {
                        const bw = bestWorst[k.key];
                        return (
                          <tr
                            key={k.key}
                            className={cn(
                              "border-b last:border-0 hover:bg-accent/20 transition-colors",
                              idx % 2 === 1 && "bg-muted/10",
                            )}
                          >
                            <td className="py-2.5 px-3 font-medium sticky left-0 bg-card">
                              {k.label}
                            </td>
                            {rows.map((c) => {
                              const v = c.kpis[k.key];
                              const isBest = bw.best != null && v != null && v === bw.best;
                              const isWorst = bw.worst != null && v != null && v === bw.worst && bw.best !== bw.worst;
                              const isPct = k.format === "pct";
                              const positive = isPct && v != null && v > 0;
                              const negative = isPct && v != null && v < 0;
                              return (
                                <td key={c.id} className="py-2.5 px-3 text-right tabular-nums">
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5",
                                      isBest && "bg-success/15 text-success font-semibold",
                                      isWorst && "bg-destructive/15 text-destructive font-semibold",
                                    )}
                                  >
                                    {k.key.startsWith("variacao") && v != null ? (
                                      positive ? (
                                        <TrendingUp className="h-3 w-3" />
                                      ) : negative ? (
                                        <TrendingDown className="h-3 w-3" />
                                      ) : null
                                    ) : null}
                                    {fmt(v, k.format)}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Badge variant="outline" className="border-success/30 text-success bg-success/10">Melhor</Badge>
                <Badge variant="outline" className="border-destructive/30 text-destructive bg-destructive/10">Pior</Badge>
                <span>Valores referentes ao último período disponível de cada empresa.</span>
              </div>
            </>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
