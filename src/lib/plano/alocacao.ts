// Alocação de contas -> linhas de demonstração.
//
// A partir do ajuste 01, a fonte da verdade é o PLANO DE CONTAS:
// cada conta carrega tipo_demonstracao + linha_demonstracao. Uma
// conta sintética alocada cascateia para as descendentes, e qualquer
// descendente pode sobrescrever (a alocação mais específica vence).
//
// A tabela mapeamento_demonstracao deixa de ser lida pelo motor.

export type TipoDemonstracao = "DRE" | "BP_ATIVO" | "BP_PASSIVO";

/** Como a variação da conta entra na DFC (método indireto). Só analíticas. */
export type DfcAtividade = "caixa" | "operacional" | "investimento" | "financiamento";

export interface AlocacaoConta {
  codigo: string;
  classificacao: string;
  descricao: string;
  tipo: string;
  is_sintetica: boolean;
  tipo_demonstracao: TipoDemonstracao | null;
  linha_demonstracao: string | null;
  ordem_linha: number | null;
  inverter_sinal: boolean;
  tipo_custo: "fixo" | "variavel" | null;
  dfc_atividade: DfcAtividade | null;
  dfc_nao_caixa: boolean;
}

/** Uma linha do catálogo canônico de demonstrações. */
export interface LinhaCatalogo {
  linha: string;
  ordem: number;
  /** true = movimento credor deve aparecer positivo (receita, passivo, PL) */
  inverter: boolean;
  /** linha calculada pelo motor (subtotal) — não é alocável */
  calculada?: boolean;
}

// ---------------------------------------------------------------
// Catálogo canônico
// ---------------------------------------------------------------
// Estes são exatamente os rótulos que addDRECalculatedTotals() e o
// motor de BP já esperam. Mantê-los idênticos é o que faz os
// subtotais (Lucro Bruto, EBIT, Lucro Líquido) continuarem batendo.

export const LINHAS_DRE: LinhaCatalogo[] = [
  { linha: "Receita Bruta", ordem: 100, inverter: true },
  { linha: "(-) Deduções da Receita Bruta", ordem: 110, inverter: false },
  { linha: "(=) Receita Líquida", ordem: 150, inverter: true, calculada: true },
  { linha: "(-) Custos Industriais", ordem: 200, inverter: false },
  { linha: "(-) Custos Comerciais", ordem: 210, inverter: false },
  { linha: "(-) Custos Imobiliários", ordem: 220, inverter: false },
  { linha: "(-) Custos dos Serviços", ordem: 230, inverter: false },
  { linha: "(-) Custos", ordem: 240, inverter: false },
  { linha: "(=) Lucro Bruto", ordem: 290, inverter: true, calculada: true },
  { linha: "(-) Despesas Operacionais", ordem: 300, inverter: false },
  { linha: "(-) Despesas Administrativas", ordem: 310, inverter: false },
  { linha: "(-) Despesas Comerciais", ordem: 320, inverter: false },
  { linha: "(-) Despesas Tributárias", ordem: 330, inverter: false },
  { linha: "(+) Outras Receitas Operacionais", ordem: 400, inverter: true },
  { linha: "(-) Outras Despesas Operacionais", ordem: 410, inverter: false },
  { linha: "(+) Ganhos de Capital", ordem: 450, inverter: true },
  { linha: "(-) Perdas de Capital", ordem: 460, inverter: false },
  { linha: "(=) Resultado Operacional (EBIT)", ordem: 490, inverter: true, calculada: true },
  { linha: "(+) Receitas Financeiras", ordem: 500, inverter: true },
  { linha: "(-) Despesas Financeiras", ordem: 510, inverter: false },
  { linha: "(=) Resultado Antes do IR/CSLL", ordem: 590, inverter: true, calculada: true },
  { linha: "(-) IRPJ", ordem: 600, inverter: false },
  { linha: "(-) CSLL", ordem: 610, inverter: false },
  { linha: "(=) Lucro Líquido do Exercício", ordem: 690, inverter: true, calculada: true },
  { linha: "(-) Distribuição de Lucros", ordem: 700, inverter: false },
];

export const LINHAS_BP_ATIVO: LinhaCatalogo[] = [
  { linha: "Ativo Circulante", ordem: 100, inverter: false },
  { linha: "Ativo Não Circulante", ordem: 200, inverter: false },
  { linha: "Realizável a Longo Prazo", ordem: 205, inverter: false },
  { linha: "Imobilizado", ordem: 210, inverter: false },
  { linha: "Investimentos", ordem: 215, inverter: false },
  { linha: "Intangível", ordem: 220, inverter: false },
];

