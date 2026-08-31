// src/components/statement-table.tsx
import { useState, useMemo, useEffect, Fragment } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, ChevronsDown, ChevronsUp, Search } from 'lucide-react';
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

export interface StatementRow {
  linha_ordem: number;
  descricao: string;
  codigo_conta?: string | null;
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
  return `${valor.toFixed(2).replace('.', ',')}%`;
}

function formatarPeriodo(periodo: string): string {
  if (!periodo) return '';
  const parts = periodo.split('-');
  if (parts.length < 2) return periodo;
  const [ano, mes] = parts;
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${meses[parseInt(mes) - 1]}/${ano.slice(2)}`;
}

function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function tituloConta(descricao: string): string {
  if (!descricao) return '';
  // Remove prefixos comuns
  let titulo = descricao
    .replace(/^\(=\)\s*/, '')
    .replace(/^\(-\)\s*/, '')
    .replace(/^\(\+\)\s*/, '')
    .replace(/^=\s*/, '');
  
  // Capitaliza cada palavra
  return titulo.split(' ').map(capitalize).join(' ');
}

function calcularAH(
  row: StatementRow,
  periodo: string,
  periods: string[],
  basePeriod: string,
  tipo: 'anterior' | 'base',
): number | null {
  const valorAtual = row.values[periodo] ?? 0;
  let valorBase: number;
  if (tipo === 'anterior') {
    const idx = periods.indexOf(periodo);
    if (idx <= 0) return null;
    valorBase = row.values[periods[idx - 1]] ?? 0;
  } else {
    if (periodo === basePeriod) return null;
    valorBase = row.values[basePeriod] ?? 0;
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

// ===== Totalizadores configuráveis =====
export type Agrupador = "mes" | "trimestre" | "semestre" | "ano" | "selecao";

const AGRUPADOR_LABEL: Record<Agrupador, string> = {
  mes: "Mês",
  trimestre: "Trimestre",
  semestre: "Semestre",
  ano: "Ano",
  selecao: "Seleção inteira",
};

const ORD = ["1º", "2º", "3º", "4º"];

type Coluna =
  | { kind: "p"; key: string; periodo: string }
  | { kind: "s"; key: string; label: string; banda: string; periodos: string[] };

function anoDe(p: string) {
  return p.slice(0, 4);
}
function mesDe(p: string) {
  return parseInt(p.slice(5, 7), 10);
}

function grupoDe(p: string, ag: Agrupador): string {
  if (ag === "selecao") return "all";
  const ano = anoDe(p);
  if (ag === "ano") return ano;
  const m = mesDe(p);
  if (ag === "trimestre") return `${ano}-T${Math.ceil(m / 3)}`;
  if (ag === "semestre") return `${ano}-S${Math.ceil(m / 6)}`;
  return `${ano}-${p}`;
}

function rotulosGrupo(
  p: string,
  ag: Agrupador,
  multiAno: boolean,
): { label: string; banda: string } {
  const ano = anoDe(p);
  const m = mesDe(p);
  if (ag === "selecao") return { label: "Total", banda: "Seleção" };
  if (ag === "ano") return { label: `Total ${ano}`, banda: ano };
  if (ag === "trimestre") {
    const i = ORD[Math.ceil(m / 3) - 1];
    return {
      label: multiAno ? `${i} Tri ${ano}` : `${i} Tri`,
      banda: `${i} Trimestre ${ano}`,
    };
  }
  const i = ORD[Math.ceil(m / 6) - 1];
  return {
    label: multiAno ? `${i} Sem ${ano}` : `${i} Sem`,
    banda: `${i} Semestre ${ano}`,
  };
}

function montarColunas(periods: string[], ag: Agrupador): Coluna[] {
  const ordenados = [...periods].sort();
  const cols: Coluna[] = [];
  if (ag === "mes") {
    return ordenados.map((p) => ({ kind: "p" as const, key: p, periodo: p }));
  }
  const multiAno = new Set(ordenados.map(anoDe)).size > 1;
  let atual: string | null = null;
  let bucket: string[] = [];
  const fechar = () => {
    if (!atual || bucket.length === 0) return;
    const { label, banda } = rotulosGrupo(bucket[0], ag, multiAno);
    cols.push({ kind: "s", key: `sub:${atual}`, label, banda, periodos: [...bucket] });
    bucket = [];
  };
  for (const p of ordenados) {
    const g = grupoDe(p, ag);
    if (atual !== null && g !== atual) fechar();
    atual = g;
    bucket.push(p);
    cols.push({ kind: "p", key: p, periodo: p });
  }
  fechar();
  return cols;
}

/** Subtotal: soma nos fluxos (DRE/DFC), saldo do último mês no Balanço. */
function valorSubtotal(
  valores: Record<string, number> | undefined,
  periodos: string[],
  variante: "dre" | "bp" | "dfc",
): number {
  if (!valores) return 0;
  if (variante === "bp") {
    const ultimo = periodos[periodos.length - 1];
    return Number(valores[ultimo] ?? 0) || 0;
  }
  return periodos.reduce((acc, p) => acc + (Number(valores[p] ?? 0) || 0), 0);
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
    const todas = resolverBasesAV(rows, { variante, avBaseCodigo });
    if (!avSelecionadas || avSelecionadas.length === 0) return todas;
    return avSelecionadas.map((rotulo) => {
      const achada = todas.find((b) => b.rotulo === rotulo);
      return achada ?? { rotulo, titulo: rotulo, row: null };
    });
  }, [rows, variante, avBaseCodigo, avSelecionadas]);

  const extrasPorPeriodo = (showAV ? basesAV.length : 0) + (showAH ? 1 : 0);

  // Totalizador configurável: padrão "Ano" com vários anos, "Seleção inteira" com um só.
  const multiAno = useMemo(
    () => new Set(periods.map((p) => p.slice(0, 4))).size > 1,
    [periods],
  );
  const [agrupador, setAgrupador] = useState<Agrupador | null>(null);
  // No Balanço não há totalizador: cada mês é um saldo, somar/subtotalizar não faz sentido.
  const agrupadorEfetivo: Agrupador =
    variante === "bp" ? "mes" : (agrupador ?? (multiAno ? "ano" : "selecao"));

  // Mostrar/esconder as colunas de mês, deixando só os totalizadores.
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
    () => colunas.filter((c): c is Extract<Coluna, { kind: "s" }> => c.kind === "s"),
    [colunas],
  );
  const colsSubtotal = colunasSub.length;
  const mostrarBanda =
    mostrarMeses && agrupadorEfetivo !== "mes" && agrupadorEfetivo !== "selecao";


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
  const renderRow = (row: StatementRow, index: number) => {
    const children = getChildren(index);
    const hasChild = children.length > 0;
    const expanded = isExpanded(index);
    const nivel = row.nivel;
    const isSubtotal = row.is_subtotal;
    const codigoDrill = row.codigo_conta;
    const hasDrilldown = !!codigoDrill;
    const drilldownExp = isDrilldownExpanded(index);

    return (
      <Fragment key={rowId(row)}>
        <tr
          className={cn(
            "border-b border-border/60 last:border-0 hover:bg-muted/40 transition-colors",
            isSubtotal && "font-semibold",
          )}
        >
          <td
            className="px-2 py-1.5 sticky left-0 z-10 bg-background text-sm min-w-[220px] max-w-[280px]"
            style={{ paddingLeft: `${8 + nivel * 12}px` }}
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
                  title={`Ver lançamentos: ${row.descricao}`}
                >
                  <span className="truncate">{tituloConta(row.descricao)}</span>
                </button>
              ) : (
                <span className="truncate" title={row.descricao}>
                  {tituloConta(row.descricao)}
                </span>
              )}
            </div>
          </td>

          {/* Cada período: valor + AV% (RB/RL) + AH% daquela coluna; subtotais por agrupamento */}
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
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-xs min-w-[90px] bg-muted/60 font-semibold border-l border-border">
                    {formatarMoeda(valorCol, mostrarMilhares)}
                  </td>
                  {showAV && basesAV.map((base) => {
                    const den = base.row
                      ? valorSubtotal(base.row.values, col.periodos, variante)
                      : 0;
                    const pct = Math.abs(den) < 0.001 ? null : (valorCol / den) * 100;
                    return (
                      <td
                        key={`${col.key}-${base.rotulo}`}
                        className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-[11px] text-muted-foreground min-w-[62px] bg-muted/60"
                      >
                        {pct !== null && isFinite(pct) ? formatarPercentual(pct) : "—"}
                      </td>
                    );
                  })}
                  {showAH && (
                    <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-[11px] min-w-[62px] bg-muted/60">
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
                          <span
                            className={cn(
                              pct > 0 && "text-success",
                              pct < 0 && "text-destructive",
                            )}
                          >
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
                <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-xs min-w-[90px]">
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
                {showAV && basesAV.map((base) => {
                  const pct = percentualAV(row, base.row, periodo);
                  return (
                    <td
                      key={`${periodo}-${base.rotulo}`}
                      className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-[11px] text-muted-foreground min-w-[62px]"
                    >
                      {pct !== null && isFinite(pct) ? formatarPercentual(pct) : '—'}
                    </td>
                  );
                })}
                {showAH && (
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-[11px] min-w-[62px]">
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
            descricao={tituloConta(row.descricao)}
            periods={periods}
            colSpanLeft={1}
            colSpanRight={0}
            extraMiddleCols={Math.max(0, colunas.length * (1 + extrasPorPeriodo) - periods.length)}
            variante={variante === "bp" ? "bp" : variante === "dfc" ? "dfc" : "dre"}
            emMilhares={mostrarMilhares}
          />
        )}
      </Fragment>
    );
  };

  // Renderizar cabeçalho
  const renderHeader = () => {
    const colsPorPeriodo = 1 + extrasPorPeriodo;
    const comSub = extrasPorPeriodo > 0;
    const rowSpanDesc = 1 + (mostrarBanda ? 1 : 0) + (comSub ? 1 : 0);

    // Faixas de agrupamento (ex.: "1º Trimestre 2025" sobre Jan/Fev/Mar/Total)
    const bandas: { key: string; label: string; cols: number }[] = [];
    if (mostrarBanda) {
      let atual: { key: string; label: string; cols: number } | null = null;
      colunas.forEach((c, i) => {
        if (!atual) atual = { key: `banda-${i}`, label: "", cols: 0 };
        atual.cols += colsPorPeriodo;
        if (c.kind === "s") {
          atual.label = c.banda;
          bandas.push(atual);
          atual = null;
        }
      });
      if (atual) bandas.push(atual);
    }

    const thDescricao = (
      <th
        rowSpan={rowSpanDesc}
        className="text-left font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-2 sticky left-0 z-10 bg-background min-w-[220px] max-w-[280px]"
      >
        Descrição
      </th>
    );

    return (
      <thead>
        {mostrarBanda && (
          <tr className="border-b bg-muted/40">
            {thDescricao}
            {bandas.map((b) => (
              <th
                key={b.key}
                colSpan={b.cols}
                className="text-center font-semibold text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5 whitespace-nowrap border-l border-border"
              >
                {b.label}
              </th>
            ))}
          </tr>
        )}
        <tr className="border-b bg-muted/30">
          {!mostrarBanda && thDescricao}
          {colunas.map((col) => (
            <th
              key={`h-${col.key}`}
              colSpan={colsPorPeriodo}
              className={cn(
                "text-right font-medium text-[10px] text-muted-foreground px-2 py-2 whitespace-nowrap min-w-[90px]",
                col.kind === "s" && "bg-muted/60 font-semibold text-foreground border-l border-border",
              )}
            >
              {col.kind === "s" ? col.label : formatarPeriodo(col.periodo)}
            </th>
          ))}
        </tr>
        {comSub && (
          <tr className="border-b bg-muted/20">
            {colunas.map((col) => {
              if (col.kind === "s") {
                return (
                  <Fragment key={`sub-${col.key}`}>
                    <th className="text-right font-medium text-[9px] text-muted-foreground px-2 py-1 whitespace-nowrap bg-muted/60 border-l border-border">
                      R$
                    </th>
                    {showAV && basesAV.map((base) => (
                      <th
                        key={`avh-${col.key}-${base.rotulo}`}
                        className="text-right font-medium text-[9px] text-muted-foreground px-1 py-1 whitespace-nowrap bg-muted/60"
                        title={`Análise vertical sobre ${base.titulo}`}
                      >
                        {base.rotulo}
                      </th>
                    ))}
                    {showAH && (
                      <th className="text-right font-medium text-[9px] text-muted-foreground px-1 py-1 whitespace-nowrap bg-muted/60">
                        AH%
                      </th>
                    )}
                  </Fragment>
                );
              }

              const periodo = col.periodo;
              return (
                <Fragment key={`sub-${periodo}`}>
                  <th className="text-right font-medium text-[9px] text-muted-foreground px-2 py-1 whitespace-nowrap">
                    R$
                  </th>
                  {showAV && basesAV.map((base) => (
                    <th
                      key={`avh-${periodo}-${base.rotulo}`}
                      className="text-right font-medium text-[9px] text-muted-foreground px-1 py-1 whitespace-nowrap"
                      title={`Análise vertical sobre ${base.titulo}`}
                    >
                      {base.rotulo}
                    </th>
                  ))}
                  {showAH && (
                    <th className="text-right font-medium text-[9px] text-muted-foreground px-1 py-1 whitespace-nowrap">
                      {periodo === periods[0] ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-5 px-1 text-[9px]">
                              AH%
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setAhTipo('anterior')}>
                              Período anterior
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setAhTipo('base')}>
                              Base: {basePeriod ? formatarPeriodo(basePeriod) : 'Primeiro'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        "AH%"
                      )}
                    </th>
                  )}
                </Fragment>
              );
            })}
          </tr>
        )}
      </thead>
    );
  };

  return (
    <div className="rounded-lg border overflow-hidden max-w-full">
      {/* Barra de ferramentas */}
      <div className="flex flex-col gap-2 px-3 py-2 border-b bg-muted/20 text-xs">
        {/* Linha 1: busca + contador */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="h-7 pl-7 text-xs w-full"
              placeholder="Filtrar por conta..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <span className="text-muted-foreground whitespace-nowrap shrink-0">
            {rowsFiltradas.length} de {rows.length} linhas
          </span>
        </div>

        {/* Linha 2: ações */}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {idsComFilhos.length > 0 && !busca.trim() && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0 rounded-md shrink-0"
                onClick={recolherUmNivel}
                disabled={abertoMax < 0}
                title="Recolher um nível em todas as contas"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0 rounded-md shrink-0"
                onClick={expandirUmNivel}
                disabled={!podeExpandirCamada}
                title="Expandir um nível em todas as contas"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={modoExpand === "padrao" ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs rounded-md shrink-0"
                onClick={aplicarPadrao}
                title="Abre os grupos da demonstração, sem o detalhe analítico completo"
              >
                Padrão
              </Button>
              <Button
                variant={modoExpand === "tudo" ? "default" : "outline"}
                size="sm"
                className="h-7 w-7 p-0 rounded-md shrink-0"
                onClick={expandirTudo}
                title="Expandir tudo"
              >
                <ChevronsDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={modoExpand === "recolher" ? "default" : "outline"}
                size="sm"
                className="h-7 w-7 p-0 rounded-md shrink-0"
                onClick={recolherTudo}
                title="Recolher tudo"
              >
                <ChevronsUp className="h-3.5 w-3.5" />
              </Button>
            </>
          )}

          <div className="flex items-center gap-1 ml-auto shrink-0">
            {variante !== "bp" && (
              <>
                {temSubtotais && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs rounded-md"
                    onClick={() => setMostrarMeses((v) => !v)}
                    title={
                      mostrarMeses
                        ? "Esconder os meses e deixar só os totalizadores"
                        : "Mostrar novamente as colunas de cada mês"
                    }
                  >
                    {mostrarMeses ? "Só totais" : "Ver meses"}
                  </Button>
                )}
                <span className="text-muted-foreground whitespace-nowrap">Totalizar:</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs rounded-md">
                      {AGRUPADOR_LABEL[agrupadorEfetivo]}
                      <ChevronDown className="ml-1 h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(["mes", "trimestre", "semestre", "ano", "selecao"] as Agrupador[]).map((a) => (
                      <DropdownMenuItem key={a} onClick={() => setAgrupador(a)}>
                        {AGRUPADOR_LABEL[a]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setMostrarMilhares(!mostrarMilhares)}
            >
              {mostrarMilhares ? 'R$' : 'R$ mil'}
            </Button>
          </div>
        </div>
      </div>


      {/* Tabela */}
      <div className="overflow-x-auto bg-transparent">
        <table className="w-full text-xs border-collapse">
          {renderHeader()}
          <tbody>
            {busca.trim()
              ? rowsFiltradas.map((row) => {
                  const index = rows.indexOf(row);
                  return index >= 0 ? renderRow(row, index) : null;
                })
              : rows.map((row, index) =>
                  isRowVisible(rows, index, expandedRows)
                    ? renderRow(row, index)
                    : null,
                )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default StatementTable;