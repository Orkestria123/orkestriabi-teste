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
  values: Record<string, number>; // period -> value
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

  // Colunas efetivas: períodos + subtotais intercalados.
  type Col =
    | { kind: "p"; period: string; firstOfBucket: boolean }
    | { kind: "sub"; label: string; periods: string[] };
  const columns = useMemo<Col[]>(() => {
    const cols: Col[] = [];
    if (bucketGroups.length === 0) {
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
  }, [periods, bucketGroups]);

  const subtotalValue = (row: StatementRow, groupPeriods: string[]) => {
    if (variante === "bp") {
      const last = groupPeriods[groupPeriods.length - 1];
      return row.values[last] ?? 0;
    }
    return groupPeriods.reduce((a, p) => a + (row.values[p] ?? 0), 0);
  };

  // Banda superior com o ano só faz sentido no agrupamento "ano" multi-ano.
  const yearBand = bucketOpt === "ano" && isMultiYear ? bucketGroups : null;



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
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/20 text-xs">
        <span className="text-muted-foreground">{unidadeLabel}</span>
        <div className="flex items-center gap-2">
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
              <th className="text-left font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-2 sticky left-0 z-10 bg-muted/30 min-w-[220px] max-w-[280px] border-b">
                Descrição
              </th>
              {columns.map((c, i) =>
                c.kind === "p" ? (
                  <th
                    key={`p-${c.period}`}
                    className={cn(
                      "text-right font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-2 tabular-nums whitespace-nowrap min-w-[110px] border-b",
                      c.firstOfBucket && "border-l",
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
              {showAV && (
                <th className="text-right font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-2 whitespace-nowrap min-w-[70px] border-b">
                  AV%
                </th>
              )}
              {showAH && basePeriod && (
                <th className="text-right font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-2 whitespace-nowrap min-w-[70px] border-b">
                  AH%
                </th>
              )}
            </tr>
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

              return (
                <Fragment key={idx}>
                  <tr
                    className={cn(
                      "border-b last:border-0 hover:bg-accent/40 transition-colors",
                      row.is_subtotal && "bg-muted/40 font-semibold",
                      isExpanded && "bg-accent/30",
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
                    {columns.map((c, i) =>
                      c.kind === "p" ? (
                        <td
                          key={`p-${c.period}`}
                          className={cn(
                            "px-2 py-1 text-right tabular-nums whitespace-nowrap text-xs min-w-[110px]",
                            c.firstOfYear && "border-l",
                          )}
                        >
                          {fmt(row.values[c.period] ?? 0)}
                        </td>
                      ) : (
                        <td
                          key={`sub-${c.year}-${i}`}
                          className={cn(
                            "px-2 py-1 text-right tabular-nums whitespace-nowrap text-xs font-semibold border-l min-w-[110px] bg-muted/40",
                          )}
                        >
                          {fmt(subtotalYear(row, { year: c.year, periods: c.periods }))}
                        </td>
                      ),
                    )}
                    {effectiveShowTotal && (
                      <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-xs font-semibold border-l min-w-[110px]">
                        {fmt(total)}
                      </td>
                    )}
                    {showAV && (
                      <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-xs text-muted-foreground min-w-[70px]">
                        {av != null ? formatPct(av) : "—"}
                      </td>
                    )}
                    {showAH && basePeriod && (
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


