/** ECD application persists destination codes; only raw diary rows need translation. */
export function codigoSaldo(
  row: { conta_codigo: string; origem_ecd?: string | null },
  traduzir: ((codigo: string) => string) | null,
): string {
  return row.origem_ecd || !traduzir ? row.conta_codigo : traduzir(row.conta_codigo);
}