import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { generateFinancialInsights } from "@/lib/api/insights.functions";
import { useMonthlyStatement } from "@/hooks/use-financial-data";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";

interface Props {
  companyId: string | null;
  periodos: string[];
}

export function InsightsCard({ companyId, periodos }: Props) {
  const fn = useServerFn(generateFinancialInsights);

  // A DRE da IA é a MESMA da tela (motor do diário/ECD). Antes a análise
  // lia uma tabela que só as empresas do pipeline antigo preenchem, então
  // quase sempre respondia "sem dados".
  const { data: dre, isLoading: dreLoading } = useMonthlyStatement(
    companyId,
    "DRE",
    periodos,
  );

  const linhas = useMemo(() => {
    const byRow = new Map<
      string,
      { descricao: string; values: Record<string, number>; ordem: number }
    >();
    for (const r of (dre ?? []) as any[]) {
      // Subtotais contam a história (receita, custo, margem, resultado).
      if (!r?.is_subtotal) continue;
      const k = String(r.descricao ?? "");
      const periodo = String(r.periodo ?? "");
      if (!k || !periodo) continue;
      if (!byRow.has(k)) {
        byRow.set(k, { descricao: k, values: {}, ordem: Number(r.linha_ordem) || 0 });
      }
      byRow.get(k)!.values[periodo] = Number(r.valor) || 0;
    }
    return Array.from(byRow.values())
      .sort((a, b) => a.ordem - b.ordem)
      .slice(0, 40)
      .map((r) => ({ descricao: r.descricao, values: r.values }));
  }, [dre]);

  const chave = ["insights", companyId, periodos.join(","), linhas.length] as const;

  // A análise fica guardada por empresa + período: reabrir a tela (ou
  // voltar dela) não paga o custo de reler a DRE e chamar a IA de novo.
  // Só o botão "Atualizar" força o recálculo.
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: chave,
    enabled: false,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const res = await fn({
        data: {
          companyId: companyId as string,
          periodos,
          linhas: linhas.length > 0 ? linhas : undefined,
        },
      });
      return res.insights as string;
    },
  });

  const insights = data ?? null;
  const loading = isFetching;

  const run = async () => {
    if (!companyId || periodos.length === 0) return;
    await refetch();
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

        {error && !loading && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {(error as Error)?.message ?? "Falha ao gerar análise"}
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
