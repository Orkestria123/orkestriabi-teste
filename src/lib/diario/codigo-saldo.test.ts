import { describe, expect, it } from "vitest";
import { codigoSaldo } from "./codigo-saldo";

describe("proveniência dos saldos", () => {
  const traduzir = (codigo: string) => ({ "603": "1009", "1009": "5204", "1021": "ALU-0014" })[codigo] ?? codigo;
  it("preserva vendas ECD já aplicadas em 1009, sem virar despesa financeira 5204", () => {
    expect(codigoSaldo({ conta_codigo: "1009", origem_ecd: "0592f103-a1a3-4608-863f-fb1a6a2230fd" }, traduzir)).toBe("1009");
  });
  it("preserva revendas ECD em 1021, sem virar participação no lucro", () => {
    expect(codigoSaldo({ conta_codigo: "1021", origem_ecd: "0592f103-a1a3-4608-863f-fb1a6a2230fd" }, traduzir)).toBe("1021");
  });
  it("traduz diário bruto e abertura CSV exatamente uma vez", () => {
    expect(codigoSaldo({ conta_codigo: "603", origem_ecd: null }, traduzir)).toBe("1009");
  });
  it("não confunde código de diário com código padrão coincidente", () => {
    expect(codigoSaldo({ conta_codigo: "1009", origem_ecd: null }, traduzir)).toBe("5204");
  });
});