// Motor de Ponto de Equilíbrio.
// Dado:
//   - receita_total: do período
//   - despesas detalhadas: lista de { descricao, valor, tipo_custo: 'fixo' | 'variavel' | null }
// Calcula:
//   - custos_fixos, custos_variaveis (apenas linhas com classificação)
//   - margem_contribuicao_pct = 1 - (variaveis / receita)
//   - ponto_equilibrio_receita = fixos / margem_contribuicao_pct
//   - margem_seguranca = (receita - PE) / receita
//   - alavancagem_operacional (GAO) = MC / (MC - fixos)  [usando MC em R$]
//   - cobertura: percentual de despesas classificadas (qualidade do dado)

export interface DespesaItem {
  classificacao: string;
  descricao: string;
  valor: number; // positivo
  tipo_custo: "fixo" | "variavel" | null;
}

export interface PontoEquilibrioResultado {
  receita: number;
  custos_fixos: number;
  custos_variaveis: number;
  despesa_nao_classificada: number;
  cobertura_pct: number; // (fixos+variaveis) / total despesa
  margem_contribuicao: number; // R$
  margem_contribuicao_pct: number; // 0..1
  ponto_equilibrio_receita: number | null;
  margem_seguranca_pct: number | null; // pode ser negativa
  alavancagem_operacional: number | null;
  // série para o gráfico clássico (receita × custos)
  serie: Array<{ receita: number; receitaTotal: number; custoTotal: number; custoFixo: number }>;
  pe_marker: { x: number; y: number } | null;
}

export function calcularPontoEquilibrio(
  receita: number,
  despesas: DespesaItem[],
): PontoEquilibrioResultado {
  let fixos = 0;
  let variaveis = 0;
  let semClass = 0;
  for (const d of despesas) {
    const v = Math.abs(d.valor);
    if (d.tipo_custo === "fixo") fixos += v;
    else if (d.tipo_custo === "variavel") variaveis += v;
    else semClass += v;
  }
  const totalDesp = fixos + variaveis + semClass;
  const cobertura_pct = totalDesp > 0 ? (fixos + variaveis) / totalDesp : 0;

  const mc_pct = receita > 0 ? 1 - variaveis / receita : 0;
  const mc = receita - variaveis;
  const pe = mc_pct > 0 ? fixos / mc_pct : null;
  const margem_seg = pe != null && receita > 0 ? (receita - pe) / receita : null;
  const gao = mc - fixos !== 0 ? mc / (mc - fixos) : null;

  // Série para o gráfico: receita variando de 0 até max(receita, PE) * 1.3
  const xMax = Math.max(receita, pe ?? 0) * 1.3 || 100;
  const steps = 20;
  const serie = Array.from({ length: steps + 1 }, (_, i) => {
    const x = (xMax * i) / steps;
    const variavelProporcional = receita > 0 ? variaveis * (x / receita) : 0;
    return {
      receita: x,
      receitaTotal: x,
      custoTotal: fixos + variavelProporcional,
      custoFixo: fixos,
    };
  });

  return {
    receita,
    custos_fixos: fixos,
    custos_variaveis: variaveis,
    despesa_nao_classificada: semClass,
    cobertura_pct,
    margem_contribuicao: mc,
    margem_contribuicao_pct: mc_pct,
    ponto_equilibrio_receita: pe,
    margem_seguranca_pct: margem_seg,
    alavancagem_operacional: gao,
    serie,
    pe_marker: pe != null ? { x: pe, y: pe } : null,
  };
}
