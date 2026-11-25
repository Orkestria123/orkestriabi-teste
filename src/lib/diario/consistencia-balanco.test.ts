import { describe, expect, it } from "vitest";
import { conferirTotaisBalanco, type TotalBalancoRow } from "./consistencia-balanco";
const ativo = (periodo: string, valor: number): TotalBalancoRow => ({ periodo, valor, descricao: "Total do Ativo" });
const passivo = (periodo: string, valor: number): TotalBalancoRow => ({ periodo, valor, descricao: "Total do Passivo + PL" });

describe("consistência rígida do Balanço por mês e visão", () => {
  it("reprova diferença de um centavo em qualquer empresa", () => {
    expect(conferirTotaisBalanco([ativo("2025-12-01", 100)], [passivo("2025-12-01", 99.99)], ["2025-12-01"], "contabil")[0]?.status).toBe("diferenca");
  });
  it("não compensa diferenças opostas de meses distintos", () => {
    const meses = ["2026-09-01", "2026-10-01"];
    const rows = conferirTotaisBalanco(meses.map((p) => ativo(p, 100)), [passivo(meses[0], 99), passivo(meses[1], 101)], meses, "gerencial");
    expect(rows.map((r) => r.diferenca)).toEqual([1, -1]);
    expect(rows.every((r) => r.status === "diferenca")).toBe(true);
  });
  it("não aprova totais ausentes, nem substitui gerencial ausente por zero", () => {
    expect(conferirTotaisBalanco([], [], ["2025-12-01"], "contabil")[0]?.status).toBe("incompleto");
    expect(conferirTotaisBalanco([ativo("2025-12-01", 0)], [passivo("2025-12-01", 0)], ["2025-12-01"], "gerencial", "valor_gerencial")[0]?.status).toBe("incompleto");
  });
  it("não aprova valores inválidos", () => {
    expect(conferirTotaisBalanco([ativo("2025-12-01", NaN)], [passivo("2025-12-01", Infinity)], ["2025-12-01"], "contabil")[0]?.status).toBe("incompleto");
  });
  it("não aprova um total duplicado", () => {
    expect(conferirTotaisBalanco([ativo("2025-12-01", 100), ativo("2025-12-01", 100)], [passivo("2025-12-01", 100)], ["2025-12-01"], "contabil")[0]?.status).toBe("incompleto");
  });
  it("não confunde ruído de ponto flutuante com diferença monetária", () => {
    expect(conferirTotaisBalanco([ativo("2026-10-01", 114954203.58000001)], [passivo("2026-10-01", 114954203.5800001)], ["2026-10-01"], "contabil")[0]?.status).toBe("equilibrado");
  });
  it("confere Contábil e Gerencial separadamente no comparativo da Dalmobile", () => {
    const a = [{ ...ativo("2026-09-01", 113669265.46), valor_gerencial: 113855515.15 }];
    const p = [{ ...passivo("2026-09-01", 113669265.46), valor_gerencial: 115958904.68 }];
    expect(conferirTotaisBalanco(a, p, ["2026-09-01"], "contabil")[0]?.status).toBe("equilibrado");
    expect(conferirTotaisBalanco(a, p, ["2026-09-01"], "gerencial", "valor_gerencial")[0]?.diferenca).toBe(-2103389.53);
  });
  it("detecta o encerramento duplicado da Dalmobile 2025 e aprova a conciliação", () => {
    const a = [ativo("2025-12-01", 107232774.89)];
    expect(conferirTotaisBalanco(a, [passivo("2025-12-01", 114095280.05)], ["2025-12-01"], "contabil")[0]?.diferenca).toBe(-6862505.16);
    expect(conferirTotaisBalanco(a, [passivo("2025-12-01", 107232774.89)], ["2025-12-01"], "contabil")[0]?.status).toBe("equilibrado");
  });
});