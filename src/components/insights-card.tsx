import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { generateFinancialInsights } from "@/lib/api/insights.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";

interface Props {
  companyId: string | null;
  periodos: string[];
}

export function InsightsCard({ companyId, periodos }: Props) {
  const fn = useServerFn(generateFinancialInsights);
  const [insights, setInsights] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!companyId || periodos.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fn({ data: { companyId, periodos } });
      setInsights(res.insights);
    } catch (e: any) {
      setError(e?.message ?? "Falha ao gerar análise");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-5 shadow-[var(--shadow-soft)] relative overflow-hidden">
      <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-gradient-to-br from-primary/20 to-transparent blur-2xl pointer-events-none" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg grid place-items-center bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold leading-tight">Insights automáticos</h3>
              <p className="text-xs text-muted-foreground">Análise por IA sobre o período selecionado</p>
            </div>
          </div>
          {insights && !loading && (
            <Button size="sm" variant="ghost" onClick={run} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Atualizar
            </Button>
          )}
        </div>

        {!insights && !loading && !error && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Gere uma análise automática da DRE: variações relevantes, alertas e oportunidades destacadas pela IA.
            </p>
            <Button onClick={run} disabled={!companyId} className="gap-2">
              <Sparkles className="h-4 w-4" /> Gerar análise
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Analisando demonstrações…
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {insights && !loading && (
          <div className="space-y-2.5 text-sm leading-relaxed whitespace-pre-wrap">
            {insights.split(/\n\n+|\n(?=[📈📉⚠️✅💡])/).map((p, i) => (
              <p key={i} className="rounded-md bg-muted/40 px-3 py-2 border border-border/50">
                {p.trim()}
              </p>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
