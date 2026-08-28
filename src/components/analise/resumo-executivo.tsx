import { Card } from "@/components/ui/card";
import { formatBRL, formatPct } from "@/lib/format";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ResumoCardProps {
  titulo: string;
  valor: number | null;
  variacao?: number | null;
  formato?: "moeda" | "percent";
  alertaSeSubir?: boolean;
}

function ResumoCard({ titulo, valor, variacao, formato = "moeda", alertaSeSubir }: ResumoCardProps) {
  const formatado = valor == null ? "—" : formato === "percent" ? formatPct(valor) : formatBRL(valor);
  const subiu = (variacao ?? 0) > 0;
  const corVar = variacao == null
    ? "text-muted-foreground"
    : subiu
      ? alertaSeSubir
        ? "text-destructive"
        : "text-success"
      : alertaSeSubir
        ? "text-success"
        : "text-destructive";
  const Icon = variacao == null ? Minus : subiu ? TrendingUp : TrendingDown;
  return (
    <Card className="p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{titulo}</p>
      <p className="text-2xl font-semibold tabular-nums mt-2">{formatado}</p>
      {variacao != null && (
        <div className={cn("mt-2 flex items-center gap-1 text-xs font-medium", corVar)}>
          <Icon className="h-3.5 w-3.5" />
          {formatPct(Math.abs(variacao))} vs período anterior
        </div>
      )}
    </Card>
  );
}

interface Props {
  receita: number;
  despesa: number;
  lucro: number;
  margem: number;
  varReceita?: number | null;
  varDespesa?: number | null;
  varLucro?: number | null;
  maiorDespesaNome?: string;
  maiorDespesaPct?: number;
  insightPrincipal?: string;
}

export function ResumoExecutivo(props: Props) {
  const { receita, despesa, lucro, margem, varReceita, varDespesa, varLucro, maiorDespesaNome, maiorDespesaPct, insightPrincipal } = props;
  const sinal = (v: number | null | undefined) =>
    v == null ? "estável" : v > 0 ? `alta de ${formatPct(Math.abs(v))}` : `queda de ${formatPct(Math.abs(v))}`;
  const narrativa = `No período, sua empresa faturou ${formatBRL(receita)} (${sinal(varReceita)} vs período anterior). As despesas somaram ${formatBRL(despesa)}${maiorDespesaNome ? `, sendo "${maiorDespesaNome}" a mais representativa (${formatPct(maiorDespesaPct ?? 0)} da receita)` : ""}. O resultado foi um ${lucro >= 0 ? "lucro" : "prejuízo"} líquido de ${formatBRL(Math.abs(lucro))}, margem de ${formatPct(margem)}.${insightPrincipal ? ` ${insightPrincipal}` : ""}`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ResumoCard titulo="Receita" valor={receita} variacao={varReceita} />
        <ResumoCard titulo="Despesa Total" valor={despesa} variacao={varDespesa} alertaSeSubir />
        <ResumoCard titulo={lucro >= 0 ? "Lucro Líquido" : "Prejuízo Líquido"} valor={lucro} variacao={varLucro} />
        <ResumoCard titulo="Margem Líquida" valor={margem} formato="percent" />
      </div>
      <Card className="p-5 bg-gradient-to-r from-primary/5 to-transparent">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Resumo em uma frase</p>
        <p className="text-sm leading-relaxed">{narrativa}</p>
      </Card>
    </div>
  );
}
