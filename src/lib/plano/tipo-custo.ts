/** Fixo/variável e custo/despesa no plano. Filho herda o ancestral mais específico. */

export type TipoCusto = "fixo" | "variavel";
export type ClasseGasto = "custo" | "despesa";

export function tipoCustoEfetivo(
  classificacao: string,
  plano: { classificacao: string; tipo_custo?: string | null }[],
): TipoCusto | null {
  let best: { len: number; tipo: TipoCusto } | null = null;
  for (const p of plano) {
    if (p.tipo_custo !== "fixo" && p.tipo_custo !== "variavel") continue;
    const cls = p.classificacao;
    const bate =
      classificacao === cls ||
      classificacao.startsWith(cls + ".") ||
      classificacao.startsWith(cls + "-");
    if (!bate) continue;
    if (!best || cls.length > best.len) best = { len: cls.length, tipo: p.tipo_custo };
  }
  return best?.tipo ?? null;
}

export function classeGastoEfetivo(
  classificacao: string,
  plano: { classificacao: string; classe_gasto?: string | null }[],
): ClasseGasto | null {
  let best: { len: number; tipo: ClasseGasto } | null = null;
  for (const p of plano) {
    if (p.classe_gasto !== "custo" && p.classe_gasto !== "despesa") continue;
    const cls = p.classificacao;
    const bate =
      classificacao === cls ||
      classificacao.startsWith(cls + ".") ||
      classificacao.startsWith(cls + "-");
    if (!bate) continue;
    if (!best || cls.length > best.len) best = { len: cls.length, tipo: p.classe_gasto };
  }
  return best?.tipo ?? null;
}

function clsGasto(cls: string): string {
  return cls.trim().replace(/,/g, ".").replace(/\s+/g, "");
}

function noPrefixoGasto(cls: string, prefixo: string): boolean {
  const c = clsGasto(cls);
  const p = clsGasto(prefixo);
  if (c === p) return true;
  if (!c.startsWith(p)) return false;
  const proximo = c.charAt(p.length);
  return proximo === "." || proximo === "-" || proximo === "/";
}

function ehReceitaOuSubtotal(cls: string): boolean {
  const c = clsGasto(cls);
  if (!c || c === "3") return true;
  if (noPrefixoGasto(c, "3.01") || noPrefixoGasto(c, "3.10") || noPrefixoGasto(c, "3.16")) return true;
  if (noPrefixoGasto(c, "3.19") || noPrefixoGasto(c, "3.99")) return true;
  if (c === "3.05.99" || c === "3.01.99" || c === "3.10.99" || c === "3.15.99") return true;
  if (noPrefixoGasto(c, "3.07.01.02") || noPrefixoGasto(c, "3.07.01.03") || noPrefixoGasto(c, "3.07.01.04")) {
    return true;
  }
  if (noPrefixoGasto(c, "3.15.01.05")) return false;
  if (noPrefixoGasto(c, "3.15.01.01") || noPrefixoGasto(c, "3.15.01.02") || noPrefixoGasto(c, "3.15.01.04")) {
    return true;
  }
  if (c === "3.07" || c === "3.07.01" || c === "3.15" || c === "3.15.01") return true;
  return false;
}

function classePorPrefixo(cls: string): ClasseGasto | null {
  const c = clsGasto(cls);
  if (ehReceitaOuSubtotal(c)) return null;
  if (noPrefixoGasto(c, "3.02") || noPrefixoGasto(c, "3.03") || noPrefixoGasto(c, "3.04") || noPrefixoGasto(c, "3.05")) {
    return "custo";
  }
  if (
    noPrefixoGasto(c, "3.06") ||
    noPrefixoGasto(c, "3.07.01.01") ||
    noPrefixoGasto(c, "3.07.01.14") ||
    noPrefixoGasto(c, "3.06.01.13") ||
    noPrefixoGasto(c, "3.06.01.14") ||
    noPrefixoGasto(c, "3.15.01.03") ||
    noPrefixoGasto(c, "3.15.01.05") ||
    noPrefixoGasto(c, "3.17") ||
    noPrefixoGasto(c, "3.18")
  ) {
    return "despesa";
  }
  return null;
}

function tipoPorPrefixo(cls: string): TipoCusto {
  const c = clsGasto(cls);
  if (noPrefixoGasto(c, "3.06.01.01") || noPrefixoGasto(c, "3.06.01.02")) return "fixo";
  if (noPrefixoGasto(c, "3.06.01.05") || noPrefixoGasto(c, "3.06.01.06") || noPrefixoGasto(c, "3.06.01.07")) {
    return "fixo";
  }
  if (noPrefixoGasto(c, "3.02") || noPrefixoGasto(c, "3.03") || noPrefixoGasto(c, "3.04") || noPrefixoGasto(c, "3.05")) {
    return "variavel";
  }
  return "variavel";
}

