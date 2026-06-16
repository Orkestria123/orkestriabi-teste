// Motor de Capital de Giro / Ciclo Financeiro.
// Lê linhas do BP (BP_ATIVO + BP_PASSIVO) por keyword na descrição
// e devolve os indicadores operacionais clássicos:
//   - Contas a Receber (CR), Estoque (E), Fornecedores (F)
//   - PMR  = (CR / Receita) * 30  (em dias, base mensal)
//   - PME  = (E  / CMV)     * 30
//   - PMP  = (F  / Compras) * 30   (proxy: usamos CMV se compras não disponível)
//   - Ciclo Operacional = PMR + PME
//   - Ciclo Financeiro  = PMR + PME - PMP
//   - NCG (necessidade de capital de giro) = (CR + E) - F
//   - CDG (capital de giro) = PL + Passivo Não Circulante - Ativo Não Circulante (simplificado)
//   - Saldo de Tesouraria T = CDG - NCG
//
// O cálculo usa o ÚLTIMO período do recorte e a receita/CMV agregada do recorte.

export interface BpLinha {
  descricao: string;
  valor: number;
  is_subtotal?: boolean;
}

export interface DreLinha {
  descricao: string;
  valor: number;
}

interface MatchOpts {
  rows: BpLinha[];
  include: RegExp[];
  exclude?: RegExp[];
}

function somar({ rows, include, exclude }: MatchOpts): number {
  const matched = rows.filter((r) => {
    const d = (r.descricao ?? "").toLowerCase();
    if (exclude && exclude.some((rx) => rx.test(d))) return false;
    return include.some((rx) => rx.test(d));
  });
  if (matched.length === 0) return 0;
  // Preferir não-subtotais; se só houver subtotal, usa o de maior |valor|.
  const detalhe = matched.filter((r) => !r.is_subtotal);
  const pool = detalhe.length > 0 ? detalhe : matched;
  return pool.reduce((s, r) => s + (Number(r.valor) || 0), 0);
}

export interface CapitalGiroInput {
  bpAtivo: BpLinha[];
  bpPassivo: BpLinha[];
  dre: DreLinha[];
  mesesNoRecorte: number; // p/ converter receita/CMV para média mensal
}

export interface CapitalGiroResultado {
  contasAReceber: number;
  estoque: number;
  fornecedores: number;
  receitaMensal: number;
  cmvMensal: number;
  pmr: number | null;
  pme: number | null;
  pmp: number | null;
  cicloOperacional: number | null;
  cicloFinanceiro: number | null;
  ncg: number;
  ativoCirculante: number;
  passivoCirculante: number;
  capitalGiroLiquido: number; // AC - PC
  saldoTesouraria: number; // CGL - NCG
  diasCaixa: number | null; // disponível / despesa-dia
  disponivel: number;
  despesaMensal: number;
}

const KW = {
  contasAReceber: [/clientes/i, /duplicat/i, /contas? a receber/i],
  estoque: [/estoq/i, /mercador/i, /produtos? acabad/i, /matér/i],
  fornecedores: [/fornec/i],
  disponivel: [/caixa/i, /banco/i, /aplica/i, /equival/i, /disponi/i],
  ativoCirculante: [/^ativo circulante$/i, /ativo circulante/i],
  passivoCirculante: [/^passivo circulante$/i, /passivo circulante/i],
  receitaLiquida: [/receita líquida/i, /receita liquida/i],
  receitaBruta: [/receita bruta/i, /receita operacional bruta/i],
  cmv: [/custo dos produtos/i, /custo dos servi/i, /^cmv$/i, /custo das mercadorias/i],
  despesasOperacionais: [/despesas operacionais/i, /despesas administrativas/i, /despesas com vendas/i],
};

export function calcularCapitalGiro(input: CapitalGiroInput): CapitalGiroResultado {
  const { bpAtivo, bpPassivo, dre, mesesNoRecorte } = input;
  const meses = Math.max(1, mesesNoRecorte);

  const contasAReceber = Math.abs(somar({ rows: bpAtivo, include: KW.contasAReceber }));
  const estoque = Math.abs(somar({ rows: bpAtivo, include: KW.estoque }));
  const fornecedores = Math.abs(somar({ rows: bpPassivo, include: KW.fornecedores }));
  const disponivel = Math.abs(somar({ rows: bpAtivo, include: KW.disponivel, exclude: [/aluguel/i, /folha/i] }));

  // AC e PC: priorizar subtotal exato
  const ac = pegarSubtotal(bpAtivo, KW.ativoCirculante);
  const pc = pegarSubtotal(bpPassivo, KW.passivoCirculante);

  const receitaLiq = Math.abs(somar({ rows: dre, include: KW.receitaLiquida }));
  const receitaBr = Math.abs(somar({ rows: dre, include: KW.receitaBruta }));
  const receita = receitaLiq || receitaBr;
  const cmv = Math.abs(somar({ rows: dre, include: KW.cmv }));
  const despesas = Math.abs(somar({ rows: dre, include: KW.despesasOperacionais }));

  const receitaMensal = receita / meses;
  const cmvMensal = cmv / meses;
  const despesaMensal = (cmv + despesas) / meses;

  const pmr = receitaMensal > 0 ? (contasAReceber / receitaMensal) * 30 : null;
  const pme = cmvMensal > 0 ? (estoque / cmvMensal) * 30 : null;
  const pmp = cmvMensal > 0 ? (fornecedores / cmvMensal) * 30 : null;
  const cicloOperacional = pmr != null && pme != null ? pmr + pme : null;
  const cicloFinanceiro = pmr != null && pme != null && pmp != null ? pmr + pme - pmp : null;

  const ncg = contasAReceber + estoque - fornecedores;
  const capitalGiroLiquido = ac - pc;
  const saldoTesouraria = capitalGiroLiquido - ncg;
  const diasCaixa = despesaMensal > 0 ? (disponivel / despesaMensal) * 30 : null;

  return {
    contasAReceber, estoque, fornecedores,
    receitaMensal, cmvMensal,
    pmr, pme, pmp,
    cicloOperacional, cicloFinanceiro,
    ncg,
    ativoCirculante: ac, passivoCirculante: pc,
    capitalGiroLiquido, saldoTesouraria,
    disponivel, despesaMensal, diasCaixa,
  };
}

function pegarSubtotal(rows: BpLinha[], rx: RegExp[]): number {
  const matched = rows.filter((r) => rx.some((re) => re.test(r.descricao ?? "")));
  if (matched.length === 0) return 0;
  const subt = matched.filter((r) => r.is_subtotal);
  if (subt.length > 0) {
    return Math.abs(subt.reduce((b, r) => (Math.abs(r.valor) > Math.abs(b) ? r.valor : b), subt[0].valor));
  }
  return Math.abs(matched.reduce((s, r) => s + (Number(r.valor) || 0), 0));
}
