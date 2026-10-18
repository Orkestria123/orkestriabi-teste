import type { StatementRow } from '@/components/statement-table';
import { valorSubtotal, type ColunaAgrupada } from '@/lib/dre-acumulo';
import { periodoLabel, variacaoPct } from '@/lib/format';
import type { BaseAV } from '@/lib/av-base';

export interface ViewCell { value: number | null; format: 'money' | 'percent'; difference?: boolean }
export interface StatementView {
  headers: string[];
  rows: { source: StatementRow; cells: ViewCell[]; visible: boolean; standard: boolean; synthetic?: boolean }[];
  thousands: boolean;
}

/** Keeps structural groups and result lines, without individual analytical accounts. */
export function statementPDFModes(model: StatementView) {
  const minimumLevel = Math.min(...model.rows.map(row => row.source.nivel));
  return [
    { label: 'Consulta atual', accept: (row: StatementView['rows'][number]) => row.visible },
    { label: 'Padrão', accept: (row: StatementView['rows'][number]) => row.standard },
    { label: 'Sintéticas', accept: (row: StatementView['rows'][number]) => {
      if (row.synthetic !== undefined) return row.synthetic;
      const index = model.rows.indexOf(row);
      const next = model.rows[index + 1];
      return row.source.is_subtotal || row.source.codigo_conta == null
        || (next !== undefined && next.source.nivel > row.source.nivel);
    } },
    { label: 'Expandir tudo', accept: () => true },
    { label: 'Recolher', accept: (row: StatementView['rows'][number]) => row.source.nivel <= minimumLevel },
  ];
}

export function comparisonValues(row: StatementRow, col: ColunaAgrupada, variant: 'dre' | 'bp' | 'dfc') {
  const read = (values: Record<string, number>) => col.kind === 's'
    ? valorSubtotal(values, col.periodos, variant) : values[col.periodo] ?? 0;
  const accounting = read(row.values);
  const management = read({ ...row.values, ...row.valuesGer });
  return { accounting, management, difference: management - accounting };
}

export function buildStatementView(options: {
  rows: StatementRow[]; columns: ColunaAgrupada[]; variant: 'dre' | 'bp' | 'dfc';
  bases: (row: StatementRow) => BaseAV<StatementRow>[];
  showAV: boolean; showAH: boolean; ahType: 'anterior' | 'base'; basePeriod?: string;
  periods: string[]; visible: (row: StatementRow) => boolean;
  standard: (row: StatementRow) => boolean; thousands: boolean;
}): StatementView {
  const { rows, columns, variant, showAV, showAH, periods } = options;
  const levels: number[] = [];
  const syntheticRows = new Set<StatementRow>();
  for (const row of rows) {
    while (levels.length && levels[levels.length - 1] >= row.nivel) levels.pop();
    if (levels.length <= (variant === 'bp' ? 2 : 1)) syntheticRows.add(row);
    levels.push(row.nivel);
  }
  const comparison = rows.some(r => r.valuesGer !== undefined);
  const bases = rows[0] ? options.bases(rows[0]) : [];
  const headers = columns.flatMap(col => {
    const label = col.kind === 's' ? col.label : periodoLabel(col.periodo);
    return [
      ...(comparison ? ['Contábil', 'Gerencial', 'Diferença'].map(s => `${label} · ${s}`) : [label]),
      ...(showAV ? bases.map(b => `${label} · ${b.rotulo}`) : []),
      ...(showAH ? [`${label} · AH%`] : []),
    ];
  });
  return { headers, thousands: options.thousands, rows: rows.map(source => ({
    source, visible: options.visible(source), standard: options.standard(source),
    synthetic: syntheticRows.has(source),
    cells: columns.flatMap(col => {
      const values = comparisonValues(source, col, variant);
      const current = comparison ? values.management : values.accounting;
      const cells: ViewCell[] = comparison
        ? [{ value: values.accounting, format: 'money' }, { value: values.management, format: 'money' },
          { value: values.difference, format: 'money', difference: true }]
        : [{ value: current, format: 'money' }];
      if (showAV) for (const base of options.bases(source)) {
        const den = base.row ? comparisonValues(base.row, col, variant)[comparison ? 'management' : 'accounting'] : 0;
        cells.push({ value: Math.abs(den) < 0.001 ? null : current / den * 100, format: 'percent' });
      }
      if (showAH) {
        let reference: ColunaAgrupada | undefined;
        if (col.kind === 's') {
          const totals = columns.filter(c => c.kind === 's');
          reference = options.ahType === 'base' ? totals[0] : totals[totals.indexOf(col) - 1];
        } else {
          const multiYear = new Set(periods.map(p => p.slice(0, 4))).size > 1;
          const previous = options.ahType === 'base' ? options.basePeriod ?? periods[0]
            : multiYear ? Object.keys(source.values).find(p => p.slice(0, 7) === `${Number(col.periodo.slice(0, 4)) - 1}${col.periodo.slice(4, 7)}`)
            : periods[periods.indexOf(col.periodo) - 1];
          if (previous) reference = { kind: 'p', key: previous, periodo: previous };
        }
        const prior = reference ? comparisonValues(source, reference, variant)[comparison ? 'management' : 'accounting'] : 0;
        cells.push({ value: !reference || reference.key === col.key || Math.abs(prior) < 0.001 ? null : variacaoPct(current, prior), format: 'percent' });
      }
      return cells;
    }),
  })) };
}