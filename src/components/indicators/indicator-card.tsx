import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  formatIndicador,
  corFaixa,
  type IndicadorCompleto,
} from "@/lib/indicators";
import { MiniTrend } from "./mini-trend";

interface Props {
  ind: IndicadorCompleto;
  modoTecnico?: boolean;
  onClick: () => void;
}

export function IndicatorCard({ ind, modoTecnico, onClick }: Props) {
  const cor = corFaixa(ind.faixa);
  const subindo = (ind.variacao_pct ?? 0) > 0;
  const variacaoBoa = ind.menorEMelhor ? !subindo : subindo;
  const values = ind.serie.map((s) => s.valor);

  return (
    <Card
      onClick={onClick}
      className="group relative cursor-pointer overflow-hidden p-4 transition-all hover:shadow-[var(--shadow-elegant)] hover:-translate-y-0.5"
    >
      {/* Barra lateral da faixa */}
      <span
        className="absolute left-0 top-0 h-full w-1"
        style={{ background: cor }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {ind.categoria}
          </p>
          <p className="mt-0.5 text-sm font-semibold leading-tight">
            {ind.label}
          </p>
        </div>
        <span
          aria-hidden
          className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
          style={{ background: cor }}
        />
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums tracking-tight">
          {formatIndicador(ind.valor_atual, ind.formato)}
        </span>
        {ind.variacao_pct != null && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold",
              variacaoBoa
                ? "bg-success/10 text-success"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {subindo ? "▲" : "▼"}
            {Math.abs(ind.variacao_pct).toFixed(1).replace(".", ",")}%
          </span>
        )}
      </div>

      <div className="mt-2">
        <MiniTrend values={values} color={cor} height={42} />
      </div>

      <p className="mt-2 text-[11px] leading-snug text-muted-foreground line-clamp-3">
        {ind.leitura_empresario}
      </p>

      {modoTecnico && (
        <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground/80">
          {ind.formulaTexto}
        </p>
      )}

      <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground/80 opacity-0 transition-opacity group-hover:opacity-100">
        → Ver origem dos dados
      </p>
    </Card>
  );
}
