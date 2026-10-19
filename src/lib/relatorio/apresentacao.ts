import type { DadosRelatorio, IndiceRel, LinhaDemo } from "./tipos";

const nome = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function componenteFabricacao(linha: LinhaDemo): boolean {
  const n = nome(linha.descricao);
  return /^gastos\b/.test(n) && /\bfab(?:ricacao)?\b/.test(n) && (/\bmao(?: de)? obra\b/.test(n) || /\bgerais\b/.test(n));
}

export function linhasDreRelatorio(linhas: LinhaDemo[]): LinhaDemo[] {
  const selecionadas = linhas.filter(l => l.subtotal || l.nivel === 0 || componenteFabricacao(l));
  const material = selecionadas.findIndex(l => /custo de materiais/i.test(l.descricao));
  const cpv = selecionadas.findIndex(l => /custo dos produtos vendidos|custo das mercadorias vendidas/i.test(l.descricao));
  if (material > cpv + 1 && cpv >= 0) {
    const [linha] = selecionadas.splice(material, 1);
    if (linha) selecionadas.splice(cpv + 1, 0, linha);
  }
  return selecionadas;
}

export function linhasBpRelatorio(linhas: LinhaDemo[]): LinhaDemo[] {
  const detalhes = /^(clientes|adiantamentos? diversos|tributos a recuperar|adiantamentos? (?:de |a )?funcionarios|creditos diversos)$/;
  return linhas.filter(l => {
    const n = nome(l.descricao);
    const grupo = l.nivel <= 3 && !/^(ativo|passivo|passivo e patrimonio liquido|creditos)$/.test(n);
    return (grupo || l.nivel === 4 && detalhes.test(n)) && (l.subtotal || Object.values(l.valores).some(v => Math.abs(v) > 0.005));
  });
}

export function destaqueBp(linha?: LinhaDemo): boolean {
  return !!linha?.subtotal && !/^(imobilizado|outros debitos|encargos financeiros (?:de |a )?(?:longo prazo|lp))$/.test(nome(linha.descricao));
}

export function linhasDfcRelatorio(linhas: LinhaDemo[]): LinhaDemo[] {
  return linhas.filter(l => {
    const n = nome(l.descricao);
    return !/^(bloco|fechamento)|validacao cpc/.test(n) && !/\bvariacao (?:de |dos |das )?fornecedores\b/.test(n)
      && (l.nivel <= 1 || /depreciacao|investimentos|emprestimos|patrimonio liquido/.test(n));
  });
}

/** Read EBIT directly from the monthly BI DRE, including saved report snapshots. */
export function indiceEbitRelatorio(dados: Pick<DadosRelatorio, "dre" | "periodo" | "anterior">): IndiceRel {
  const linha = dados.dre.find(l => /\bebit\b/i.test(l.descricao));
  return { key: "ebit", label: "EBIT (R$)", formula: "Resultado operacional antes de juros e impostos (EBIT da DRE)", formato: "money",
    atual: linha?.valores[dados.periodo] ?? null, anterior: dados.anterior ? linha?.valores[dados.anterior] ?? null : null };
}

export function valorCaixaNominal(valor: number): string {
  const numero = Math.abs(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return valor < 0 ? `(R$ ${numero})` : `R$ ${numero}`;
}

const LETRA = /[A-Za-zÀ-ÿ]/;
/** Mantidos em caixa alta: siglas de demonstrações, indicadores e siglas fiscais. */
const SIGLAS = new Set(["EBIT", "EBITDA", "DRE", "DFC", "BP", "PL", "ROE", "ROA", "ROI", "AV", "AH", "N/D", "CPC", "CNPJ", "CPF", "ICMS", "IPI", "ISS", "PIS", "COFINS", "CSLL", "IRPJ", "DVA", "DLPA", "DMPL", "CAPEX", "CDI", "SELIC", "MEI", "FGTS", "INSS", "LP", "CP", "TJ", "R$"]);
/** Palavras de ligação ficam em minúsculo no meio do título, como nas demais linhas. */
const CONECTIVOS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "em", "na", "no", "nos", "nas", "por", "com", "para", "sem", "ao", "aos", "um", "uma", "s"]);

/** Sobe a primeira letra, mesmo quando a palavra vem colada a um operador: ")deducoes" → ")Deducoes". */
const capitalizar = (s: string) => {
  const i = s.search(LETRA);
  return i < 0 ? s : s.slice(0, i) + s[i].toUpperCase() + s.slice(i + 1);
};

/**
 * Contas do plano chegam em CAIXA ALTA; o relatório apresenta as linhas em
 * título (como "Custo dos Produtos Vendidos"), então normaliza apenas o que
 * está inteiramente em maiúsculo, preservando siglas e operadores "(=)".
 */
export function tituloLinha(texto: string): string {
  const letras = texto.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letras.length < 2 || /[a-zà-ÿ]/.test(letras)) return texto;
  let primeira = true;
  return texto.split(/(\s+)/).map((token) => {
    if (!token || !LETRA.test(token) || SIGLAS.has(token)) return token;
    if (!primeira && CONECTIVOS.has(token.toLowerCase())) return token.toLowerCase();
    const partes = token.split(/([-/.])/).map((seg) => {
      if (!seg || !LETRA.test(seg) || SIGLAS.has(seg)) return seg;
      const baixo = seg.toLowerCase();
      return CONECTIVOS.has(baixo) ? baixo : capitalizar(baixo);
    });
    // A primeira palavra pode vir colada em um operador, como em "(-)DEDUCOES".
    const inicio = partes.findIndex((p) => LETRA.test(p) && !SIGLAS.has(p));
    if (primeira && inicio >= 0) partes[inicio] = capitalizar(partes[inicio]);
    primeira = false;
    return partes.join("").replace(/^(\(\s*[+=−-]\s*\))([A-Za-zÀ-ÿ])/, "$1 $2");
  }).join("");
}