export const LINHAS_BP_PASSIVO: LinhaCatalogo[] = [
  { linha: "Passivo Circulante", ordem: 100, inverter: true },
  { linha: "Passivo Não Circulante", ordem: 200, inverter: true },
  { linha: "Patrimônio Líquido", ordem: 300, inverter: true },
  { linha: "Capital Social", ordem: 310, inverter: true },
  { linha: "Reservas", ordem: 320, inverter: true },
  { linha: "Lucros/Prejuízos Acumulados", ordem: 330, inverter: true },
];

export function catalogoDe(tipo: TipoDemonstracao): LinhaCatalogo[] {
  if (tipo === "DRE") return LINHAS_DRE;
  if (tipo === "BP_ATIVO") return LINHAS_BP_ATIVO;
  return LINHAS_BP_PASSIVO;
}

/** Só as linhas em que uma conta pode ser alocada (exclui subtotais calculados). */
export function linhasAlocaveis(tipo: TipoDemonstracao): LinhaCatalogo[] {
  return catalogoDe(tipo).filter((l) => !l.calculada);
}

export function buscarLinha(
  tipo: TipoDemonstracao,
  linha: string,
): LinhaCatalogo | undefined {
  return catalogoDe(tipo).find((l) => l.linha === linha);
}

/** Demonstração natural de uma conta, a partir do tipo do plano contábil. */
export function tipoDemonstracaoDoTipoConta(tipo: string): TipoDemonstracao | null {
  if (tipo === "3-DRE") return "DRE";
  if (tipo === "1-Ativo" || tipo === "4-Cli. Nac." || tipo === "6-Cli. Ex.") return "BP_ATIVO";
  if (tipo === "2-Passivo" || tipo === "5-For. Nac." || tipo === "7-For. Ex.") return "BP_PASSIVO";
  return null;
}

// ---------------------------------------------------------------
// Resolução da herança (mesma semântica do SQL em plano_pendencias)
// ---------------------------------------------------------------

/** Alocação efetiva de uma conta: a dela, ou a do ancestral mais próximo. */
export function resolverAlocacao(
  conta: Pick<AlocacaoConta, "classificacao">,
  alocadas: AlocacaoConta[],
  separador = ".",
): AlocacaoConta | null {
  let melhor: AlocacaoConta | null = null;
  for (const a of alocadas) {
    if (!a.linha_demonstracao) continue;
    const ehAncestral =
      conta.classificacao === a.classificacao ||
      conta.classificacao.startsWith(a.classificacao + separador);
    if (!ehAncestral) continue;
    // mais específico (classificação mais longa) vence
    if (!melhor || a.classificacao.length > melhor.classificacao.length) {
      melhor = a;
    }
  }
  return melhor;
}

/** Índice pré-computado — evita O(n²) quando o plano tem milhares de contas. */
export function criarResolvedor(alocadas: AlocacaoConta[], separador = ".") {
  const comAlocacao = alocadas
    .filter((a) => !!a.linha_demonstracao)
    .sort((a, b) => b.classificacao.length - a.classificacao.length);
  return (classificacao: string): AlocacaoConta | null => {
    for (const a of comAlocacao) {
      if (
        classificacao === a.classificacao ||
        classificacao.startsWith(a.classificacao + separador)
      ) {
        return a;
      }
    }
    return null;
  };
}

// ---------------------------------------------------------------
// DFC
// ---------------------------------------------------------------

export const ROTULOS_DFC: Record<DfcAtividade, string> = {
  caixa: "Caixa e equivalentes",
  operacional: "Operacional (capital de giro)",
  investimento: "Investimento",
  financiamento: "Financiamento",
};

/**
 * Uma conta ANALÍTICA de Ativo/Passivo precisa declarar como movimenta
 * a DFC. Sem isso, a variação dela some do fluxo de caixa e a identidade
 * "variação de caixa = operacional + investimento + financiamento" não fecha.
 * Contas marcadas como não-caixa (contrapartida de depreciação, provisão)
 * estão conscientemente fora dos blocos e não são pendência.
 */
export function precisaFlagDfc(conta: AlocacaoConta): boolean {
  if (conta.is_sintetica) return false;
  if (conta.dfc_nao_caixa) return false;
  if (conta.dfc_atividade) return false;
  const t = tipoDemonstracaoDoTipoConta(conta.tipo);
  return t === "BP_ATIVO" || t === "BP_PASSIVO";
}
