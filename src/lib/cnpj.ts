// Validação e formatação de CNPJ.
//
// Aceita o CNPJ clássico (14 dígitos) e o ALFANUMÉRICO (IN RFB 2.229/2024):
// nas 12 primeiras posições podem vir letras, e os 2 dígitos verificadores
// continuam numéricos.
//
// O cálculo é o mesmo nos dois casos — muda só como cada posição vira
// número: `valor = código ASCII - 48`. Para dígitos isso devolve o próprio
// dígito ('0'→0 … '9'→9), então uma implementação só atende os dois
// formatos, sem caminho separado que possa divergir.

/** Só o que interessa: dígitos e letras, em maiúsculas. */
export function limparCnpj(v: string): string {
  return (v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** 00.000.000/0000-00 — formata o que já foi digitado, sem completar. */
export function formatarCnpj(v: string): string {
  const s = limparCnpj(v).slice(0, 14);
  if (s.length <= 2) return s;
  if (s.length <= 5) return `${s.slice(0, 2)}.${s.slice(2)}`;
  if (s.length <= 8) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5)}`;
  if (s.length <= 12) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8)}`;
  return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
}

const valorDe = (c: string) => c.charCodeAt(0) - 48;

function digitoVerificador(base: string): number {
  // Pesos 2..9 cíclicos, da direita para a esquerda.
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += valorDe(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * `true` para CNPJ com dígitos verificadores corretos.
 *
 * Rejeita a repetição do mesmo caractere (00000000000000 e afins): passa
 * na conta, mas não é CNPJ de ninguém.
 */
export function validarCnpj(v: string): boolean {
  const s = limparCnpj(v);
  if (s.length !== 14) return false;
  if (/^(.)\1{13}$/.test(s)) return false;
  // Os dois verificadores são sempre numéricos, mesmo no alfanumérico.
  if (!/^[0-9]{2}$/.test(s.slice(12))) return false;

  const base = s.slice(0, 12);
  const dv1 = digitoVerificador(base);
  const dv2 = digitoVerificador(base + String(dv1));
  return s === base + String(dv1) + String(dv2);
}

/**
 * Mensagem de erro pronta para a tela, ou `null` se estiver tudo certo.
 * Vazio é aceito de propósito: CNPJ não é obrigatório no cadastro — só
 * não pode estar errado quando preenchido.
 */
export function erroCnpj(v: string): string | null {
  const s = limparCnpj(v);
  if (s.length === 0) return null;
  if (s.length !== 14) return `CNPJ incompleto — tem ${s.length} de 14 caracteres.`;
  if (/^(.)\1{13}$/.test(s)) return "CNPJ inválido (todos os caracteres iguais).";
  if (!validarCnpj(s)) return "CNPJ inválido — confira os dígitos verificadores.";
  return null;
}
