import { describe, expect, it } from "vitest";
import { resultadoDesdeAbertura } from "./resultado-abertura";

const dre = new Set(["receita"]);
const movimentos = [
  { conta_codigo: "receita", competencia: "2025-07-01", movimento: -2523556.86 },
  { conta_codigo: "receita", competencia: "2025-08-01", movimento: -100 },
];
const abertura = [{ conta_codigo: "lucros", data_referencia: "2025-07-31", saldo: -2523556.86 }];

describe("resultado contábil com fotografia ECD no meio do ano", () => {
  it("não duplica os R$ 2.523.556,86 da Natursuc incorporados ao PL da nova ECD", () => {
    expect(resultadoDesdeAbertura("2025-08-01", dre, movimentos, abertura, [])).toBe(100);
  });
  it("preserva o resultado anterior quando a abertura ainda é futura", () => {
    expect(resultadoDesdeAbertura("2025-07-01", dre, movimentos, abertura, [])).toBe(2523556.86);
  });
  it("mantém janeiro como início se não existe abertura intermediária", () => {
    expect(resultadoDesdeAbertura("2025-08-01", dre, movimentos, [], [])).toBe(2523656.86);
  });
  it("não descarta ajustes gerenciais anteriores à fotografia contábil", () => {
    expect(resultadoDesdeAbertura("2025-08-01", dre, movimentos, abertura,
      [{ conta_codigo: "receita", competencia: "2025-06-01", movimento: -200 }])).toBe(300);
  });
  it("inclui resultado não encerrado que a própria abertura conserva", () => {
    expect(resultadoDesdeAbertura("2025-08-01", dre, movimentos,
      [...abertura, { conta_codigo: "receita", data_referencia: "2025-07-31", saldo: -2523556.86 }], [])).toBe(2523656.86);
  });
});