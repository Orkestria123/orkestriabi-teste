// Definições públicas dos indicadores padrão da biblioteca do escritório.
// Metadata em torno dos DEFS de src/lib/indicators.ts, exposta para a UI
// de configuração por empresa (aba "6. Indicadores").

import type { Categoria, Formato } from "@/lib/indicators";

export interface TermoDef {
  /** Chave estável do termo, usada como propriedade em `contas_por_termo`. */
  key: string;
  /** Rótulo exibido ao tenant. */
  label: string;
  /** Tipo do termo para orientar a natureza do saldo esperado. */
  tipo: "saldo" | "fluxo";
  /** Onde o termo costuma viver (para pré-filtrar a árvore do plano). */
  origem: "BP_ATIVO" | "BP_PASSIVO" | "DRE";
}

export interface IndicadorDef {
  key: string;
  label: string;
  categoria: Categoria;
  formato: Formato;
  formulaTexto: string;
  termos: TermoDef[];
}

// Reflete os DEFS de src/lib/indicators.ts. Mantido em sync manualmente:
// se adicionar/remover indicador lá, replique aqui.
export const INDICADOR_DEFS: IndicadorDef[] = [
  // LIQUIDEZ
  {
    key: "lc", label: "Liquidez Corrente", categoria: "Liquidez", formato: "ratio",
    formulaTexto: "Ativo Circulante / Passivo Circulante",
    termos: [
      { key: "ativo_circulante", label: "Ativo Circulante", tipo: "saldo", origem: "BP_ATIVO" },
      { key: "passivo_circulante", label: "Passivo Circulante", tipo: "saldo", origem: "BP_PASSIVO" },
    ],
  },
  {
    key: "ls", label: "Liquidez Seca", categoria: "Liquidez", formato: "ratio",
    formulaTexto: "(Ativo Circulante − Estoques) / Passivo Circulante",
    termos: [
      { key: "ativo_circulante", label: "Ativo Circulante", tipo: "saldo", origem: "BP_ATIVO" },
      { key: "estoques", label: "Estoques", tipo: "saldo", origem: "BP_ATIVO" },
      { key: "passivo_circulante", label: "Passivo Circulante", tipo: "saldo", origem: "BP_PASSIVO" },
    ],
  },
  {
    key: "li", label: "Liquidez Imediata", categoria: "Liquidez", formato: "ratio",
    formulaTexto: "Disponível / Passivo Circulante",
    termos: [
      { key: "disponivel", label: "Caixa e Equivalentes", tipo: "saldo", origem: "BP_ATIVO" },
      { key: "passivo_circulante", label: "Passivo Circulante", tipo: "saldo", origem: "BP_PASSIVO" },
    ],
  },
  {
    key: "lg", label: "Liquidez Geral", categoria: "Liquidez", formato: "ratio",
    formulaTexto: "(AC + RLP) / (PC + Exigível LP)",
    termos: [
      { key: "ativo_circulante", label: "Ativo Circulante", tipo: "saldo", origem: "BP_ATIVO" },
      { key: "realizavel_lp", label: "Realizável a Longo Prazo", tipo: "saldo", origem: "BP_ATIVO" },
      { key: "passivo_circulante", label: "Passivo Circulante", tipo: "saldo", origem: "BP_PASSIVO" },
      { key: "passivo_nao_circulante", label: "Passivo Não Circulante", tipo: "saldo", origem: "BP_PASSIVO" },
    ],
  },

  // ENDIVIDAMENTO
  {
    key: "endiv", label: "Endividamento Geral", categoria: "Endividamento", formato: "percent",
    formulaTexto: "(PC + Exigível LP) / Ativo Total × 100",
    termos: [
      { key: "passivo_circulante", label: "Passivo Circulante", tipo: "saldo", origem: "BP_PASSIVO" },
      { key: "passivo_nao_circulante", label: "Passivo Não Circulante", tipo: "saldo", origem: "BP_PASSIVO" },
      { key: "ativo_total", label: "Ativo Total", tipo: "saldo", origem: "BP_ATIVO" },
    ],
  },
  {
    key: "compEnd", label: "Composição do Endividamento", categoria: "Endividamento", formato: "percent",
    formulaTexto: "Passivo Circulante / (PC + Exigível LP) × 100",
    termos: [
      { key: "passivo_circulante", label: "Passivo Circulante", tipo: "saldo", origem: "BP_PASSIVO" },
      { key: "passivo_nao_circulante", label: "Passivo Não Circulante", tipo: "saldo", origem: "BP_PASSIVO" },
    ],
  },
  {
    key: "imobPL", label: "Imobilização do Patrimônio Líquido", categoria: "Endividamento", formato: "percent",
    formulaTexto: "Imobilizado / Patrimônio Líquido × 100",
    termos: [
      { key: "imobilizado", label: "Imobilizado", tipo: "saldo", origem: "BP_ATIVO" },
      { key: "patrimonio_liquido", label: "Patrimônio Líquido", tipo: "saldo", origem: "BP_PASSIVO" },
    ],
  },
  {
    key: "divEbitda", label: "Dívida Líquida / EBITDA", categoria: "Endividamento", formato: "ratio",
    formulaTexto: "(Empréstimos − Caixa) / EBITDA",
    termos: [
      { key: "emprestimos", label: "Empréstimos e Financiamentos", tipo: "saldo", origem: "BP_PASSIVO" },
      { key: "disponivel", label: "Caixa e Equivalentes", tipo: "saldo", origem: "BP_ATIVO" },
      { key: "ebit", label: "EBIT (Resultado Operacional)", tipo: "fluxo", origem: "DRE" },
      { key: "depreciacao", label: "Depreciação/Amortização", tipo: "fluxo", origem: "DRE" },
    ],
  },

  // RENTABILIDADE
  {
    key: "margBruta", label: "Margem Bruta", categoria: "Rentabilidade", formato: "percent",
    formulaTexto: "Lucro Bruto / Receita Líquida × 100",
    termos: [
      { key: "lucro_bruto", label: "Lucro Bruto", tipo: "fluxo", origem: "DRE" },
      { key: "receita_liquida", label: "Receita Líquida", tipo: "fluxo", origem: "DRE" },
    ],
  },
  {
    key: "margLiq", label: "Margem Líquida", categoria: "Rentabilidade", formato: "percent",
    formulaTexto: "Lucro Líquido / Receita Líquida × 100",
    termos: [
      { key: "lucro_liquido", label: "Lucro Líquido", tipo: "fluxo", origem: "DRE" },
      { key: "receita_liquida", label: "Receita Líquida", tipo: "fluxo", origem: "DRE" },
    ],
  },
  {
    key: "margEbitda", label: "Margem EBITDA", categoria: "Rentabilidade", formato: "percent",
    formulaTexto: "EBITDA / Receita Líquida × 100",
    termos: [
      { key: "ebit", label: "EBIT (Resultado Operacional)", tipo: "fluxo", origem: "DRE" },
      { key: "depreciacao", label: "Depreciação/Amortização", tipo: "fluxo", origem: "DRE" },
      { key: "receita_liquida", label: "Receita Líquida", tipo: "fluxo", origem: "DRE" },
    ],
  },
  {
    key: "roa", label: "ROA — Retorno sobre Ativo", categoria: "Rentabilidade", formato: "percent",
    formulaTexto: "Lucro Líquido / Ativo Total × 100",
    termos: [
      { key: "lucro_liquido", label: "Lucro Líquido", tipo: "fluxo", origem: "DRE" },
      { key: "ativo_total", label: "Ativo Total", tipo: "saldo", origem: "BP_ATIVO" },
    ],
  },
  {
    key: "roe", label: "ROE — Retorno sobre Patrimônio", categoria: "Rentabilidade", formato: "percent",
    formulaTexto: "Lucro Líquido / Patrimônio Líquido × 100",
    termos: [
      { key: "lucro_liquido", label: "Lucro Líquido", tipo: "fluxo", origem: "DRE" },
      { key: "patrimonio_liquido", label: "Patrimônio Líquido", tipo: "saldo", origem: "BP_PASSIVO" },
    ],
  },

  // ATIVIDADE
  {
    key: "giroAtivo", label: "Giro do Ativo", categoria: "Atividade", formato: "ratio",
    formulaTexto: "Receita Líquida / Ativo Total",
    termos: [
      { key: "receita_liquida", label: "Receita Líquida", tipo: "fluxo", origem: "DRE" },
      { key: "ativo_total", label: "Ativo Total", tipo: "saldo", origem: "BP_ATIVO" },
    ],
  },
  {
    key: "pmr", label: "Prazo Médio de Recebimento", categoria: "Atividade", formato: "days",
    formulaTexto: "(Contas a Receber / Receita Bruta) × 30",
    termos: [
      { key: "contas_receber", label: "Clientes / Contas a Receber", tipo: "saldo", origem: "BP_ATIVO" },
      { key: "receita_bruta", label: "Receita Bruta", tipo: "fluxo", origem: "DRE" },
    ],
  },
  {
    key: "pmp", label: "Prazo Médio de Pagamento", categoria: "Atividade", formato: "days",
    formulaTexto: "(Fornecedores / Custos) × 30",
    termos: [
      { key: "fornecedores", label: "Fornecedores", tipo: "saldo", origem: "BP_PASSIVO" },
      { key: "custos", label: "Custos", tipo: "fluxo", origem: "DRE" },
    ],
  },
  {
    key: "ciclo", label: "Ciclo Financeiro", categoria: "Atividade", formato: "days",
    formulaTexto: "PMR − PMP",
    termos: [
      { key: "contas_receber", label: "Clientes / Contas a Receber", tipo: "saldo", origem: "BP_ATIVO" },
      { key: "receita_bruta", label: "Receita Bruta", tipo: "fluxo", origem: "DRE" },
      { key: "fornecedores", label: "Fornecedores", tipo: "saldo", origem: "BP_PASSIVO" },
      { key: "custos", label: "Custos", tipo: "fluxo", origem: "DRE" },
    ],
  },
];

export function getIndicadorDef(key: string): IndicadorDef | undefined {
  return INDICADOR_DEFS.find((d) => d.key === key);
}

export type Visibilidade = "indicadores" | "dashboard" | "ambos" | "invisivel";

export interface IndicadorConfigRow {
  id: string;
  tenant_id: string;
  company_id: string;
  indicador_key: string;
  contas_por_termo: Record<string, string[]>;
  visibilidade: Visibilidade;
  ordem: number;
}

/** Considera configurado quando todos os termos têm pelo menos 1 classificação. */
export function isConfigurado(
  def: IndicadorDef,
  contas: Record<string, string[]> | null | undefined,
): boolean {
  if (!contas) return false;
  return def.termos.every((t) => Array.isArray(contas[t.key]) && contas[t.key].length > 0);
}
