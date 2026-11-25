import { describe, expect, it } from "vitest";
import { criarAcumuladorComAjustes } from "./acumulador";

describe("aberturas contábeis não encerram ajustes gerenciais", () => {
  it("preserva os ajustes anteriores à abertura de setembro/2026 da Dalmobile", () => {
    const acum = criarAcumuladorComAjustes(
      [{ conta_codigo: "clientes", competencia: "2026-09-01", movimento: 100 }],
      [{ conta_codigo: "clientes", data_referencia: "2026-08-31", saldo: 10000 }],
      [{ conta_codigo: "clientes", competencia: "2026-08-01", movimento: 2103389.53 }],
    );
    expect(acum.saldoAte("clientes", "2026-09-01")).toBeCloseTo(2113489.53, 2);
  });

  it("mantém ajustes de resultados anteriores mesmo com nova abertura anual", () => {
    const acum = criarAcumuladorComAjustes([], [
      { conta_codigo: "caixa", data_referencia: "2025-12-31", saldo: 1000 },
    ], [{ conta_codigo: "despesa", competencia: "2025-12-01", movimento: 200 }]);
    expect(acum.saldoAte("despesa", "2026-01-01")).toBe(200);
    expect(acum.saldoAte("despesa", "2025-11-01")).toBe(0);
    expect(acum.contas()).toContain("despesa");
  });

  it("mantém a fotografia da ECD sem duplicar movimentos contábeis anteriores", () => {
    const acum = criarAcumuladorComAjustes([
      { conta_codigo: "caixa", competencia: "2026-08-01", movimento: 700 },
      { conta_codigo: "caixa", competencia: "2026-09-01", movimento: 50 },
    ], [{ conta_codigo: "caixa", data_referencia: "2026-08-31", saldo: 1000 }], []);
    expect(acum.saldoAte("caixa", "2026-09-01")).toBe(1050);
  });
});