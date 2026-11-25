export type VisaoBalanco = "contabil" | "gerencial";
export interface TotalBalancoRow {
  periodo: string;
  descricao: string;
  valor: number;
  valor_gerencial?: number;
}
export interface ConsistenciaMes {
  periodo: string;
  visao: VisaoBalanco;
  ativo: number | null;
  passivoPl: number | null;
  diferenca: number | null;
  status: "equilibrado" | "diferenca" | "incompleto";
}

/** Compara totais monetários em centavos, sem compensar meses ou visões. */
export function conferirTotaisBalanco(
  ativoRows: TotalBalancoRow[],
  passivoRows: TotalBalancoRow[],
  periodos: string[],
  visao: VisaoBalanco,
  campo: "valor" | "valor_gerencial" = "valor",
): ConsistenciaMes[] {
  const total = (rows: TotalBalancoRow[], descricao: string, periodo: string) => {
    const encontrados = rows.filter((r) => r.periodo === periodo && r.descricao === descricao);
    if (encontrados.length !== 1) return null;
    const valor = encontrados[0]?.[campo];
    return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
  };
  return Array.from(new Set(periodos)).sort().map((periodo) => {
    const ativo = total(ativoRows, "Total do Ativo", periodo);
    const passivoPl = total(passivoRows, "Total do Passivo + PL", periodo);
    const diferenca = ativo === null || passivoPl === null
      ? null : (Math.round(ativo * 100) - Math.round(passivoPl * 100)) / 100;
    return { periodo, visao, ativo, passivoPl, diferenca,
      status: diferenca === null ? "incompleto" : diferenca === 0 ? "equilibrado" : "diferenca" };
  });
}