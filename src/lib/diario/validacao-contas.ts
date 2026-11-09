/** Faixas do diário; códigos de ECD não usam esta inferência. */
export function participantePorCodigo(codigo: string): "Cliente" | "Fornecedor" | null {
  if (!/^\d+$/.test(codigo.trim())) return null;
  const n = Number(codigo);
  if (n >= 100000 && n <= 499999) return "Cliente";
  if (n >= 500000) return "Fornecedor";
  return null;
}

/** Balancetes CSV de abertura já incluem o resultado anterior no PL.
 * As contas de resultado são auditáveis, mas não reabrem o exercício encerrado.
 * Aberturas da ECD seguem sua própria regra. */
export function aberturaPatrimonial(r: { upload_id?: string | null; classificacao?: string | null }): boolean {
  return !r.upload_id || /^[12](?:[.\-/]|$)/.test(r.classificacao ?? "");
}