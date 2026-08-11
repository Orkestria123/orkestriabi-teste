// Estrutura fixa da DFC conforme CPC 03.
// O contador NÃO cria linhas — apenas vincula contas e escolhe a operação.

export type DfcMetodo = "direto" | "indireto" | "ambos";
export type DfcOperacao = "soma" | "subtrai" | "variacao";

export interface DfcLinhaDef {
  /** identificador estável, gravado em dfc_linha_contas.linha */
  key: string;
  label: string;
  /** a qual método a linha pertence */
  metodo: DfcMetodo;
  bloco: "operacional" | "investimento" | "financiamento" | "fechamento";
  ordem: number;
  /** operação padrão sugerida */
  operacaoPadrao: DfcOperacao;
  /** linha calculada (subtotal) — não recebe contas */
  calculada?: boolean;
  /** valor vem da DRE, não de contas */
  origemDRE?: boolean;
  descricao?: string;
  /** regex (em texto normalizado, sem acento) para pré-sugestão de contas */
  sugestao?: RegExp;
  /** prefixos de classificação onde procurar a sugestão */
  sugestaoPrefixos?: string[];
}

export const DFC_LINHAS: DfcLinhaDef[] = [
  // ---------------- BLOCO 1 — OPERACIONAL (INDIRETO) ----------------
  {
    key: "op_ind_lucro_liquido",
    label: "Lucro Líquido do Exercício",
    metodo: "indireto",
    bloco: "operacional",
    ordem: 10,
    operacaoPadrao: "soma",
    origemDRE: true,
    descricao: "Vem automaticamente da DRE — não precisa vincular contas.",
  },
  {
    key: "op_ind_depreciacao",
    label: "(+) Depreciação e Amortização",
    metodo: "indireto",
    bloco: "operacional",
    ordem: 20,
    operacaoPadrao: "soma",
    sugestao: /deprecia|amortiza|exaust/,
    sugestaoPrefixos: ["3", "4"],
  },
  {
    key: "op_ind_contas_receber",
    label: "(+/-) Variação de Contas a Receber",
    metodo: "indireto",
    bloco: "operacional",
    ordem: 30,
    operacaoPadrao: "variacao",
    sugestao: /clientes|contas a receber|duplicatas a receber/,
    sugestaoPrefixos: ["1"],
  },
  {
    key: "op_ind_estoques",
    label: "(+/-) Variação de Estoques",
    metodo: "indireto",
    bloco: "operacional",
    ordem: 40,
    operacaoPadrao: "variacao",
    sugestao: /estoque|mercadoria|almoxarifado/,
    sugestaoPrefixos: ["1"],
  },
  {
    key: "op_ind_fornecedores",
    label: "(+/-) Variação de Fornecedores",
    metodo: "indireto",
    bloco: "operacional",
    ordem: 50,
    operacaoPadrao: "variacao",
    sugestao: /fornecedor/,
    sugestaoPrefixos: ["2"],
  },
  {
    key: "op_ind_outras",
    label: "(+/-) Variação de Outras Contas Operacionais",
    metodo: "indireto",
    bloco: "operacional",
    ordem: 60,
    operacaoPadrao: "variacao",
  },
  {
    key: "op_ind_total",
    label: "(=) Caixa das Atividades Operacionais",
    metodo: "indireto",
    bloco: "operacional",
    ordem: 99,
    operacaoPadrao: "soma",
    calculada: true,
  },

  // ---------------- BLOCO 1 — OPERACIONAL (DIRETO) ----------------
  {
    key: "op_dir_recebimentos_clientes",
    label: "Recebimentos de Clientes",
    metodo: "direto",
    bloco: "operacional",
    ordem: 10,
    operacaoPadrao: "soma",
    sugestao: /clientes|receita de venda|recebiment/,
    sugestaoPrefixos: ["1", "3"],
  },
  {
    key: "op_dir_pag_fornecedores",
    label: "(-) Pagamentos a Fornecedores",
    metodo: "direto",
    bloco: "operacional",
    ordem: 20,
    operacaoPadrao: "subtrai",
    sugestao: /fornecedor/,
    sugestaoPrefixos: ["2", "4"],
  },
  {
    key: "op_dir_pag_salarios",
    label: "(-) Pagamentos de Salários e Encargos",
    metodo: "direto",
    bloco: "operacional",
    ordem: 30,
    operacaoPadrao: "subtrai",
    sugestao: /salario|folha|encargo|fgts|inss|ferias|13|pessoal/,
    sugestaoPrefixos: ["2", "4"],
  },
  {
    key: "op_dir_pag_impostos",
    label: "(-) Pagamentos de Impostos",
    metodo: "direto",
    bloco: "operacional",
    ordem: 40,
    operacaoPadrao: "subtrai",
    sugestao: /imposto|tributo|icms|pis|cofins|irpj|csll|iss|simples/,
    sugestaoPrefixos: ["2", "3", "4"],
  },
  {
    key: "op_dir_outros_pagamentos",
    label: "(-) Outros Pagamentos Operacionais",
    metodo: "direto",
    bloco: "operacional",
    ordem: 50,
    operacaoPadrao: "subtrai",
  },
  {
    key: "op_dir_total",
    label: "(=) Caixa das Atividades Operacionais",
    metodo: "direto",
    bloco: "operacional",
    ordem: 99,
    operacaoPadrao: "soma",
    calculada: true,
  },

  // ---------------- BLOCO 2 — INVESTIMENTO ----------------
  {
    key: "inv_imobilizado",
    label: "(+/-) Aquisição/Venda de Imobilizado",
    metodo: "ambos",
    bloco: "investimento",
    ordem: 10,
    operacaoPadrao: "variacao",
    sugestao: /imobilizado|maquina|veiculo|movei|equipamento|edificac|terreno|intangivel/,
    sugestaoPrefixos: ["1"],
  },
  {
    key: "inv_investimentos",
    label: "(+/-) Aquisição/Venda de Investimentos",
    metodo: "ambos",
    bloco: "investimento",
    ordem: 20,
    operacaoPadrao: "variacao",
    sugestao: /investiment|participac|aplicac/,
    sugestaoPrefixos: ["1"],
  },
  {
    key: "inv_total",
    label: "(=) Caixa das Atividades de Investimento",
    metodo: "ambos",
    bloco: "investimento",
    ordem: 99,
    operacaoPadrao: "soma",
    calculada: true,
  },

  // ---------------- BLOCO 3 — FINANCIAMENTO ----------------
  {
    key: "fin_emprestimos",
    label: "(+/-) Variação de Empréstimos",
    metodo: "ambos",
    bloco: "financiamento",
    ordem: 10,
    operacaoPadrao: "variacao",
    sugestao: /emprestim|financiament|banco.*conta.*vinc|debentur|arrendament/,
    sugestaoPrefixos: ["2"],
  },
  {
    key: "fin_capital",
    label: "(+/-) Variação de Capital",
    metodo: "ambos",
    bloco: "financiamento",
    ordem: 20,
    operacaoPadrao: "variacao",
    sugestao: /capital social|capital a integralizar|reserva de capital/,
    sugestaoPrefixos: ["2"],
  },
  {
    key: "fin_dividendos",
    label: "(+/-) Distribuição de Dividendos/Lucros",
    metodo: "ambos",
    bloco: "financiamento",
    ordem: 30,
    operacaoPadrao: "variacao",
    sugestao: /dividendo|lucros a distribuir|lucros distribu|juros sobre capital/,
    sugestaoPrefixos: ["2"],
  },
  {
    key: "fin_total",
    label: "(=) Caixa das Atividades de Financiamento",
    metodo: "ambos",
    bloco: "financiamento",
    ordem: 99,
    operacaoPadrao: "soma",
    calculada: true,
  },

  // ---------------- FECHAMENTO ----------------
  {
    key: "fech_variacao_caixa",
    label: "(=) Variação Líquida de Caixa",
    metodo: "ambos",
    bloco: "fechamento",
    ordem: 10,
    operacaoPadrao: "soma",
    calculada: true,
    descricao: "Soma dos três blocos.",
  },
  {
    key: "fech_caixa_inicial",
    label: "Caixa no Início do Período",
    metodo: "ambos",
    bloco: "fechamento",
    ordem: 20,
    operacaoPadrao: "soma",
    calculada: true,
    descricao: "Saldo inicial das contas de Caixa/Disponível definidas acima.",
  },
  {
    key: "fech_caixa_final",
    label: "Caixa no Final do Período",
    metodo: "ambos",
    bloco: "fechamento",
    ordem: 30,
    operacaoPadrao: "soma",
    calculada: true,
    descricao: "Saldo final das contas de Caixa/Disponível — deve bater com o Disponível do Balanço.",
  },
];

