// Custo estimado do banco de dados do Lovable Cloud, em créditos.
// Valores de referência do tamanho Small — não são a fatura real do plano.

export const TAMANHO_BANCO = "Small";

/** Crédito por hora com o banco ativo. */
export const CUSTO_HORA_CREDITOS = 0.17;

export const HORAS_DIA = 24;
/** Mês comercial de 30 dias para a projeção. */
export const HORAS_MES = 720;

/** Valor de referência do crédito em dólar (100 créditos = US$ 30,00 na recarga). */
export const CREDITO_USD = 0.3;
/** Câmbio estimado US$ 1 → R$. Ajustar quando a taxa mudar de forma relevante. */
export const CAMBIO_BRL = 5.4;

export function custoPorDia(hora = CUSTO_HORA_CREDITOS): number {
  return hora * HORAS_DIA;
}

export function custoPorMes(hora = CUSTO_HORA_CREDITOS): number {
  return hora * HORAS_MES;
}

/** Custo de um número de horas ativas no mês (para cenários parcial/total). */
export function custoHoras(horas: number, hora = CUSTO_HORA_CREDITOS): number {
  return horas * hora;
}

/** Converte um valor em créditos para R$ usando crédito × US$ × câmbio. */
export function creditosParaBRL(creditos: number): number {
  return creditos * CREDITO_USD * CAMBIO_BRL;
}
