// Padroniza o saldo do balancete para a convenção D−C usada internamente.
// O balancete traz valor no "sentido do grupo":
//   - Ativo (grupo 1): devedor, vem positivo → mantém
//   - Passivo / PL (grupo 2): credor, vem positivo → INVERTE (vira negativo no D−C)
//   - Contas redutoras vêm negativas no arquivo → o sinal preservado já reflete o efeito
export function saldoPadronizado(valor: number, classificacao: string): number {
  const grupo = classificacao.trim().charAt(0);
  if (grupo === "1") return valor; // Ativo
  if (grupo === "2") return -valor; // Passivo + PL
  return valor; // 3+ não deve aparecer em balancete inicial; mantém
}
