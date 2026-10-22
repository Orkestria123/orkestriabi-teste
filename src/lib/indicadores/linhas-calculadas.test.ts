import { describe, expect, it } from "vitest";
import { selecionarFormulasLinhas, type DefinicaoLinha } from "./linhas-calculadas";
import { avaliarExpressao, buildContext, type Token } from "./engine";
import { MASCARA_DEFAULT } from "@/lib/mascara/interpretar";
import { indexarDemoDre, resolverLinha } from "./linhas";

const termo = (contas: string[]): Token[] => [{ tipo: "termo", origem: "conta", contas }];
const padrao: DefinicaoLinha = { id: "padrao", company_id: null, linha_calculada_key: "CUSTO_PRODUTOS", formula: { expressao: termo(["compras"]) }, exibir_demonstracao: true };
const excecao: DefinicaoLinha = { ...padrao, id: "excecao", company_id: "dal", formula: { expressao: termo(["compras", "DAL-0002"]) }, exibir_demonstracao: false };

describe("Linhas calculadas de custos", () => {
  it("a exceção da Dal Mobile inclui a conta específica sem mudar outras empresas", () => {
    const dal = selecionarFormulasLinhas([padrao, excecao], "dal");
    const outra = selecionarFormulasLinhas([padrao, excecao], "outra");
    expect(dal.CUSTO_PRODUTOS?.tokens).toEqual(termo(["compras", "DAL-0002"]));
    expect(outra.CUSTO_PRODUTOS?.tokens).toEqual(termo(["compras"]));
  });
  it("ocultar é apenas apresentação: fórmula mantém débito de R$ 310.300,00 em janeiro e estorno em fevereiro", () => {
    const ctx = buildContext({ plano: [
      { codigo: "compras", classificacao: "3.02.01.02.01", descricao: "Compras", natureza: null, is_sintetica: false },
      { codigo: "DAL-0002", classificacao: "3.02.01.DAL0002", descricao: "CPV", natureza: null, is_sintetica: false },
    ], saldos: [
      { conta_codigo: "3.02.01.DAL0002", competencia: "2026-01-01", total_debitos: 310300, total_creditos: 0 },
      { conta_codigo: "3.02.01.DAL0002", competencia: "2026-02-01", total_debitos: 0, total_creditos: 310300 },
    ], aberturas: new Map(), mascara: MASCARA_DEFAULT });
    const formula = selecionarFormulasLinhas([padrao, excecao], "dal").CUSTO_PRODUTOS;
    expect(formula?.exibir).toBe(false);
    expect(avaliarExpressao(formula?.tokens ?? [], "2026-01-01", ctx)).toBe(-310300);
    expect(avaliarExpressao(formula?.tokens ?? [], "2026-02-01", ctx)).toBe(310300);
    const demo = indexarDemoDre([{ periodo: "2026-01-01", descricao: "(-) Custo de materiais dos produtos", codigo_conta: "CUSTO_PRODUTOS", valor: -310300, is_subtotal: true }], []);
    expect(resolverLinha("CUSTO_PRODUTOS", "2026-01-01", ctx, demo, [])).toBe(-310300);
  });
  it("remover exceção restaura a fórmula do escritório", () => {
    expect(selecionarFormulasLinhas([padrao], "dal").CUSTO_PRODUTOS?.tokens).toEqual(termo(["compras"]));
  });
});