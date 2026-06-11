import { MES_ABBR } from "@/lib/format";

export type Granularidade = "ano" | "mes";

export function resolverPeriodos(
  granularidade: Granularidade,
  valor: string,
  availablePeriods: string[],
): string[] {
  if (!valor) return [];
  if (granularidade === "mes") return [valor];
  const ano = parseInt(valor, 10);
  if (isNaN(ano)) return [];
  return availablePeriods
    .filter((p) => new Date(p).getUTCFullYear() === ano)
    .sort();
}

export function anosDisponiveis(availablePeriods: string[]): number[] {
  const set = new Set<number>();
  availablePeriods.forEach((p) => set.add(new Date(p).getUTCFullYear()));
  return Array.from(set).sort();
}

export function periodoMesLabel(p: string): string {
  const d = new Date(p);
  return `${MES_ABBR[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
}

export interface MonthlyRow {
  linha_ordem: number;
  descricao: string;
  codigo_conta: string | null;
  nivel: number;
  is_subtotal: boolean;
  periodo: string;
  valor: number;
}

/**
 * Agrega valores dos períodos:
 * - BP_*: usa o saldo do último mês
 * - DRE / DFC / outros: soma todos os meses (fluxo acumulado)
 * Retorna mapa por linha_ordem.
 */
export function agregarPorPeriodos(
  rows: MonthlyRow[],
  tipo: string,
  periodos: string[],
): { byLinha: Map<number, MonthlyRow & { valor: number }>; ordered: MonthlyRow[] } {
  const isBP = tipo.startsWith("BP");
  const periodSet = new Set(periodos);
  const lastPeriodo = periodos[periodos.length - 1];

  const byLinha = new Map<number, MonthlyRow & { valor: number }>();
  for (const r of rows) {
    if (!periodSet.has(r.periodo)) continue;
    const existing = byLinha.get(r.linha_ordem);
    if (!existing) {
      byLinha.set(r.linha_ordem, { ...r, valor: 0 });
    }
  }

  for (const r of rows) {
    if (!periodSet.has(r.periodo)) continue;
    const entry = byLinha.get(r.linha_ordem)!;
    if (isBP) {
      if (r.periodo === lastPeriodo) entry.valor = Number(r.valor) || 0;
    } else {
      entry.valor += Number(r.valor) || 0;
    }
  }

  const ordered = Array.from(byLinha.values()).sort(
    (a, b) => a.linha_ordem - b.linha_ordem,
  );
  return { byLinha, ordered };
}

const CUSTO_RE = /custo|despesa|deduç|imposto|tribut|cmv|cpv|provis|perda|amortizaç|depreciaç/i;

export function isCustoDespesa(descricao: string | null | undefined): boolean {
  if (!descricao) return false;
  return CUSTO_RE.test(descricao);
}
