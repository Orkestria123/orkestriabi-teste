import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { formatBRL, formatBRLCompact, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isCustoDespesa } from "@/lib/analise-helpers";
import { ChevronDown, ChevronRight, Zap } from "lucide-react";
import { ExpandirControles } from "@/components/expandir-controles";
import {
  expandirAteNivel,
  expandirUmaCamada,
  filhosDiretos,
  indicesComFilhos,
  linhaVisivel,
  mesmoConjunto,
  modoExpandirAtual,
  nivelAbertoMaximo,
} from "@/lib/hierarquia-linhas";

export interface CompRow {
  linha_ordem: number;
  descricao: string;
  nivel: number;
  is_subtotal: boolean;
  valorA: number;
  valorB: number;
}

interface Props {
  rows: CompRow[];
  labelA: string;
  labelB: string;
  /** Modo apresentação: oculta colunas de valor absoluto e aumenta a fonte */
  presentation?: boolean;
}

const PADRAO_MAX_NIVEL = 0;

export function ComparativoTable({ rows, labelA, labelB, presentation }: Props) {
  const estruturaKey = rows.map((r) => `${r.linha_ordem}:${r.nivel}`).join("|");
  const [abertos, setAbertos] = useState<Set<number>>(() =>
    expandirAteNivel(rows, PADRAO_MAX_NIVEL),
  );
  useEffect(() => {
    setAbertos(expandirAteNivel(rows, PADRAO_MAX_NIVEL));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estruturaKey]);

  const comFilhos = useMemo(() => indicesComFilhos(rows), [rows]);
  const visiveis = useMemo(
    () => rows.map((_, i) => i).filter((i) => linhaVisivel(rows, i, abertos)),
    [rows, abertos],
  );

  const modo = modoExpandirAtual(rows, abertos, PADRAO_MAX_NIVEL);
  const abertoMax = nivelAbertoMaximo(rows, abertos);
  const camada = expandirUmaCamada(rows, abertos);

  const toggle = (i: number) =>
    setAbertos((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  if (rows.length === 0) {
    return (
      <Card className="p-10 text-center text-sm text-muted-foreground">
        Nenhum dado para os períodos selecionados.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      {comFilhos.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/20 text-xs">
          <span className="text-muted-foreground">
            {visiveis.length} de {rows.length} linhas
          </span>
          <ExpandirControles
            modo={modo}
            podeRecolherUmNivel={abertoMax >= 0}
            podeExpandirUmNivel={!mesmoConjunto(camada, abertos)}
            onRecolherUmNivel={() => setAbertos(expandirAteNivel(rows, abertoMax - 1))}
            onExpandirUmNivel={() => setAbertos(expandirUmaCamada(rows, abertos))}
            onPadrao={() => setAbertos(expandirAteNivel(rows, PADRAO_MAX_NIVEL))}
            onExpandirTudo={() => setAbertos(new Set(comFilhos))}
            onRecolher={() => setAbertos(new Set())}
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className={cn("w-full", presentation ? "text-sm" : "text-xs")}>
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-4 py-3 font-medium uppercase tracking-wider text-muted-foreground sticky left-0 bg-muted/30 text-[11px]">
                Descrição
              </th>
              {!presentation && (
                <>
                  <th className="text-right px-4 py-3 font-medium uppercase tracking-wider text-muted-foreground tabular-nums text-[11px]">{labelA}</th>
                  <th className="text-right px-4 py-3 font-medium uppercase tracking-wider text-muted-foreground tabular-nums text-[11px]">{labelB}</th>
                </>
              )}
              <th className="text-right px-4 py-3 font-medium uppercase tracking-wider text-muted-foreground tabular-nums text-[11px]">Var R$</th>
              <th className="text-right px-4 py-3 font-medium uppercase tracking-wider text-muted-foreground tabular-nums text-[11px]">Var %</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((i) => {
              const r = rows[i];
              const delta = r.valorB - r.valorA;
              const variacao = r.valorA !== 0 ? (delta / Math.abs(r.valorA)) * 100 : null;
              const inverter = !r.is_subtotal && isCustoDespesa(r.descricao);
              const rawPos = variacao != null && variacao > 0;
              const rawNeg = variacao != null && variacao < 0;
              const positive = inverter ? rawNeg : rawPos;
              const negative = inverter ? rawPos : rawNeg;
              const extreme = variacao != null && Math.abs(variacao) > 50;
              const temFilhos = filhosDiretos(rows, i).length > 0;
              const aberto = abertos.has(i);

              return (
                <tr key={`${r.linha_ordem}-${i}`} className={cn("border-t hover:bg-accent/40", r.is_subtotal && "bg-muted/40 font-semibold")}>
                  <td
                    className={cn("px-4 sticky left-0 bg-card", presentation ? "py-3" : "py-2.5")}
                    style={{ paddingLeft: `${16 + r.nivel * 14}px` }}
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      {temFilhos ? (
                        <button
                          type="button"
                          onClick={() => toggle(i)}
                          className="shrink-0 grid place-items-center h-4 w-4 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={aberto ? "Recolher" : "Expandir"}
                        >
                          {aberto ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                        </button>
                      ) : (
                        <span className="inline-block w-4 shrink-0" />
                      )}
                      <span className="truncate" title={r.descricao}>
                        {r.descricao}
                      </span>
                    </div>
                  </td>
                  {!presentation && (
                    <>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(r.valorA)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(r.valorB)}</td>
                    </>
                  )}
                  <td className={cn("px-4 text-right tabular-nums", presentation ? "py-3 text-sm" : "py-2.5")}>
                    {formatBRLCompact(delta)}
                  </td>
                  <td className={cn(
                    "px-4 text-right tabular-nums font-medium",
                    presentation ? "py-3 text-sm" : "py-2.5",
                    positive && "text-success",
                    negative && "text-destructive",
                  )}>
                    {variacao != null ? (
                      <span className="inline-flex items-center justify-end gap-1">
                        {extreme && <Zap className="h-3 w-3 animate-pulse" />}
                        {variacao > 0 ? "▲" : variacao < 0 ? "▼" : ""} {formatPct(Math.abs(variacao), 1)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
