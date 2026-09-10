// src/components/statement-table.tsx
import { useState, useMemo, useEffect, Fragment } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFiltersOptional } from '@/components/filter-bar';
import { InlineDrilldown } from './inline-drilldown';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { resolverBasesAV, percentualAV } from '@/lib/av-base';
import { tituloConta as formatarTituloConta } from '@/lib/format';
import {
  AGRUPADOR_LABEL,
  AGRUPADORES,
  montarColunas,
  valorSubtotal,
  gruposMesAnoAAno,
  anoCurto,
  type Agrupador,
  type ColunaAgrupada,
} from '@/lib/dre-acumulo';
import {
  ehRotuloResultadoExercicio,
  rotuloResultadoDasColunas,
} from '@/lib/diario/build-statements';

export interface StatementRow {
  linha_ordem: number;
  descricao: string;
  codigo_conta: string | null;
  nivel: number;
  is_subtotal: boolean;
  values: Record<string, number>;
  valuesGer?: Record<string, number>;
}

interface StatementTableProps {
  rows: StatementRow[];
  periods?: string[];
  showAV?: boolean;
  showAH?: boolean;
  showTotal?: boolean;
  basePeriod?: string;
  avBaseCodigo?: string;
  avSelecionadas?: string[];
  initialExpandLevel?: number;
  variante?: 'dre' | 'bp' | 'dfc';
  /** Profundidade da visualização Padrão. BP usa 2 se omitido; Ativo pode passar 3. */
  padraoMaxNivel?: number;
  onDrilldownClick?: (codigoConta: string, descricao: string) => void;
  emMilhares?: boolean;
  /** Balanço: Ativo à esquerda e Passivo+PL à direita, com a mesma barra de filtro/expandir. */
  lados?: boolean;
}

// Utilitários
function formatarMoeda(valor: number, emMilhares: boolean = false): string {
  if (valor === 0 || !isFinite(valor)) return '—';
  const divisor = emMilhares ? 1000 : 1;
  const val = Math.abs(valor) / divisor;
  const formatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: emMilhares ? 1 : 2,
    maximumFractionDigits: emMilhares ? 1 : 2,
  }).format(val);
  return valor < 0 ? `(${formatted})` : formatted;
}

function formatarPercentual(valor: number): string {
  if (valor == null || !isFinite(valor)) return '—';
  return `${valor.toFixed(1).replace('.', ',')}%`;
}

