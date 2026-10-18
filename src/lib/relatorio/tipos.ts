// Relatório Executivo: catálogo de seções, modelo padrão e formato do conteúdo.

export type SecaoId =
  | "capa" | "sumario" | "escritorio" | "empresa" | "resumo" | "dre" | "bp"
  | "custos" | "dfc" | "caixa" | "patrimonio" | "indicadores" | "faturamento" | "notas" | "conclusoes" | "glossario";

export interface SecaoDef { id: SecaoId; titulo: string; temTexto: boolean }

export const SECOES: SecaoDef[] = [
  { id: "capa", titulo: "Capa", temTexto: false },
  { id: "sumario", titulo: "Sumário", temTexto: false },
  { id: "escritorio", titulo: "Escritório responsável", temTexto: true },
  { id: "empresa", titulo: "Perfil da empresa", temTexto: true },
  { id: "resumo", titulo: "Resumo do mês", temTexto: true },
  { id: "bp", titulo: "Balanço Patrimonial", temTexto: true },
  { id: "dre", titulo: "Demonstração do Resultado (DRE)", temTexto: true },
  { id: "custos", titulo: "Composição dos custos e despesas", temTexto: true },
  { id: "dfc", titulo: "Demonstração dos Fluxos de Caixa (DFC)", temTexto: true },
  { id: "caixa", titulo: "Conciliação e leitura do caixa", temTexto: true },
  { id: "patrimonio", titulo: "Evolução do patrimônio líquido", temTexto: true },
  { id: "indicadores", titulo: "Indicadores e fórmulas", temTexto: true },
  { id: "faturamento", titulo: "Faturamento dos últimos 12 meses", temTexto: true },
  { id: "notas", titulo: "Notas explicativas", temTexto: true },
  { id: "conclusoes", titulo: "Conclusões e recomendações", temTexto: true },
  { id: "glossario", titulo: "Glossário", temTexto: true },
];

export interface SecaoCfg { id: SecaoId; visivel: boolean }

export const GLOSSARIO_PADRAO = [
  "DRE — Demonstração do Resultado do Exercício: receitas, custos e despesas do período e o lucro ou prejuízo apurado.",
  "BP — Balanço Patrimonial: bens e direitos (Ativo), obrigações (Passivo) e capital próprio (Patrimônio Líquido) na data-base.",
  "DFC — Demonstração dos Fluxos de Caixa: origem e aplicação do caixa nas atividades operacionais, de investimento e de financiamento.",
  "PL — Patrimônio Líquido: recursos próprios dos sócios investidos e acumulados na empresa.",
  "RB / RL — Receita Bruta / Receita Líquida (receita bruta menos deduções e impostos sobre vendas).",
  "EBITDA — Lucro antes de juros, impostos, depreciação e amortização; medida de desempenho, não saldo de caixa.",
  "Liquidez Corrente — Ativo Circulante dividido pelo Passivo Circulante; capacidade de pagar obrigações de curto prazo.",
  "ROE / ROA — Retorno sobre o Patrimônio Líquido / sobre o Ativo Total.",
  "AV / AH — Análise Vertical (participação na receita) / Análise Horizontal (variação entre períodos).",
].join("\n");

export interface ModeloRelatorio {
  secoes: SecaoCfg[];
  textos: Partial<Record<SecaoId, string>>;
}

export const MODELO_PADRAO: ModeloRelatorio = {
  secoes: SECOES.map((s) => ({ id: s.id, visivel: true })),
  textos: {
    glossario: GLOSSARIO_PADRAO,
    conclusoes: "",
  },
};

export interface LinhaDemo { descricao: string; nivel: number; subtotal: boolean; valores: Record<string, number> }
export interface IndiceRel { key: string; label: string; formula: string; formato: string; atual: number | null; anterior: number | null }

export interface DadosRelatorio {
  periodo: string;
  anterior: string | null;
  dre: LinhaDemo[];
  acumulado?: { periodos: string[]; dre: LinhaDemo[] };
  bpAtivo: LinhaDemo[];
  bpPassivo: LinhaDemo[];
  dfc: LinhaDemo[];
  indices: IndiceRel[];
  faturamento: { periodo: string; valor: number | null; liquida?: number | null }[];
}

export interface ConteudoRelatorio {
  secoes: SecaoCfg[];
  textos: Partial<Record<SecaoId, string>>;
  imagens: { logoEscritorio?: string | null; logoEmpresa?: string | null; fotoEmpresa?: string | null };
  escritorio: { nome: string };
  empresa: { nome: string; razao?: string | null; cnpj?: string | null; cidade?: string | null; regime?: string | null };
  dados: DadosRelatorio;
  /** Paleta visual do PDF conforme o escritório. Ausente = padrão Orkestria. */
  tema?: "padrao" | "beltrami";
}

export function normalizarSecoes(cfg: SecaoCfg[] | null | undefined): SecaoCfg[] {
  const m = new Map((cfg ?? []).map((s) => [s.id, s]));
  const ordem = (cfg ?? []).map((s) => s.id).filter((id) => SECOES.some((d) => d.id === id));
  for (let i = 0; i < SECOES.length; i++) {
    const d = SECOES[i];
    if (ordem.includes(d.id)) continue;
    const anterior = SECOES[i - 1]?.id;
    const pos = anterior ? ordem.indexOf(anterior) : -1;
    ordem.splice(pos + 1, 0, d.id);
  }
  return ordem.map((id) => m.get(id) ?? { id, visivel: true });
}

export const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
export function mesExtenso(p: string) { return `${MESES[Number(p.slice(5, 7)) - 1]}/${p.slice(0, 4)}`; }
export function mesCurto(p: string) { return `${MESES[Number(p.slice(5, 7)) - 1].slice(0, 3)}/${p.slice(2, 4)}`; }
