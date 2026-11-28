import type { AberturaConta, MovimentoConta } from "./acumulador";

/** An intra-year ECD snapshot already contains the preceding accounting result. */
export function resultadoDesdeAbertura(
  ref: string,
  codigosDre: ReadonlySet<string>,
  movimentos: MovimentoConta[],
  aberturas: AberturaConta[],
  ajustes: MovimentoConta[],
): number {
  const janeiro = `${ref.slice(0, 4)}-01-01`;
  const corte = aberturas.reduce<string | null>((ultima, a) =>
    a.data_referencia >= janeiro && a.data_referencia <= ref &&
    (ultima === null || a.data_referencia > ultima) ? a.data_referencia : ultima, null);
  let soma = 0;
  for (const a of aberturas) {
    if (corte && a.data_referencia === corte && codigosDre.has(a.conta_codigo)) soma += a.saldo;
  }
  for (const m of movimentos) {
    if (m.competencia >= janeiro && m.competencia <= ref &&
      (!corte || m.competencia > corte) && codigosDre.has(m.conta_codigo)) soma += m.movimento;
  }
  // Accounting snapshots never contain BI managerial adjustments.
  for (const m of ajustes) {
    if (m.competencia >= janeiro && m.competencia <= ref && codigosDre.has(m.conta_codigo)) soma += m.movimento;
  }
  return -soma;
}