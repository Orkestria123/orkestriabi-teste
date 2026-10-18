import { describe, expect, it } from 'vitest';
import { buildStatementView, comparisonValues } from './statement-view';
import { montarColunas } from './dre-acumulo';
const periods = ['2026-01-01', '2026-02-01'];
const row = { linha_ordem: 1, descricao: 'Lucro Bruto', codigo_conta: null, nivel: 0, is_subtotal: true,
  values: { [periods[0]]: 100, [periods[1]]: 200 }, valuesGer: { [periods[0]]: 130, [periods[1]]: 180 } };
describe('Comparativo e exportação da consulta', () => {
  it('mostra contábil, gerencial e diferença gerencial menos contábil', () => {
    expect(comparisonValues(row, { kind: 'p', key: periods[0], periodo: periods[0] }, 'dre'))
      .toEqual({ accounting: 100, management: 130, difference: 30 });
  });
  it('soma os meses da DRE também no comparativo', () => {
    expect(comparisonValues(row, { kind: 's', key: 'total', label: 'Total', banda: '', periodos: periods }, 'dre'))
      .toEqual({ accounting: 300, management: 310, difference: 10 });
  });
  it('usa o último saldo no balanço', () => {
    expect(comparisonValues(row, { kind: 's', key: 'total', label: 'Total', banda: '', periodos: periods }, 'bp'))
      .toEqual({ accounting: 200, management: 180, difference: -20 });
  });
  it('exporta apenas colunas consultadas, preservando as linhas recolhidas', () => {
    const view = buildStatementView({ rows: [row], columns: montarColunas(periods, 'selecao').filter(c => c.kind === 's'),
      variant: 'dre', bases: () => [], showAV: false, showAH: false, ahType: 'anterior', periods,
      visible: () => false, standard: () => true, thousands: false });
    expect(view.headers).toEqual(['Total · Contábil', 'Total · Gerencial', 'Total · Diferença']);
    expect(view.rows[0].cells.map(c => c.value)).toEqual([300, 310, 10]);
    expect(view.rows[0].visible).toBe(false);
  });
  it('a visão gerencial exporta seus próprios valores sem colunas contábeis', () => {
    const view = buildStatementView({ rows: [{ ...row, values: row.valuesGer, valuesGer: undefined }],
      columns: montarColunas(periods, 'mes'), variant: 'dre', bases: () => [], showAV: false,
      showAH: false, ahType: 'anterior', periods, visible: () => true, standard: () => true, thousands: false });
    expect(view.rows[0].cells.map(c => c.value)).toEqual([130, 180]);
    expect(view.headers).toHaveLength(2);
  });
});