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