function formatarPeriodo(periodo: string): string {
  if (!periodo) return '';
  const parts = periodo.split('-');
  if (parts.length < 2) return periodo;
  const [ano, mes] = parts;
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${meses[parseInt(mes) - 1]}/${ano.slice(2)}`;
}

function tituloConta(descricao: string, variante: 'dre' | 'bp' | 'dfc' = 'dre'): string {
  if (!descricao) return '';
  const semMarca = descricao
    .replace(/^\(=\)\s*/, '')
    .replace(/^\(-\)\s*/, '')
    .replace(/^\(\+\)\s*/, '')
    .replace(/^=\s*/, '');
  const t = formatarTituloConta(semMarca);
  if (variante !== 'dfc') return t;
  // Preposição "das" — o formatador trata DAS como o tributo do Simples.
  return t.replace(/\bCaixa DAS Atividades\b/g, 'Caixa Das Atividades');
}

function valoresColunasVisiveis(
  row: StatementRow,
  colunas: ColunaAgrupada[],
  variante: 'dre' | 'bp' | 'dfc',
): number[] {
  const out: number[] = [];
  for (const col of colunas) {
    if (col.kind === 's') {
      const bruto = valorSubtotal(row.values, col.periodos, variante);
      out.push(bruto);
      if (row.valuesGer) {
        out.push(valorSubtotal(row.valuesGer, col.periodos, variante));
      }
    } else {
      const v = row.values[col.periodo] ?? 0;
      out.push(v);
      if (row.valuesGer) out.push(row.valuesGer[col.periodo] ?? v);
    }
  }
  return out;
}

function descricaoExibida(
  row: StatementRow,
  colunas: ColunaAgrupada[],
  variante: 'dre' | 'bp' | 'dfc',
): string {
  if (variante !== 'dre' || !ehRotuloResultadoExercicio(row.descricao)) {
    return row.descricao;
  }
  return rotuloResultadoDasColunas(valoresColunasVisiveis(row, colunas, variante));
}

function calcularAH(
  row: StatementRow,
  periodo: string,
  periods: string[],
  basePeriod: string,
  tipo: 'anterior' | 'base',
): number | null {
  const ler = (p: string) =>
    row.valuesGer && row.valuesGer[p] !== undefined
      ? row.valuesGer[p]
      : (row.values[p] ?? 0);
  const valorAtual = ler(periodo);
  let valorBase: number;
  if (tipo === 'anterior') {
    const multiAno = new Set(periods.map((p) => p.slice(0, 4))).size > 1;
    if (multiAno) {
      const y = parseInt(periodo.slice(0, 4), 10);
      const alvoYm = `${y - 1}${periodo.slice(4, 7)}`;
      const prev =
        periods.find((p) => p.slice(0, 7) === alvoYm) ??
        Object.keys(row.values).find((p) => p.slice(0, 7) === alvoYm);
      if (!prev) return null;
      valorBase = ler(prev);
    } else {
      const idx = periods.indexOf(periodo);
      if (idx <= 0) return null;
      valorBase = ler(periods[idx - 1]);
    }
  } else {
    if (periodo === basePeriod) return null;
    valorBase = ler(basePeriod);
  }
  if (valorBase === 0 || Math.abs(valorBase) < 0.001) return null;
  return ((valorAtual - valorBase) / Math.abs(valorBase)) * 100;
}

function rowId(row: StatementRow) {
  return `${row.linha_ordem}::${row.codigo_conta ?? row.descricao}`;
}

function directChildren(rows: StatementRow[], index: number): number[] {
  const nivel = rows[index].nivel;
  const children: number[] = [];
  let childNivel: number | null = null;
  for (let i = index + 1; i < rows.length; i++) {
    if (rows[i].nivel <= nivel) break;
    if (childNivel === null) childNivel = rows[i].nivel;
    if (rows[i].nivel === childNivel) children.push(i);
  }
  return children;
}

function parentIndex(rows: StatementRow[], index: number): number {
  const nivel = rows[index].nivel;
  for (let i = index - 1; i >= 0; i--) {
    if (rows[i].nivel < nivel) return i;
  }
  return -1;
}

function isRowVisible(rows: StatementRow[], index: number, expanded: Set<string>): boolean {
  let i = parentIndex(rows, index);
  while (i >= 0) {
    if (!expanded.has(rowId(rows[i]))) return false;
    i = parentIndex(rows, i);
  }
  return true;
}

function expandPadrao(
  rows: StatementRow[],
  variante: "dre" | "bp" | "dfc" = "dre",
  padraoMaxNivel?: number,
): Set<string> {
  const set = new Set<string>();
  // DRE/DFC: grupos da demonstração (nível 0) abertos.
  // BP: lado + grupos + primeiro nível de contas (2). Ativo pode ir a 3.
  const maxNivel = padraoMaxNivel ?? (variante === "bp" ? 2 : 0);
  rows.forEach((row, index) => {
    if (directChildren(rows, index).length === 0) return;
    if (row.nivel <= maxNivel) set.add(rowId(row));
  });
  return set;
}

function expandAteNivel(rows: StatementRow[], nivelMax: number): Set<string> {
  const set = new Set<string>();
  rows.forEach((row, index) => {
    if (directChildren(rows, index).length === 0) return;
    if (row.nivel <= nivelMax) set.add(rowId(row));
  });
  return set;
}

/** Abre só os pais que já estão visíveis e ainda fechados — uma camada, mesmo se o nível pular (0→2→4). */
function expandirCamada(rows: StatementRow[], expanded: Set<string>): Set<string> {
  const next = new Set(expanded);
  rows.forEach((row, index) => {
    if (directChildren(rows, index).length === 0) return;
    const id = rowId(row);
    if (next.has(id)) return;
    if (!isRowVisible(rows, index, expanded)) return;
    next.add(id);
  });
  return next;
}

function nivelAbertoMax(rows: StatementRow[], expanded: Set<string>): number {
  let m = -1;
  rows.forEach((row, index) => {
    if (directChildren(rows, index).length === 0) return;
    if (expanded.has(rowId(row))) m = Math.max(m, row.nivel);
  });
  return m;
}
function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function StatementTable({
  rows,
  periods: periodsProp,
  showAV = false,
  showAH = false,
  basePeriod,
  avBaseCodigo,
  avSelecionadas,
  initialExpandLevel = 1,
  variante = 'dre',
  padraoMaxNivel,
  onDrilldownClick,
  emMilhares = false,
  lados = false,
}: StatementTableProps) {
  // Períodos vêm da prop (DRE/BP) ou, se omitidos, do FilterProvider do dashboard.
  const filterContext = useFiltersOptional();
  const periods =
    periodsProp && periodsProp.length > 0
      ? periodsProp
      : (filterContext?.periodos ?? []);

  const estruturaKey = rows.map((r) => rowId(r)).join("|");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() =>
    expandPadrao(rows, variante, padraoMaxNivel),
  );
  useEffect(() => {
    setExpandedRows(expandPadrao(rows, variante, padraoMaxNivel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estruturaKey, variante, padraoMaxNivel]);

  const [drilldownExpanded, setDrilldownExpanded] = useState<Set<number>>(new Set());

  // Estado para busca na tabela
  const [busca, setBusca] = useState('');

  // Estado para tipo de AH%
  const [ahTipo, setAhTipo] = useState<'anterior' | 'base'>('anterior');

  // Estado para exibição em milhares
  const [mostrarMilhares, setMostrarMilhares] = useState(emMilhares);

  // Encontrar base para AV
  const basesAV = useMemo(() => {
    const todas = resolverBasesAV(rows, {
      variante: variante === "bp" ? "bp" : "dre",
      avBaseCodigo,
    });
    if (!avSelecionadas || avSelecionadas.length === 0) return todas;
    return avSelecionadas.map((rotulo) => {
      const achada = todas.find((b) => b.rotulo === rotulo);
      return achada ?? { rotulo, titulo: rotulo, row: null };
    });
  }, [rows, variante, avBaseCodigo, avSelecionadas]);

  const corteLados = useMemo(() => {
    if (!lados) return -1;
    return rows.findIndex((r) => /passivo e patrim/i.test(r.descricao));
  }, [lados, rows]);

  const basesAVEsq = useMemo(() => {
    if (corteLados <= 0) return basesAV;
    return resolverBasesAV(rows.slice(0, corteLados), {
      variante: "bp",
      avBaseCodigo: "Total do Ativo",
    });
  }, [corteLados, rows, basesAV]);

  const basesAVDir = useMemo(() => {
    if (corteLados < 0) return basesAV;
    return resolverBasesAV(rows.slice(corteLados), {
      variante: "bp",
      avBaseCodigo: "Total do Passivo",
    });
  }, [corteLados, rows, basesAV]);

  const multiAno = useMemo(
    () => new Set(periods.map((p) => p.slice(0, 4))).size > 1,
    [periods],
  );
  const [agrupador, setAgrupador] = useState<Agrupador | null>(null);
  const agrupadorEfetivo: Agrupador =
    variante === "bp" ? "mes" : (agrupador ?? (multiAno ? "mes" : "selecao"));
  const [mostrarMeses, setMostrarMeses] = useState(true);
  const colunasTodas = useMemo(
    () => montarColunas(periods, agrupadorEfetivo),
    [periods, agrupadorEfetivo],
  );
  const temSubtotais = colunasTodas.some((c) => c.kind === "s");
  const colunas = useMemo(
    () =>
      mostrarMeses || !temSubtotais
        ? colunasTodas
        : colunasTodas.filter((c) => c.kind === "s"),
    [colunasTodas, mostrarMeses, temSubtotais],
  );
  const colunasSub = useMemo(
    () => colunas.filter((c): c is Extract<typeof c, { kind: "s" }> => c.kind === "s"),
    [colunas],
  );
  const mostrarBanda =
    mostrarMeses && agrupadorEfetivo !== "mes" && agrupadorEfetivo !== "selecao";
  const yoYMensal = multiAno && agrupadorEfetivo === "mes" && mostrarMeses;
  const gruposYoY = useMemo(
    () =>
      yoYMensal
        ? gruposMesAnoAAno(
            colunas
              .filter((c): c is Extract<typeof c, { kind: "p" }> => c.kind === "p")
              .map((c) => c.periodo),
          )
        : [],
    [yoYMensal, colunas],
  );

  // Filtrar linhas por busca
  const rowsFiltradas = useMemo(() => {
    if (!busca.trim()) return rows;
    const termo = busca
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return rows.filter((row) => {
      const desc = (row.descricao ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const cod = (row.codigo_conta ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return desc.includes(termo) || cod.includes(termo);
    });
  }, [rows, busca]);

  const getChildren = (index: number): number[] => directChildren(rows, index);

  const isExpanded = (index: number): boolean => expandedRows.has(rowId(rows[index]));

  const isDrilldownExpanded = (index: number): boolean => {
    return drilldownExpanded.has(index);
  };

  const toggleExpand = (index: number) => {
    const id = rowId(rows[index]);
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDrilldown = (index: number) => {
    setDrilldownExpanded(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const idsComFilhos = useMemo(() => {
    const ids: string[] = [];
    rows.forEach((row, i) => {
      if (directChildren(rows, i).length > 0) ids.push(rowId(row));
    });
    return ids;
  }, [rows]);

  const padrao = useMemo(
    () => expandPadrao(rows, variante, padraoMaxNivel),
    [rows, variante, padraoMaxNivel],
  );
  const ehPadrao = sameSet(expandedRows, padrao);
  const tudoExpandido =
    idsComFilhos.length > 0 && idsComFilhos.every((id) => expandedRows.has(id));
  const recolhido = expandedRows.size === 0;
  // Se o padrão coincide com "tudo expandido", só o Padrão fica destacado —
  // senão os dois botões pintam juntos e parecem um só.
  const modoExpand: "padrao" | "tudo" | "recolher" | "livre" = recolhido
    ? "recolher"
    : ehPadrao
      ? "padrao"
      : tudoExpandido
        ? "tudo"
        : "livre";

  const aplicarPadrao = () => setExpandedRows(expandPadrao(rows, variante, padraoMaxNivel));
  const recolherTudo = () => setExpandedRows(new Set());
  const expandirTudo = () => setExpandedRows(new Set(idsComFilhos));
  const abertoMax = nivelAbertoMax(rows, expandedRows);
  const camadaMaisFundo = expandirCamada(rows, expandedRows);
  const podeExpandirCamada = !sameSet(camadaMaisFundo, expandedRows);
  const expandirUmNivel = () => setExpandedRows(expandirCamada(rows, expandedRows));
  const recolherUmNivel = () => setExpandedRows(expandAteNivel(rows, abertoMax - 1));

  // Se não houver períodos
  if (periods.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
        Nenhum período selecionado. Selecione anos e meses no filtro.
      </div>
    );
  }

  // Se não houver linhas
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
        {busca.trim() 
          ? `Nenhuma conta encontrada para o filtro "${busca}".` 
          : 'Nenhum dado encontrado para os filtros selecionados.'}
      </div>
    );
  }

  // Renderizar uma linha
  const renderRow = (row: StatementRow, index: number, bases = basesAV) => {
    const children = getChildren(index);
    const hasChild = children.length > 0;
    const expanded = isExpanded(index);
    const nivel = row.nivel;
    const isSubtotal = row.is_subtotal;
    const codigoDrill = row.codigo_conta;
    const hasDrilldown = !!codigoDrill;
    const drilldownExp = isDrilldownExpanded(index);
    const desc = descricaoExibida(row, colunas, variante);

    return (
      <Fragment key={rowId(row)}>
        <tr
          className={cn(
            "border-b border-border/60 last:border-0 hover:bg-muted/40 transition-colors",
            isSubtotal && "font-semibold",
          )}
        >
          <td
            className="px-3 py-2 sticky left-0 z-10 bg-background text-sm min-w-[240px] max-w-[320px]"
            style={{ paddingLeft: `${12 + nivel * 14}px` }}
          >
            <div className="flex items-center gap-1 min-w-0">
              {hasChild || hasDrilldown ? (
                <button
                  type="button"
                  onClick={() => {
                    if (hasChild) toggleExpand(index);
                    else toggleDrilldown(index);
                  }}
                  className="shrink-0 grid place-items-center h-4 w-4 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={
                    hasChild
                      ? (expanded ? "Recolher" : "Expandir")
                      : (drilldownExp ? "Fechar lançamentos" : "Ver lançamentos")
                  }
                >
                  {(hasChild ? expanded : drilldownExp) ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
              ) : (
                <span className="inline-block w-4 shrink-0" />
              )}

              {hasDrilldown ? (
                <button
                  type="button"
                  onClick={() => toggleDrilldown(index)}
                  className={cn(
                    "text-left min-w-0 truncate hover:text-foreground transition-colors",
                    drilldownExp && "text-foreground",
                  )}
                  title={`Ver lançamentos: ${desc}`}
                >
                  <span className="truncate">{tituloConta(desc, variante)}</span>
                </button>
              ) : (
                <span className="truncate" title={desc}>
                  {tituloConta(desc, variante)}
                </span>
              )}
            </div>
          </td>

          {/* Cada período: valor + AV% + AH%; subtotais conforme Totalizar */}
          {colunas.map((col) => {
            if (col.kind === "s") {
              const bruto = valorSubtotal(row.values, col.periodos, variante);
              const ger = row.valuesGer
                ? valorSubtotal(row.valuesGer, col.periodos, variante)
                : bruto;
              const valorCol = row.valuesGer ? ger : bruto;
              const idxSub = colunasSub.findIndex((c) => c.key === col.key);
              return (
                <Fragment key={col.key}>
                  <td className={cn(
                    "px-3 py-1.5 text-right tabular-nums whitespace-nowrap min-w-[7.25rem] bg-muted/20 font-medium",
                    yoYMensal && "border-l",
                  )}>
                    {formatarMoeda(valorCol, mostrarMilhares)}
                  </td>
                  {showAV && bases.map((base) => {
                    const den = base.row
                      ? valorSubtotal(base.row.values, col.periodos, variante)
                      : 0;
                    const pct = Math.abs(den) < 0.001 ? null : (valorCol / den) * 100;
                    return (
                      <td
                        key={`${col.key}-${base.rotulo}`}
                        className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-xs text-muted-foreground min-w-[3.5rem] bg-muted/20"
                      >
                        {pct !== null && isFinite(pct) ? formatarPercentual(pct) : "—"}
                      </td>
                    );
                  })}
                  {showAH && (
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-xs min-w-[3.5rem] bg-muted/20">
                      {(() => {
                        const ref =
                          ahTipo === "base" ? colunasSub[0] : colunasSub[idxSub - 1];
                        if (!ref || ref.key === col.key) return "—";
                        const anterior = row.valuesGer
                          ? valorSubtotal(row.valuesGer, ref.periodos, variante)
                          : valorSubtotal(row.values, ref.periodos, variante);
                        if (Math.abs(anterior) < 0.001) return "—";
                        const pct = ((valorCol - anterior) / Math.abs(anterior)) * 100;
                        if (!isFinite(pct)) return "—";
                        return (
                          <span className={cn(
                            pct > 0 && "text-success",
                            pct < 0 && "text-destructive",
                          )}>
                            {formatarPercentual(pct)}
                          </span>
                        );
                      })()}
                    </td>
                  )}
                </Fragment>
              );
            }

            const periodo = col.periodo;
            const valor = row.values[periodo] ?? 0;
            const valorGer = row.valuesGer?.[periodo] ?? valor;
            const isGerencial = row.valuesGer && row.valuesGer[periodo] !== undefined;

            return (
              <Fragment key={periodo}>
                <td className={cn(
                  "px-3 py-1.5 text-right tabular-nums whitespace-nowrap min-w-[7.25rem]",
                  yoYMensal && "border-l",
                )}>
                  {isGerencial && Math.abs(valorGer - valor) > 0.01 ? (
                    <div className="flex flex-col items-end">
                      <span className="text-muted-foreground line-through text-[10px]">
                        {formatarMoeda(valor, mostrarMilhares)}
                      </span>
                      <span className="font-semibold">
                        {formatarMoeda(valorGer, mostrarMilhares)}
                      </span>
                    </div>
                  ) : (
                    <span>{formatarMoeda(valor, mostrarMilhares)}</span>
                  )}
                </td>
                {showAV && bases.map((base) => {
                  const pct = percentualAV(row, base.row, periodo);
                  return (
                    <td
                      key={`${periodo}-${base.rotulo}`}
                      className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-xs text-muted-foreground min-w-[3.5rem]"
                    >
                      {pct !== null && isFinite(pct) ? formatarPercentual(pct) : '—'}
                    </td>
                  );
                })}
                {showAH && (
                  <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-xs min-w-[3.5rem]">
                    {(() => {
                      const pct = calcularAH(
                        row,
                        periodo,
                        periods,
                        basePeriod || periods[0] || '',
                        ahTipo,
                      );
                      if (pct === null) return '—';
                      return (
                        <span className={cn(
                          pct > 0 && 'text-success',
                          pct < 0 && 'text-destructive',
                        )}>
                          {formatarPercentual(pct)}
                        </span>
                      );
                    })()}
                  </td>
                )}
              </Fragment>
            );
          })}
        </tr>

        {/* Drill-down */}
        {drilldownExp && hasDrilldown && (
          <InlineDrilldown
            codigoConta={codigoDrill!}
            descricao={tituloConta(desc, variante)}
            periods={periods}
            colSpanLeft={1}
            colSpanRight={0}
            extraMiddleCols={colunas.length * ((showAV ? bases.length : 0) + (showAH ? 1 : 0))}
            variante={variante === "bp" ? "bp" : variante === "dfc" ? "dfc" : "dre"}
            emMilhares={mostrarMilhares}
          />
        )}
      </Fragment>
    );
  };

  const renderHeader = (bases = basesAV) => {
    const extrasPorPeriodo = (showAV ? bases.length : 0) + (showAH ? 1 : 0);
    const colsPorPeriodo = 1 + extrasPorPeriodo;
    const comSub = extrasPorPeriodo > 0;
    const temBandaSuperior = mostrarBanda || yoYMensal;
    const rowSpanDesc = (temBandaSuperior ? 1 : 0) + 1 + (comSub ? 1 : 0);
    const thDesc = (
      <th
        rowSpan={rowSpanDesc}
        className="text-left font-medium text-xs uppercase tracking-wider text-muted-foreground px-3 py-2.5 sticky left-0 z-10 bg-background min-w-[240px] max-w-[320px]"
      >
        Descrição
      </th>
    );
    const bandas: { banda: string; n: number }[] = [];
    if (mostrarBanda) {
      let n = 0;
      for (const c of colunas) {
        n += 1;
        if (c.kind === "s") {
          bandas.push({ banda: c.banda, n });
          n = 0;
        }
      }
      if (n > 0) bandas.push({ banda: "", n });
    }
    return (
      <thead>
        {temBandaSuperior && (
          <tr className="border-b bg-muted/40">
            {thDesc}
            {yoYMensal
              ? gruposYoY.map((g) => (
                  <th
                    key={`mes-${g.mes}`}
                    colSpan={g.periodos.length * colsPorPeriodo}
                    className="text-center font-medium text-xs text-muted-foreground px-3 py-1.5 whitespace-nowrap border-l"
                  >
                    {g.rotulo}
                  </th>
                ))
              : bandas.map((g, i) => (
                  <th
                    key={`banda-${i}`}
                    colSpan={g.n * colsPorPeriodo}
                    className="text-center font-medium text-xs text-muted-foreground px-3 py-1.5 whitespace-nowrap"
                  >
                    {g.banda}
                  </th>
                ))}
          </tr>
        )}
        <tr className="border-b bg-muted/30">
          {!temBandaSuperior && thDesc}
          {colunas.map((col) => (
            <th
              key={col.key}
              colSpan={colsPorPeriodo}
              className={cn(
                "text-right font-medium text-xs text-muted-foreground px-3 py-2.5 whitespace-nowrap min-w-[7.25rem]",
                col.kind === "s" && "bg-muted/40",
                yoYMensal && "border-l",
              )}
            >
              {col.kind === "s"
                ? col.label
                : yoYMensal
                  ? anoCurto(col.periodo)
                  : formatarPeriodo(col.periodo)}
            </th>
          ))}
        </tr>
        {comSub && (
          <tr className="border-b bg-muted/20">
            {colunas.map((col, colIdx) => (
              <Fragment key={`sub-${col.key}`}>
                <th
                  className={cn(
                    "text-right font-medium text-[10px] text-muted-foreground px-3 py-1 whitespace-nowrap",
                    col.kind === "s" && "bg-muted/30",
                  )}
                >
                  R$
                </th>
                {showAV && bases.map((base) => (
                  <th
                    key={`avh-${col.key}-${base.rotulo}`}
                    className={cn(
                      "text-right font-medium text-[10px] text-muted-foreground px-1 py-1 whitespace-nowrap",
                      col.kind === "s" && "bg-muted/30",
                    )}
                    title={`Análise vertical sobre ${base.titulo}`}
                  >
                    {base.rotulo}
                  </th>
                ))}
                {showAH && (
                  <th
                    className={cn(
                      "text-right font-medium text-[10px] text-muted-foreground px-1 py-1 whitespace-nowrap",
                      col.kind === "s" && "bg-muted/30",
                    )}
                  >
                    {colIdx === 0 ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px]">
                            AH%
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setAhTipo("anterior")}>
                            {multiAno ? "Mesmo mês do ano anterior" : "Período anterior"}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setAhTipo("base")}>
                            Base: {basePeriod ? formatarPeriodo(basePeriod) : "Primeiro"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      "AH%"
                    )}
                  </th>
                )}
              </Fragment>
            ))}
          </tr>
        )}
      </thead>
    );
  };

  const renderPainel = (
    indices: number[],
    bases: typeof basesAV,
    titulo?: string,
    encostar = false,
  ) => {
    const extras = (showAV ? bases.length : 0) + (showAH ? 1 : 0);
    const visiveis = busca.trim()
      ? indices.filter((i) => rowsFiltradas.includes(rows[i]))
      : indices.filter((i) => isRowVisible(rows, i, expandedRows));
    return (
      <div className={cn("min-w-0 bg-transparent", !encostar && "overflow-x-auto")}>
        {titulo && (
          <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground border-b bg-muted/10">
            {titulo}
          </div>
        )}
        <table className="w-max text-sm border-collapse">
          {renderHeader(bases)}
          <tbody>
            {visiveis.length === 0 ? (
              <tr>
                <td
                  colSpan={1 + colunas.length * (1 + extras)}
                  className="px-3 py-8 text-sm text-muted-foreground"
                >
                  {busca.trim()
                    ? `Nenhuma conta encontrada para o filtro "${busca}".`
                    : "Nenhum dado encontrado para os filtros selecionados."}
                </td>
              </tr>
            ) : (
              visiveis.map((i) => renderRow(rows[i], i, bases))
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Barra de ferramentas */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/20 text-xs">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="h-7 pl-7 text-xs w-48"
              placeholder="Filtrar por conta..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <span className="text-muted-foreground">
            {rowsFiltradas.length} de {rows.length} linhas
          </span>
          {idsComFilhos.length > 0 && !busca.trim() && (
            <div className="flex items-center gap-1.5">
              <div className="flex items-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0 rounded-md"
                  onClick={recolherUmNivel}
                  disabled={abertoMax < 0}
                  title="Recolher um nível em todas as contas"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0 rounded-md ml-1"
                  onClick={expandirUmNivel}
                  disabled={!podeExpandirCamada}
                  title="Expandir um nível em todas as contas"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Button
                variant={modoExpand === "padrao" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs rounded-md"
                onClick={aplicarPadrao}
                title="Abre os grupos da demonstração, sem o detalhe analítico completo"
              >
                Padrão
              </Button>
              <Button
                variant={modoExpand === "tudo" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs rounded-md"
                onClick={expandirTudo}
              >
                Expandir tudo
              </Button>
              <Button
                variant={modoExpand === "recolher" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs rounded-md"
                onClick={recolherTudo}
              >
                Recolher
              </Button>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {variante !== "bp" && temSubtotais && (
            <Button
              variant={mostrarMeses ? "outline" : "default"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setMostrarMeses((v) => !v)}
              title={mostrarMeses ? "Oculta os meses e deixa só os totais" : "Mostra de novo as colunas mensais"}
            >
              {mostrarMeses ? "Só totais" : "Ver meses"}
            </Button>
          )}
          {variante !== "bp" && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground whitespace-nowrap">Totalizar:</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-xs font-medium">
                    {AGRUPADOR_LABEL[agrupadorEfetivo]}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {AGRUPADORES.map((ag) => (
                    <DropdownMenuItem
                      key={ag}
                      onClick={() => {
                        setAgrupador(ag);
                        if (ag === "mes") setMostrarMeses(true);
                      }}
                    >
                      {AGRUPADOR_LABEL[ag]}
                      {agrupadorEfetivo === ag ? " ✓" : ""}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setMostrarMilhares(!mostrarMilhares)}
          >
            {mostrarMilhares ? "R$" : "R$ mil"}
          </Button>
        </div>
      </div>

      {/* Tabela */}
      {corteLados > 0 ? (
        <div className="overflow-x-auto">
          <div className="flex w-max items-stretch">
            {renderPainel(
              Array.from({ length: corteLados }, (_, i) => i),
              basesAVEsq,
              "Ativo",
              true,
            )}
            <div className="w-px shrink-0 bg-border self-stretch" />
            {renderPainel(
              Array.from({ length: rows.length - corteLados }, (_, i) => i + corteLados),
              basesAVDir,
              "Passivo + PL",
              true,
            )}
          </div>
        </div>
      ) : (
        renderPainel(
          rows.map((_, i) => i),
          basesAV,
        )
      )}
    </div>
  );
}

export default StatementTable;