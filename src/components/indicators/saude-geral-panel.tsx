import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  calcularScore,
  gerarDestaques,
  type IndicadorCompleto,
} from "@/lib/indicators";
import { GaugeChart } from "./gauge-chart";

interface Props {
  indicadores: IndicadorCompleto[];
}

export function SaudeGeralPanel({ indicadores }: Props) {
  const score = calcularScore(indicadores);
  const destaques = gerarDestaques(indicadores);
  const status =
    score >= 70
      ? { label: "Empresa saudável", cor: "text-success" }
      : score >= 40
      ? { label: "Pontos de atenção", cor: "text-warning" }
      : { label: "Requer ação", cor: "text-destructive" };

  const contagem = {
    otimo: indicadores.filter((i) => i.faixa === "otimo").length,
    bom: indicadores.filter((i) => i.faixa === "bom").length,
    atencao: indicadores.filter((i) => i.faixa === "atencao").length,
    critico: indicadores.filter((i) => i.faixa === "critico").length,
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr]">
        {/* Velocímetro */}
        <div className="flex flex-col items-center justify-center border-b bg-gradient-to-br from-card to-muted/30 p-6 md:border-b-0 md:border-r">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Saúde Financeira
          </p>
          <GaugeChart value={score} size={200} />
          <p className={cn("mt-1 text-sm font-semibold", status.cor)}>
            {status.label}
          </p>
        </div>

        {/* Destaques + contagem */}
        <div className="space-y-4 p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Distribuição
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {contagem.otimo > 0 && (
                <span className="rounded-md bg-success/10 px-2 py-1 font-medium text-success">
                  {contagem.otimo} ótimo{contagem.otimo > 1 ? "s" : ""}
                </span>
              )}
              {contagem.bom > 0 && (
                <span className="rounded-md bg-success/5 px-2 py-1 font-medium text-success/80">
                  {contagem.bom} bom{contagem.bom > 1 ? "s" : ""}
                </span>
              )}
              {contagem.atencao > 0 && (
                <span className="rounded-md bg-warning/10 px-2 py-1 font-medium text-warning">
                  {contagem.atencao} atenção
                </span>
              )}
              {contagem.critico > 0 && (
                <span className="rounded-md bg-destructive/10 px-2 py-1 font-medium text-destructive">
                  {contagem.critico} crítico{contagem.critico > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Destaques do período
            </p>
            {destaques.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Sem variações significativas no período.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {destaques.map((d, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span
                      className={cn(
                        "mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                        d.positivo
                          ? "bg-success/15 text-success"
                          : "bg-destructive/15 text-destructive",
                      )}
                    >
                      {d.positivo ? "✓" : "⚠"}
                    </span>
                    <span className="leading-snug">{d.texto}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
