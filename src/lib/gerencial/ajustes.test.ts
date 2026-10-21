import { describe, expect, it } from "vitest";
import { ajustesToSaldosVirtuais, type AjusteResolvido } from "./ajustes";

const base: AjusteResolvido = {
  id: "a1",
  competencia: "2026-08-01",
  descricao: "Ajuste",
  conta_debito: "D1",
  conta_credito: "C1",
  valor: 1000,
  movimenta_dfc: true,
  debito: { codigo: "D1", descricao: "D", classificacao: "1", origem: "plano" },
  credito: { codigo: "C1", descricao: "C", classificacao: "2", origem: "plano" },
};

describe("ajustesToSaldosVirtuais — marcação DFC", () => {
  it("ignora na DFC o lançamento desmarcado como 'não movimenta DFC'", () => {
    const semDfc = { ...base, id: "a2", movimenta_dfc: false };
    const saldos = ajustesToSaldosVirtuais([base, semDfc], () => true, true);
    expect(saldos).toHaveLength(2);
    expect(saldos.every((s) => ["D1", "C1"].includes(s.conta_codigo))).toBe(true);
  });

  it("mantém o lançamento desmarcado nas demais demonstrações", () => {
    const semDfc = { ...base, id: "a2", movimenta_dfc: false };
    const saldos = ajustesToSaldosVirtuais([base, semDfc], () => true);
    expect(saldos).toHaveLength(4);
  });
});
