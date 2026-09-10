/** Os 13 índices da visão geral — fórmulas estáveis, valores da DRE/BP. */

export type FormatoIndice = "ratio" | "percent" | "money_mil";

export interface BasesIndice {
  ac: number;
  pc: number;
  estoques: number;
  disponivel: number;
  emprestimos: number;
  pl: number;
  lucroBruto: number;
  ebitda: number;
  lucroLiquido: number;
  receitaLiquida: number;
}

export interface DefIndice {
  key: string;
  label: string;
  formato: FormatoIndice;
  formula: string;
  compute: (b: BasesIndice) => number | null;
}

function div(a: number, b: number): number | null {
  if (!isFinite(a) || !isFinite(b) || Math.abs(b) < 0.005) return null;
  const v = a / b;
  return isFinite(v) ? v : null;
}

export const INDICES_DASHBOARD: DefIndice[] = [
  {
    key: "resultado",
    label: "Resultado do Exercício (R$ mil)",
    formato: "money_mil",
    formula: "Lucro (ou prejuízo) líquido do período",
    compute: (b) => b.lucroLiquido,
  },
  {
    key: "lc",
    label: "Liquidez Corrente",
    formato: "ratio",
    formula: "Ativo Circulante / Passivo Circulante",
    compute: (b) => div(b.ac, b.pc),
  },
  {
    key: "ls",
    label: "Liquidez Seca",
    formato: "ratio",
    formula: "(Ativo Circulante − Estoques) / Passivo Circulante",
    compute: (b) => div(b.ac - b.estoques, b.pc),
  },
  {
    key: "li",
    label: "Liquidez Imediata",
    formato: "ratio",
    formula: "Disponível / Passivo Circulante",
    compute: (b) => div(b.disponivel, b.pc),
  },
  {
    key: "cgl",
    label: "Capital de Giro Líquido (R$ mil)",
    formato: "money_mil",
    formula: "Ativo Circulante − Passivo Circulante",
    compute: (b) => b.ac - b.pc,
  },
  {
    key: "caixa",
    label: "Caixa + Aplicações (R$ mil)",
    formato: "money_mil",
    formula: "Disponível (caixa, bancos e equivalentes)",
    compute: (b) => b.disponivel,
  },
  {
    key: "divBruta",
    label: "Dívida Bruta (R$ mil)",
    formato: "money_mil",
    formula: "Empréstimos e financiamentos",
    compute: (b) => b.emprestimos,
  },
  {
    key: "divLiq",
    label: "Dívida Líquida (R$ mil)",
    formato: "money_mil",
    formula: "Empréstimos − Disponível",
    compute: (b) => b.emprestimos - b.disponivel,
  },
  {
    key: "caixaDiv",
    label: "Caixa Líquido / Dívida Líquida",
    formato: "ratio",
    formula: "Disponível / (Empréstimos − Disponível)",
    compute: (b) => div(b.disponivel, b.emprestimos - b.disponivel),
  },
  {
    key: "cobCaixa",
    label: "Cobertura Caixa / Passivo Circ.",
    formato: "ratio",
    formula: "Disponível / Passivo Circulante",
    compute: (b) => div(b.disponivel, b.pc),
  },
  {
    key: "margBruta",
    label: "Margem Bruta",
    formato: "percent",
    formula: "Lucro Bruto / Receita Líquida × 100",
    compute: (b) => {
      const d = div(b.lucroBruto, b.receitaLiquida);
      return d == null ? null : d * 100;
    },
  },
  {
    key: "margEbitda",
    label: "Margem EBITDA",
    formato: "percent",
    formula: "EBITDA / Receita Líquida × 100",
    compute: (b) => {
      const d = div(b.ebitda, b.receitaLiquida);
      return d == null ? null : d * 100;
    },
  },
  {
    key: "margLiq",
    label: "Margem Líquida",
    formato: "percent",
    formula: "Lucro Líquido / Receita Líquida × 100",
    compute: (b) => {
      const d = div(b.lucroLiquido, b.receitaLiquida);
      return d == null ? null : d * 100;
    },
  },
  {
    key: "endivPL",
    label: "Endividamento (Dív. Bruta / PL)",
    formato: "percent",
    formula: "Empréstimos / Patrimônio Líquido × 100",
    compute: (b) => {
      const d = div(b.emprestimos, b.pl);
      return d == null ? null : d * 100;
    },
  },
];

export function formatarIndice(valor: number | null, formato: FormatoIndice): string {
  if (valor == null || !isFinite(valor)) return "—";
  if (formato === "percent") {
    return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }
  if (formato === "money_mil") {
    const mil = valor / 1000;
    const abs = Math.abs(mil).toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return mil < 0 ? `(${abs})` : abs;
  }
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const MESES_CURTOS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
] as const;

export function rotuloMes(periodo: string, multiAno: boolean): string {
  const parts = periodo.split("-");
  const mes = parseInt(parts[1] ?? "0", 10);
  const nome = MESES_CURTOS[mes - 1] ?? periodo;
  if (!multiAno) return nome;
  const ano = (parts[0] ?? "").slice(2);
  return `${nome}/${ano}`;
}

export function blocoIndice(key: string): string {
  return `indice_${key}`;
}

export function chaveIndiceDoBloco(bloco: string): string | null {
  return bloco.startsWith("indice_") ? bloco.slice("indice_".length) : null;
}
