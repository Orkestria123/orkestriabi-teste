import { describe, expect, it } from "vitest";
import { formatPct } from "./format";
import { formatIndicador } from "./indicators";
import { formatarIndice } from "./dashboard/indices-financeiros";
import { formatarComparavel } from "./comparativo/indices-empresa";
import { formatarValor } from "./indicadores/engine";

describe("indicadores percentuais com duas casas decimais", () => {
  it.each([
    ["percentual compartilhado", (v: number) => formatPct(v)],
    ["Dashboard", (v: number) => formatarIndice(v, "percent")],
    ["indicadores", (v: number) => formatIndicador(v, "percent")],
    ["Consolidado Empresas", (v: number) => formatarComparavel(v, "percent")],
    ["análise percentual", (v: number) => formatarValor(v, "percentual")],
    ["análise horizontal", (v: number) => formatarValor(v, "ah_percent")],
  ])("%s mantém duas casas e vírgula", (_nome, formatar) => {
    expect(formatar(8.2)).toBe("8,20%");
    expect(formatar(0)).toBe("0,00%");
    expect(formatar(12.345)).toBe("12,35%");
  });
});