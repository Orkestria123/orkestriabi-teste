import { describe, it, expect } from "vitest";
import { lerLinhasAjustes, parseCompetencia } from "./planilha-ajustes";

const contas: Record<string, string> = { "100": "100", "1.01.01": "100", "200": "200" };
const res = (r: string) => contas[r] ?? null;
const head = ["Competência", "Conta Débito", "Conta Crédito", "Valor", "Descrição", "Justificativa", "Movimenta DFC"];

describe("planilha de lançamentos gerenciais", () => {
  it("lê competência em vários formatos", () => {
    expect(parseCompetencia("08/2026")).toBe("2026-08-01");
    expect(parseCompetencia("2026-08")).toBe("2026-08-01");
    expect(parseCompetencia("13/2026")).toBeNull();
  });
  it("aceita classificação e converte em código; movimenta DFC Não", () => {
    const [l] = lerLinhasAjustes([head, ["08/2026", "1.01.01", "200", "1.500,00", "Ajuste", "", "Não"]], res);
    expect(l.erro).toBeUndefined();
    expect(l.conta_debito).toBe("100");
    expect(l.valor).toBe(1500);
    expect(l.movimenta_dfc).toBe(false);
  });
  it("rejeita débito igual ao crédito e conta inexistente", () => {
    const ls = lerLinhasAjustes([head, ["08/2026", "100", "1.01.01", "10", "x"], ["08/2026", "999", "200", "10", "x"]], res);
    expect(ls[0].erro).toMatch(/iguais/);
    expect(ls[1].erro).toMatch(/não encontrada/);
  });
});
