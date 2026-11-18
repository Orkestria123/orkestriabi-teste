/** Company overrides must be resolved before filtering the statement side. */
export function resolverParticipantes<T extends { codigo: string; company_id?: string | null; tipo?: string }>(rows: T[], tipos: string[]): T[] {
  const porCodigo = new Map<string, T>();
  for (const row of rows) {
    const atual = porCodigo.get(row.codigo);
    if (!atual || row.company_id) porCodigo.set(row.codigo, row);
  }
  return [...porCodigo.values()].filter(row => !!row.tipo && tipos.includes(row.tipo));
}