function tipoPorNome(descricao: string, fallback: TipoCusto): TipoCusto {
  const n = descricao
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/inss\s+retido/.test(n) || /produtor rural/.test(n)) return "variavel";
  if (/\biss\s+fixo\b/.test(n) || /taxas municipais/.test(n) || /\biptu\b/.test(n)) return "fixo";
  if (
    /\bcompra/.test(n) ||
    /\bestoque/.test(n) ||
    /mercadoria/.test(n) ||
    /comiss/.test(n) ||
    /\bfrete/.test(n) ||
    /desconto/.test(n) ||
    /\bjuro/.test(n) ||
    /\biof\b/.test(n) ||
    /variac/.test(n) ||
    /cambial/.test(n) ||
    /bancari/.test(n) ||
    /financiamento/.test(n) ||
    /duplicata/.test(n) ||
    /cobranca/.test(n) ||
    /\bicms\b/.test(n) ||
    /\bpis\b/.test(n) ||
    /\bcofins\b/.test(n) ||
    /royalt/.test(n) ||
    /amostra/.test(n) ||
    /brinde/.test(n) ||
    /catalogo/.test(n) ||
    /feira/.test(n) ||
    /\bperda/.test(n) ||
    /acordo comercial/.test(n) ||
    /exportacao/.test(n) ||
    /publicidade|propaganda/.test(n) ||
    /materia[- ]prima/.test(n)
  ) {
    return "variavel";
  }
  if (
    /pro[-\s]?labore/.test(n) ||
    /\bsalario/.test(n) ||
    /\b13o?\b/.test(n) ||
    /\binss\b/.test(n) ||
    /\bfgts\b/.test(n) ||
    /\bferias\b/.test(n) ||
    /previdencia/.test(n) ||
    /alugue[il]/.test(n) ||
    /condominio/.test(n) ||
    /depreciac/.test(n) ||
    /amortizac/.test(n) ||
    /honorario/.test(n) ||
    /assessoria/.test(n) ||
    /vigilanc/.test(n) ||
    /plano de saude/.test(n) ||
    /assist\.?\s*medica/.test(n) ||
    /vale transporte/.test(n) ||
    /alimentacao|alimetacao/.test(n) ||
    /formacao profissional/.test(n) ||
    /treinamento/.test(n) ||
    /estagio/.test(n) ||
    /imposto sindical/.test(n) ||
    /mensalidade/.test(n) ||
    /anuidade/.test(n) ||
    /indenizacoes trabalhistas/.test(n) ||
    /horas extras/.test(n) ||
    /seguro/.test(n) ||
    /manutenc/.test(n) ||
    /conserv/.test(n)
  ) {
    return "fixo";
  }
  return fallback;
}

/**
 * Custo/despesa e fixo/variável a partir da classificação e do nome.
 * Receita, subtotal e resultado financeiro misto ficam de fora.
 */
export function inferirAlocacaoGasto(
  classificacao: string,
  descricao?: string | null,
): { classe: ClasseGasto; tipo: TipoCusto } | null {
  const classe = classePorPrefixo(classificacao);
  if (!classe) return null;
  const tipo = tipoPorNome(descricao ?? "", tipoPorPrefixo(classificacao));
  return { classe, tipo };
}

/** Conta de resultado que entra em Custo/Despesa (não receita, não subtotal). */
export function ehContaDeCustoDespesa(classificacao: string): boolean {
  return inferirAlocacaoGasto(classificacao, null) != null;
}

export type ChaveAlocacao = `${ClasseGasto}:${TipoCusto}`;

export function chaveAlocacao(
  classe: string | null | undefined,
  tipo: string | null | undefined,
): ChaveAlocacao | "" {
  if (
    (classe === "custo" || classe === "despesa") &&
    (tipo === "fixo" || tipo === "variavel")
  ) {
    return `${classe}:${tipo}`;
  }
  return "";
}

export const ALOCACOES_GASTO: { value: ChaveAlocacao; label: string }[] = [
  { value: "custo:fixo", label: "Custo fixo" },
  { value: "custo:variavel", label: "Custo variável" },
  { value: "despesa:fixo", label: "Despesa fixa" },
  { value: "despesa:variavel", label: "Despesa variável" },
];

