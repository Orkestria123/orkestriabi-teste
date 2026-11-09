import { describe, expect, it } from "vitest";
import { aberturaPatrimonial, participantePorCodigo } from "./validacao-contas";
describe("faixas do diário", () => {
  it("cliente de 100000 a 499999", () => {
    expect(participantePorCodigo("100000")).toBe("Cliente");
    expect(participantePorCodigo("499999")).toBe("Cliente");
    expect(participantePorCodigo("99999")).toBeNull();
  });
  it("fornecedor a partir de 500000", () => {
    expect(participantePorCodigo("500000")).toBe("Fornecedor");
    expect(participantePorCodigo("1000000")).toBe("Fornecedor");
    expect(participantePorCodigo("ABC500000")).toBeNull();
  });
});
it("abertura da Rota Inox não transfere novamente o resultado de 2018", () => {
  expect(aberturaPatrimonial({ upload_id: "csv", classificacao: "3.01.01.01.01" })).toBe(false);
  expect(aberturaPatrimonial({ upload_id: "csv", classificacao: "2.05.01.09.01" })).toBe(true);
  expect(aberturaPatrimonial({ upload_id: null, classificacao: "3.01.01.01.01" })).toBe(true);
});