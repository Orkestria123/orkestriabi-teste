import { describe, expect, it } from 'vitest';
import { buildContext, calcularSerie, calcularSerieComBase, type IndicadorEmpresa, type ResolverLinha } from './engine';
import { resultadoExercicioAte } from './linhas';

const periods = ['2026-01-01', '2026-02-01', '2026-06-01'];
const ctx = buildContext({ plano: [], saldos: [], aberturas: new Map() });
const monthly = [100, 200, 300];
const assets = [1000, 2000, 6000];
const equity = [500, 1000, 3000];
const resolver: ResolverLinha = (line, period) => {
  const index = periods.indexOf(period);
  if (index < 0) return null;
  if (line === 'LUCRO_LIQUIDO') return monthly[index];
  if (line === 'LUCRO_LIQUIDO_YTD') return monthly.slice(0, index + 1).reduce((sum, value) => sum + value, 0);
  if (line === 'ATIVO_TOTAL') return assets[index];
  if (line === 'PATRIMONIO_LIQUIDO') return equity[index];
  return null;
};
function indicator(name: string, denominator: string): IndicadorEmpresa {
  return {
    id: name, nome: name, tenant_id: 'test', company_id: 'test', categoria: 'Rentabilidade',
    formula: { expressao: [
      { tipo: 'termo', origem: 'demonstracao', linha: 'LUCRO_LIQUIDO' },
      { tipo: 'operador', valor: '/' },
      { tipo: 'termo', origem: 'demonstracao', linha: denominator },
    ] },
    modo_analise: 'percentual', faixas: null, descricao: null, visibilidade: 'ambos',
    is_padrao: true, revisar_contas: false, ordem: 0,
  };
}
describe('Rentabilidade mensal sem lucro acumulado', () => {
  it('ROA divide o lucro de cada mês pelo ativo do mesmo mês', () => {
    const ind = indicator('ROA', 'ATIVO_TOTAL');
    expect(calcularSerie(ind, periods, ctx, resolver).map(point => point.valor)).toEqual([0.1, 0.1, 0.05]);
    for (const base of ['rb', 'rl'] as const) {
      expect(calcularSerieComBase(ind, periods, ctx, resolver, base).map(point => point.valor)).toEqual([0.1, 0.1, 0.05]);
    }
  });
  it('ROE divide o lucro de cada mês pelo patrimônio líquido do mesmo mês', () => {
    const ind = indicator('ROE', 'PATRIMONIO_LIQUIDO');
    expect(calcularSerie(ind, periods, ctx, resolver).map(point => point.valor)).toEqual([0.2, 0.2, 0.1]);
    expect(calcularSerie(ind, [periods[2]], ctx, resolver)[0]?.valor).toBe(0.1);
    for (const base of ['rb', 'rl'] as const) {
      expect(calcularSerieComBase(ind, periods, ctx, resolver, base).map(point => point.valor)).toEqual([0.2, 0.2, 0.1]);
    }
  });
});

describe('Biamar: despesa analítica com classificação terminada em 99', () => {
  it('inclui R$ 29.533,33 de criação de imagens no resultado de 2024', () => {
    const context = buildContext({
      plano: [{ codigo: '4999', classificacao: '3.06.01.02.99', descricao: 'DESPESAS COM CRIAÇÃO DE IMAGENS', natureza: 'D', is_sintetica: false }],
      saldos: [
        { conta_codigo: '4999', competencia: '2024-10-01', total_debitos: 8000, total_creditos: 0 },
        { conta_codigo: '4999', competencia: '2024-11-01', total_debitos: 12333.33, total_creditos: 0 },
        { conta_codigo: '4999', competencia: '2024-12-01', total_debitos: 9200, total_creditos: 0 },
      ],
      aberturas: new Map(),
    });
    expect(resultadoExercicioAte(context, '2024-12-01')).toBeCloseTo(-29533.33, 2);
    expect(14966553.05 + resultadoExercicioAte(context, '2024-12-01')).toBeCloseTo(14937019.72, 2);
  });
});