import { describe, expect, it } from "vitest";
import { possuiAjustesNoPeriodo, unirLinhasComparativo, valoresComparativo, visaoRelatorio } from "./comparativo";
import type { DadosRelatorio, LinhaDemo } from "./tipos";
const linha = (descricao: string, valor: number): LinhaDemo => ({ descricao, nivel: 1, subtotal: true, valores: { "2026-08-01": valor } });
const dados: DadosRelatorio = { periodo: "2026-08-01", anterior: null, dre: [], bpAtivo: [], bpPassivo: [], dfc: [], indices: [], faturamento: [] };
describe("Relatório sempre comparativo quando há gerencial", () => {
  it("seleciona Comparativo para as duas bases e Contábil sem ajustes", () => {
    expect(visaoRelatorio({ ...dados, gerencial: dados })).toBe("comparativo");
    expect(visaoRelatorio(dados)).toBe("contabil");
  });
  it("diferença é Gerencial menos Contábil, incluindo reduções", () => {
    expect(valoresComparativo(linha("Lucro", 100), [linha("Lucro", 80)], [dados.periodo])).toEqual([100, 80, -20]);
  });
  it("mantém contas novas exclusivas do gerencial", () => {
    const linhas = unirLinhasComparativo([], [linha("Despesa nova", -50)]);
    expect(valoresComparativo(linhas[0], [linha("Despesa nova", -50)], [dados.periodo])).toEqual([0, -50, -50]);
  });
  it("não confunde meses anteriores com ajustes futuros", () => {
    expect(possuiAjustesNoPeriodo([{ competencia: "2026-07-01", valor: 10 }], dados.periodo)).toBe(true);
    expect(possuiAjustesNoPeriodo([{ competencia: "2026-09-01", valor: 10 }], dados.periodo)).toBe(false);
    expect(possuiAjustesNoPeriodo([{ competencia: "2026-08-01", valor: 0 }], dados.periodo)).toBe(false);
  });
  it("acumula as duas bases separadamente nos mesmos meses", () => {
    const c = linha("Lucro", 100), g = linha("Lucro", 130);
    c.valores["2026-07-01"] = 50; g.valores["2026-07-01"] = 40;
    expect(valoresComparativo(c, [g], ["2026-07-01", dados.periodo])).toEqual([150, 170, 20]);
  });
});