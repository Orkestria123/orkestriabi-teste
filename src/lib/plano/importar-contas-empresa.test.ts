import { describe, expect, it } from "vitest";
import { lerLinhasContas } from "./importar-contas-empresa";

const validas = new Set(["2.01.01.01.01", "621"]);

describe("importação de contas específicas", () => {
  it("lê as duas colunas pelo cabeçalho", () => {
    const r = lerLinhasContas([["Conta Sintética", "Nome Atribuído"], ["2.01.01.01.01", "Fornecedor X"]], validas);
    expect(r).toEqual([{ linha: 2, sintetica: "2.01.01.01.01", nome: "Fornecedor X", erro: undefined }]);
  });
  it("aponta sintética inexistente e linha sem nome", () => {
    const r = lerLinhasContas([["Conta Sintética", "Nome Atribuído"], ["9.99", "A"], ["621", ""]], validas);
    expect(r[0].erro).toBe("Sintética não existe no Plano Padrão");
    expect(r[1].erro).toBe("Sem nome");
  });
});