export const BLOCO_LABEL: Record<string, string> = {
  operacional: "Bloco 1 — Atividades Operacionais",
  investimento: "Bloco 2 — Atividades de Investimento",
  financiamento: "Bloco 3 — Atividades de Financiamento",
  fechamento: "Fechamento",
};

export const OPERACAO_OPCOES: { value: DfcOperacao; label: string; hint: string }[] = [
  { value: "soma", label: "Soma", hint: "Soma o movimento das contas no período." },
  { value: "subtrai", label: "Subtrai", hint: "Subtrai o movimento das contas no período." },
  { value: "variacao", label: "Variação", hint: "Usa a variação de saldo (final − inicial) das contas." },
];

/** Regex de sugestão para as contas de Caixa/Disponível. */
export const CAIXA_SUGESTAO = /caixa|banco|disponivel|aplicacoes? de liquidez|numerario/;

export function normalizeText(s: string): string {
  return (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export interface PlanoItemLike {
  classificacao: string;
  descricao: string;
  is_sintetica?: boolean | null;
}

/** Sugere classificações "raiz" que batem com o regex dentro dos prefixos dados. */
export function sugerirContas(
  plano: PlanoItemLike[],
  rx: RegExp | undefined,
  prefixos?: string[],
): string[] {
  if (!rx) return [];
  const candidatos = plano.filter((p) => {
    if (prefixos && prefixos.length > 0) {
      if (!prefixos.some((pre) => String(p.classificacao ?? "").startsWith(pre))) return false;
    }
    return rx.test(normalizeText(p.descricao));
  });
  if (candidatos.length === 0) return [];
  const sinteticas = candidatos.filter((p) => p.is_sintetica);
  const base = sinteticas.length > 0 ? sinteticas : candidatos;
  const sorted = base
    .map((p) => p.classificacao)
    .sort((a, b) => a.split(".").length - b.split(".").length);
  const roots: string[] = [];
  for (const c of sorted) {
    if (roots.some((r) => c === r || c.startsWith(r + "."))) continue;
    roots.push(c);
  }
  return roots.slice(0, 12);
}
