// Padroniza o saldo do balancete para a convenção D−C usada internamente.
// O balancete traz valor no "sentido do grupo":
//   - Ativo: devedor, vem positivo → mantém
//   - Passivo / PL: credor, vem positivo → INVERTE (vira negativo no D−C)
//   - Contas redutoras vêm negativas no arquivo → o sinal preservado já reflete o efeito
//
// O grupo é derivado pela MÁSCARA configurável (não mais por charAt(0) fixo).

import { grupoDe, MASCARA_DEFAULT, type MascaraConfig } from "@/lib/mascara/interpretar";

export function saldoPadronizado(
  valor: number,
  classificacao: string,
  mascara: MascaraConfig = MASCARA_DEFAULT,
): number {
  const g = grupoDe(classificacao, mascara);
  if (g === "passivo" || g === "pl") return -valor; // credor inverte
  return valor; // ativo, despesa, receita, resultado → mantém
}
