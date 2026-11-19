import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { indicadoresEbitEfetivos, selecionarFormulasEbit } from "./ebit-fonte";
import type { Token } from "./engine";

describe("EBITDA por empresa", () => {
  const global: Token[] = [{ tipo: "termo", origem: "demonstracao", linha: "EBIT" }];
  const alumiconte: Token[] = [...global, { tipo: "operador", valor: "+" }, { tipo: "termo", origem: "conta", contas: ["ALU-0039"], sinais: ["-"] }];
  const rows = [
    { id: "global", nome: "Ebitda", company_id: null, formula: { expressao: global } },
    { id: "alu", nome: "Ebitda", company_id: "alumiconte", formula: { expressao: alumiconte } },
  ];
  it("inclui ALU-0039 no EBITDA somente da Alumiconte", () => {
    expect(selecionarFormulasEbit(rows, "alumiconte").ebitda).toEqual(alumiconte);
    expect(selecionarFormulasEbit(rows, "outra").ebitda).toEqual(global);
    expect(selecionarFormulasEbit(rows).ebitda).toEqual(global);
  });
  it("exibe apenas o EBITDA da empresa quando há exceção, preservando os demais indicadores", () => {
    const indicadores = [{ nome: "Ebitda", escopo: "global" }, { nome: "Ebitda", escopo: "empresa" }, { nome: "Margem Ebitda", escopo: "global" }];
    expect(indicadoresEbitEfetivos(indicadores)).toEqual(indicadores.slice(1));
  });
});