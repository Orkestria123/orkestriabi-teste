import { useMemo, useState, Fragment } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { formatBRLPlain, formatPct, periodoLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { InlineDrilldown } from "@/components/inline-drilldown";

export interface StatementRow {
  descricao: string;
  codigo_conta: string | null;
  nivel: number;
  is_subtotal: boolean;
  values: Record<string, number>; // period -> value (contábil ou visão única)
  /** Presente apenas no modo comparativo — valores da visão gerencial. */
  valuesGer?: Record<string, number>;
  linha_ordem: number;
}

interface Props {
  rows: StatementRow[];
  periods: string[];
  showAV?: boolean;
  showAH?: boolean;
  showTotal?: boolean;
  basePeriod?: string;
  avBaseCodigo?: string;
  /** Nível máximo expandido por padrão (padrão: tudo expandido). */
  initialExpandLevel?: number;
  /** Contexto do drill-down: "bp" inclui saldo inicial. */
  variante?: "dre" | "bp";
}

export function StatementTable({
  rows,
  periods,
  showAV = false,
  showAH = false,
  showTotal = false,
  basePeriod,
  avBaseCodigo,
  initialExpandLevel,
  variante = "dre",
}: Props) {
  const avBase = useMemo(() => {
    if (!avBaseCodigo) return null;
    const r = rows.find(
      (x) =>
        x.codigo_conta === avBaseCodigo ||
        x.descricao.toLowerCase().includes(avBaseCodigo.toLowerCase()),
    );
    return r ?? null;
  }, [rows, avBaseCodigo]);

  // Compute children ranges based on nivel
  const childrenMap = useMemo(() => {
    const map = new Map<number, number[]>(); // parent idx -> all descendant indices
    for (let i = 0; i < rows.length; i++) {
      const lvl = rows[i].nivel ?? 0;
      const desc: number[] = [];
      for (let j = i + 1; j < rows.length; j++) {
        if ((rows[j].nivel ?? 0) > lvl) desc.push(j);
        else break;
      }
      if (desc.length > 0) map.set(i, desc);
    }
    return map;
  }, [rows]);

  const [collapsed, setCollapsed] = useState<Set<number>>(() => {
    if (initialExpandLevel == null) return new Set();
    const s = new Set<number>();
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i].nivel ?? 0) >= initialExpandLevel) s.add(i);
    }
    return s;
  });

  const hidden = useMemo(() => {
    const h = new Set<number>();
    collapsed.forEach((idx) => {
      const d = childrenMap.get(idx);
      if (d) d.forEach((c) => h.add(c));
    });
    return h;
  }, [collapsed, childrenMap]);

  const toggle = (idx: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  const allParents = useMemo(
    () => Array.from(childrenMap.keys()),
    [childrenMap],
  );
  const allCollapsed = allParents.length > 0 && allParents.every((p) => collapsed.has(p));

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(allParents));

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpand = (idx: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  const [emMilhares, setEmMilhares] = useState(false);
  const scale = emMilhares ? 1000 : 1;
  const digits = emMilhares ? 1 : 2;
  const fmt = (n: number) => formatBRLPlain(n, { digits, scale });
  const unidadeLabel = emMilhares ? "Valores em R$ mil" : "Valores em R$";

  // Anos distintos entre os períodos selecionados.
  const anosSelecionados = useMemo(() => {
    const s = new Set<number>();
    for (const p of periods) s.add(new Date(p).getUTCFullYear());
    return Array.from(s).sort((a, b) => a - b);
  }, [periods]);
  const isMultiYear = anosSelecionados.length > 1;

  type BucketOpt = "mes" | "trimestre" | "semestre" | "ano" | "selecao";
  const [bucketOpt, setBucketOpt] = useState<BucketOpt>(() =>
    isMultiYear ? "ano" : "selecao",
  );

  // Chave/label do bucket a partir de um período.
  function bucketOf(period: string): { key: string; label: string } {
    const d = new Date(period);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth(); // 0-11
    const anoSuf = isMultiYear ? ` ${y}` : "";
    switch (bucketOpt) {
      case "mes":
        return { key: `${y}-${m}`, label: "" };
      case "trimestre": {
        const q = Math.floor(m / 3) + 1;
        return { key: `${y}-q${q}`, label: `${q}º Tri${anoSuf}` };
      }
      case "semestre": {
        const s = m < 6 ? 1 : 2;
        return { key: `${y}-s${s}`, label: `${s}º Sem${anoSuf}` };
      }
      case "ano":
        return { key: `${y}`, label: `Total ${y}` };
      case "selecao":
        return { key: "all", label: "Total" };
    }
  }

  // Agrupa períodos por bucket em ordem cronológica.
  const bucketGroups = useMemo(() => {
    if (!showTotal || bucketOpt === "mes") return [] as { key: string; label: string; periods: string[] }[];
    const out: { key: string; label: string; periods: string[] }[] = [];
    for (const p of periods) {
      const { key, label } = bucketOf(p);
      const last = out[out.length - 1];
      if (last && last.key === key) last.periods.push(p);
      else out.push({ key, label, periods: [p] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods, bucketOpt, showTotal, isMultiYear]);

  // Detecta modo comparativo: pelo menos uma linha traz valuesGer.
  const isComparativo = useMemo(() => rows.some((r) => r.valuesGer), [rows]);

  // Colunas efetivas: períodos + subtotais intercalados.
  type Col =
    | { kind: "p"; period: string; firstOfBucket: boolean }
    | { kind: "sub"; label: string; periods: string[] };
  const columns = useMemo<Col[]>(() => {
    const cols: Col[] = [];
    // Modo comparativo: sem buckets/subtotais para manter a tabela legível.
    if (isComparativo || bucketGroups.length === 0) {
      for (const p of periods) cols.push({ kind: "p", period: p, firstOfBucket: false });
      return cols;
    }
    for (const g of bucketGroups) {
      g.periods.forEach((p, i) => {
        cols.push({ kind: "p", period: p, firstOfBucket: i === 0 && bucketGroups.length > 1 });
      });
      cols.push({ kind: "sub", label: g.label, periods: g.periods });
    }
    return cols;
  }, [periods, bucketGroups, isComparativo]);

  const subtotalValue = (row: StatementRow, groupPeriods: string[]) => {
    if (variante === "bp") {
      const last = groupPeriods[groupPeriods.length - 1];
      return row.values[last] ?? 0;
    }
    return groupPeriods.reduce((a, p) => a + (row.values[p] ?? 0), 0);
  };

  // Banda superior com o ano só faz sentido no agrupamento "ano" multi-ano.
  const yearBand = !isComparativo && bucketOpt === "ano" && isMultiYear ? bucketGroups : null;

  // Resumo do impacto dos ajustes gerenciais por período (só no comparativo).
  // Mostramos a diferença da ÚLTIMA linha de subtotal — que é a linha "final"
  // da demonstração (Lucro Líquido na DRE, Total do Passivo+PL no BP etc.).
  // Se a última for zero (ex.: BP fecha), procuramos rows "chave" com maior
  // impacto absoluto ("Resultado do Exercício" no PL etc.).
  const impactoResumo = useMemo(() => {
    if (!isComparativo) return null;
    // Escolhe uma linha "resumo": preferimos as que casam com palavras-chave.
    const kw = /lucro\s+l[ií]quido|resultado do exerc[ií]cio|resultado l[ií]quido/i;
    let target: StatementRow | undefined = rows.find((r) => kw.test(r.descricao));
    if (!target) {
      // fallback: última linha subtotal
      const subs = rows.filter((r) => r.is_subtotal);
      target = subs[subs.length - 1] ?? rows[rows.length - 1];
    }
    if (!target) return null;
    return {
      label: target.descricao,
      diffs: periods.map((p) => ({
        p,
        diff: (target!.valuesGer?.[p] ?? target!.values[p] ?? 0) - (target!.values[p] ?? 0),
      })),
    };
  }, [isComparativo, rows, periods]);




  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
        Nenhum dado encontrado para os filtros selecionados.
        <br />
        Faça upload de um arquivo SPED para começar.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {impactoResumo && (
        <div className="px-3 py-2 border-b bg-primary/5 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-medium text-foreground">
            Impacto dos ajustes gerenciais em {impactoResumo.label}:
          </span>
          {impactoResumo.diffs.map(({ p, diff }) => (
            <span key={p} className="text-muted-foreground">
              {periodoLabel(p)}:{" "}
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  diff > 0 && "text-success",
                  diff < 0 && "text-destructive",
                  diff === 0 && "text-muted-foreground",
                )}
              >
                {diff === 0 ? "—" : (diff > 0 ? "+" : "") + fmt(diff)}
              </span>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/20 text-xs">
        <span className="text-muted-foreground">{unidadeLabel}</span>
        <div className="flex items-center gap-2">
          {showTotal && periods.length > 0 && (
            <label className="flex items-center gap-1.5 text-muted-foreground">
              <span>Totalizar por:</span>
              <select
                value={bucketOpt}
                onChange={(e) => setBucketOpt(e.target.value as BucketOpt)}
                className="h-7 px-2 rounded-md border border-border bg-background hover:bg-accent transition-colors text-foreground"
              >
                <option value="mes">Mês</option>
                <option value="trimestre">Trimestre</option>
                <option value="semestre">Semestre</option>
                <option value="ano">Ano</option>
                <option value="selecao">Seleção inteira</option>
              </select>
            </label>
          )}
          <button
            onClick={() => setEmMilhares((v) => !v)}
            className="px-2 h-7 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            {emMilhares ? "Mostrar valor cheio" : "Mostrar em R$ mil"}
          </button>
          {allParents.length > 0 && (
            <button
              onClick={allCollapsed ? expandAll : collapseAll}
              className="px-2 h-7 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            >
              {allCollapsed ? "Expandir todos" : "Recolher todos"}
            </button>
          )}
        </div>

      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            {yearBand && (
              <tr className="border-b bg-muted/20">
                <th className="sticky left-0 z-10 bg-muted/20 border-b" />
                {yearBand.map((g) => (
                  <th
                    key={g.key}
                    colSpan={g.periods.length + 1}
                    className="text-center font-semibold text-[11px] text-foreground px-2 py-1.5 border-l border-b"
                  >
                    {g.key}
                  </th>
                ))}
                {showAV && <th className="border-b" />}
                {showAH && basePeriod && <th className="border-b" />}
              </tr>
            )}
            <tr className="border-b bg-muted/30">
              <th
                rowSpan={isComparativo ? 2 : 1}
                className="text-left font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-2 sticky left-0 z-10 bg-muted/30 min-w-[220px] max-w-[280px] border-b"
              >
                Descrição
              </th>
              {columns.map((c, i) =>
                c.kind === "p" ? (
                  <th
                    key={`p-${c.period}`}
                    colSpan={isComparativo ? 3 : 1}
                    className={cn(
                      "text-center font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-2 tabular-nums whitespace-nowrap border-b",
                      isComparativo ? "min-w-[330px] border-l" : "min-w-[110px] text-right",
                      !isComparativo && c.firstOfBucket && "border-l",
                    )}
                  >
                    {periodoLabel(c.period)}
                  </th>
                ) : (
                  <th
                    key={`sub-${i}`}
                    className="text-right font-semibold text-[10px] uppercase tracking-wider text-foreground px-2 py-2 tabular-nums whitespace-nowrap min-w-[110px] border-b border-l bg-muted/40"
                  >
                    {c.label}
                  </th>
                ),
              )}
              {showAV && !isComparativo && (
                <th className="text-right font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-2 whitespace-nowrap min-w-[70px] border-b">
                  AV%
                </th>
              )}
              {showAH && basePeriod && !isComparativo && (
                <th className="text-right font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-2 whitespace-nowrap min-w-[70px] border-b">
                  AH%
                </th>
              )}
            </tr>
            {isComparativo && (
              <tr className="border-b bg-muted/20">
                {columns.map((c) =>
                  c.kind === "p" ? (
                    <Fragment key={`ph-${c.period}`}>
                      <th className="text-right font-medium text-[10px] text-muted-foreground px-2 py-1 whitespace-nowrap min-w-[110px] border-b border-l">
                        Contábil
                      </th>
                      <th className="text-right font-medium text-[10px] text-muted-foreground px-2 py-1 whitespace-nowrap min-w-[110px] border-b">
                        Gerencial
                      </th>
                      <th className="text-right font-medium text-[10px] text-muted-foreground px-2 py-1 whitespace-nowrap min-w-[110px] border-b">
                        Diferença
                      </th>
                    </Fragment>
                  ) : null,
                )}
              </tr>
            )}
          </thead>

          <tbody>
            {rows.map((row, idx) => {
              if (hidden.has(idx)) return null;
              const lastPeriod = periods[periods.length - 1];
              const lastValue = row.values[lastPeriod] ?? 0;
              const av =
                avBase && avBase.values[lastPeriod]
                  ? (lastValue / avBase.values[lastPeriod]) * 100
                  : null;
              const baseValue = basePeriod ? row.values[basePeriod] : null;
              const ah =
                baseValue != null && baseValue !== 0
                  ? ((lastValue - baseValue) / Math.abs(baseValue)) * 100
                  : null;
              const hasChildren = childrenMap.has(idx);
              const isCollapsed = collapsed.has(idx);
              const isExpanded = expanded.has(idx);
              const canDrill = !!row.codigo_conta;
              const extraMiddle = bucketGroups.length;
              const rightCols = (showAV ? 1 : 0) + (showAH && basePeriod ? 1 : 0);

              // No modo comparativo, destaca linhas cuja diferença ≠ 0 em algum período.
              const hasDiff =
                isComparativo &&
                periods.some((p) => {
                  const c = row.values[p] ?? 0;
                  const g = row.valuesGer?.[p] ?? c;
                  return g - c !== 0;
                });

              return (
                <Fragment key={idx}>
                  <tr
                    className={cn(
                      "border-b last:border-0 hover:bg-accent/40 transition-colors",
                      row.is_subtotal && "bg-muted/40 font-semibold",
                      isExpanded && "bg-accent/30",
                      hasDiff && "bg-amber-500/5",
                    )}
                  >
                    <td
                      className={cn(
                        "px-2 py-1 sticky left-0 z-10 bg-card text-sm min-w-[220px] max-w-[280px]",
                        row.is_subtotal && "bg-muted/40",
                        isExpanded && "bg-accent/30",
                      )}
                      style={{ paddingLeft: `${8 + row.nivel * 12}px` }}
                    >
                      <div className="flex items-center gap-1 min-w-0">
                        {hasChildren ? (
                          <button
                            onClick={() => toggle(idx)}
                            className="shrink-0 grid place-items-center h-4 w-4 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                            aria-label={isCollapsed ? "Expandir" : "Recolher"}
                          >
                            <ChevronRight
                              className={cn(
                                "h-3 w-3 transition-transform",
                                !isCollapsed && "rotate-90",
                              )}
                            />
                          </button>
                        ) : (
                          <span className="inline-block w-4 shrink-0" />
                        )}
                        {canDrill ? (
                          <button
                            type="button"
                            onClick={() => toggleExpand(idx)}
                            className={cn(
                              "text-left hover:text-primary transition-colors inline-flex items-center gap-1 group min-w-0 truncate",
                              row.nivel >= 3 && !row.is_subtotal && "text-muted-foreground",
                            )}
                            title={row.descricao}
                          >
                            <ChevronDown
                              className={cn(
                                "h-3 w-3 shrink-0 text-muted-foreground/60 group-hover:text-primary transition-transform",
                                isExpanded && "rotate-180 text-primary",
                              )}
                            />
                            <span className="truncate">{row.descricao}</span>
                          </button>
                        ) : (
                          <span
                            title={row.descricao}
                            className={cn(
                              "truncate",
                              row.nivel >= 3 && !row.is_subtotal && "text-muted-foreground",
                            )}
                          >
                            {row.descricao}
                          </span>
                        )}
                      </div>
                    </td>
                    {columns.map((c, i) => {
                      if (c.kind === "sub") {
                        return (
                          <td
                            key={`sub-${i}`}
                            className={cn(
                              "px-2 py-1 text-right tabular-nums whitespace-nowrap text-xs font-semibold border-l min-w-[110px] bg-muted/40",
                            )}
                          >
                            {fmt(subtotalValue(row, c.periods))}
                          </td>
                        );
                      }
                      if (isComparativo) {
                        const vc = row.values[c.period] ?? 0;
                        const vg = row.valuesGer?.[c.period] ?? vc;
                        const diff = vg - vc;
                        return (
                          <Fragment key={`p-${c.period}`}>
                            <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-xs min-w-[110px] border-l">
                              {fmt(vc)}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-xs min-w-[110px]">
                              {fmt(vg)}
                            </td>
                            <td
                              className={cn(
                                "px-2 py-1 text-right tabular-nums whitespace-nowrap text-xs font-semibold min-w-[110px]",
                                diff > 0 && "text-success",
                                diff < 0 && "text-destructive",
                              )}
                            >
                              {diff === 0
                                ? <span className="text-muted-foreground/60">—</span>
                                : (diff > 0 ? "+" : "") + fmt(diff)}
                            </td>
                          </Fragment>
                        );
                      }
                      return (
                        <td
                          key={`p-${c.period}`}
                          className={cn(
                            "px-2 py-1 text-right tabular-nums whitespace-nowrap text-xs min-w-[110px]",
                            c.firstOfBucket && "border-l",
                          )}
                        >
                          {fmt(row.values[c.period] ?? 0)}
                        </td>
                      );
                    })}

                    {showAV && !isComparativo && (
                      <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-xs text-muted-foreground min-w-[70px]">
                        {av != null ? formatPct(av) : "—"}
                      </td>
                    )}
                    {showAH && basePeriod && !isComparativo && (
                      <td
                        className={cn(
                          "px-2 py-1 text-right tabular-nums whitespace-nowrap text-xs min-w-[70px]",
                          ah != null && ah > 0 && "text-success",
                          ah != null && ah < 0 && "text-destructive",
                        )}
                      >
                        {ah != null ? formatPct(ah) : "—"}
                      </td>
                    )}
                  </tr>
                  {isExpanded && canDrill && (
                    <InlineDrilldown
                      codigoConta={row.codigo_conta!}
                      descricao={row.descricao}
                      periods={periods}
                      colSpanLeft={1}
                      colSpanRight={rightCols}
                      extraMiddleCols={extraMiddle}
                      variante={variante}
                      emMilhares={emMilhares}
                    />
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


