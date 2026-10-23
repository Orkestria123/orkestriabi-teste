import { describe, expect, it } from "vitest";
import {
  CUSTO_HORA_CREDITOS,
  HORAS_DIA,
  HORAS_MES,
  custoPorDia,
  custoPorMes,
  custoHoras,
} from "./custo-banco";

describe("custo estimado do banco", () => {
  it("multiplica o custo por hora por 24 para fechar o dia", () => {
    expect(HORAS_DIA).toBe(24);
    expect(custoPorDia()).toBeCloseTo(4.08, 2);
  });

  it("multiplica o custo por hora por 720 para fechar o mês de 30 dias", () => {
    expect(HORAS_MES).toBe(720);
    expect(custoPorMes()).toBeCloseTo(122.4, 1);
  });

  it("aceita um custo por hora diferente sem mudar as bases", () => {
    expect(custoPorDia(0.5)).toBeCloseTo(12, 6);
    expect(custoPorMes(0.5)).toBeCloseTo(360, 6);
  });

  it("projeta um mês com o banco ativo só parte do dia", () => {
    expect(custoHoras(8)).toBeCloseTo(40.8, 1);
    expect(custoHoras(0)).toBe(0);
  });
});
