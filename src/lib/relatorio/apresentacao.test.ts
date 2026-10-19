import { describe, expect, it } from "vitest";
import { destaqueBp, indiceEbitRelatorio, linhasBpRelatorio, linhasDfcRelatorio, linhasDreRelatorio, valorCaixaNominal } from "./apresentacao";
import { normalizarSecoes, type LinhaDemo } from "./tipos";

const row = (descricao: string, nivel = 4, subtotal = true, valor = 120): LinhaDemo => ({ descricao, nivel, subtotal, valores: { "2026-08-01": valor } });
describe("Seleção do relatório executivo sem alterar totais", () => {
  it("inclui adiantamentos de funcionários no ativo", () => {
    const l = row("ADIANTAMENTOS DE FUNCIONÁRIOS");
    expect(linhasBpRelatorio([l, row("Funcionário individual", 5, false)])).toEqual([l]);
  });
  it("inclui créditos diversos no ativo", () => {
    const l = row("CRÉDITOS DIVERSOS");
    expect(linhasBpRelatorio([l, row("CRÉDITOS", 3)])).toEqual([l]);
  });
  for (const label of ["Imobilizado", "Outros Débitos", "Encargos Financeiros Longo Prazo"]) {
    it(`não destaca ${label}, independentemente do grupo ao lado`, () => {
      expect(destaqueBp(row(label, 3))).toBe(false);
      expect(destaqueBp(row("Ativo Circulante", 1))).toBe(true);
    });
  }
  it("inclui gastos de fabricação com mão de obra sem duplicar valores", () => {
    const l = row("GASTOS C/FAB./MAO-DE-OBRA ENCAR. DIRETOS", 1, false, -250);
    expect(linhasDreRelatorio([l])).toEqual([l]);
    expect(l.valores["2026-08-01"]).toBe(-250);
  });
  it("inclui gastos gerais de fabricação", () => {
    const l = row("GASTOS GERAIS DE FABRICACAO", 1, false);
    expect(linhasDreRelatorio([l])).toEqual([l]);
  });
  it("oculta fornecedores, preservando capital de giro e fluxo operacional", () => {
    const giro = row("Variação do Capital de Giro", 1, true, -100);
    const fco = row("Caixa das atividades operacionais", 0, true, 500);
    expect(linhasDfcRelatorio([giro, row("Variação de Fornecedores", 1, false, 40), fco])).toEqual([giro, fco]);
    expect(fco.valores["2026-08-01"]).toBe(500);
  });
  it("não escala valores nominais do caixa para milhões", () => {
    expect(valorCaixaNominal(1234567.89)).toBe("R$ 1.234.567,89");
    expect(valorCaixaNominal(-100)).toBe("(R$ 100,00)");
  });
  it("EBIT vem da linha mensal EBIT, não EBITDA ou acumulado", () => {
    const ebit = row("(=) EBIT", 0, true, 300);
    ebit.valores["2026-07-01"] = 200;
    const i = indiceEbitRelatorio({ dre: [row("(=) EBITDA", 0, true, 900), ebit], periodo: "2026-08-01", anterior: "2026-07-01" });
    expect(i.atual).toBe(300);
    expect(i.anterior).toBe(200);
    expect(indiceEbitRelatorio({dre:[], periodo:"2026-08-01", anterior:null}).atual).toBeNull();
  });
  it("retira a seção notas inclusive de modelos antigos", () => {
    const ids = normalizarSecoes([{ id: "notas", visivel: true }, { id: "bp", visivel: true }]).map(s=>s.id);
    expect(ids).not.toContain("notas");
    expect(ids).toContain("bp");
  });
});