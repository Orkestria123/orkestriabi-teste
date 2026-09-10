export function formatBRL(value: number | null | undefined): string {
  if (value == null || isNaN(value as number)) return "—";
  const v = Number(value);
  const abs = Math.abs(v).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return v < 0 ? `(R$ ${abs})` : `R$ ${abs}`;
}

/** Sem prefixo "R$", negativos entre parênteses. */
export function formatBRLPlain(
  value: number | null | undefined,
  opts?: { digits?: number; scale?: number },
): string {
  if (value == null || isNaN(value as number)) return "—";
  const digits = opts?.digits ?? 2;
  const scale = opts?.scale ?? 1;
  const v = Number(value) / scale;
  const abs = Math.abs(v).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return v < 0 ? `(${abs})` : abs;
}

export function formatBRLCompact(value: number | null | undefined): string {
  if (value == null || isNaN(value as number)) return "—";
  const v = Number(value);
  const abs = Math.abs(v);
  let formatted: string;
  if (abs >= 1_000_000_000) formatted = `${(v / 1_000_000_000).toFixed(2)} bi`;
  else if (abs >= 1_000_000) formatted = `${(v / 1_000_000).toFixed(2)} mi`;
  else if (abs >= 1_000) formatted = `${(v / 1_000).toFixed(1)} mil`;
  else formatted = v.toFixed(0);
  return `R$ ${formatted}`;
}

export function formatPct(value: number | null | undefined, digits = 2): string {
  if (value == null || isNaN(value as number)) return "—";
  return `${Number(value).toFixed(digits).replace(".", ",")}%`;
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || isNaN(value as number)) return "—";
  return Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export const MES_ABBR = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

export function periodoLabel(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${MES_ABBR[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Nome de conta em Caixa de Título
//
// O plano vem do sistema contábil TODO EM MAIÚSCULA ("DESPESAS COM
// ADMINISTRAÇÃO DE IMOVEIS"), que é como o contábil imprime mas fica
// pesado numa tela de BI. Aqui vira "Despesas com Administração de
// Imóveis", com três cuidados:
//
//   - siglas continuam em caixa alta (ICMS, IRPJ, FGTS, BNDES…);
//   - preposições ficam minúsculas, menos no começo;
//   - marcadores contábeis "(-)", "(+)", "(=)" são preservados.
//
// Rótulo que já vem escrito certo passa sem alteração: "(=) Lucro Bruto"
// continua "(=) Lucro Bruto".
// ---------------------------------------------------------------------------

const SIGLAS = new Set([
  "ICMS", "IPI", "PIS", "COFINS", "IRPJ", "CSLL", "INSS", "FGTS", "IRRF", "IRF",
  "ISS", "ISSQN", "IOF", "IPTU", "IPVA", "ITBI", "CPMF", "CIDE", "CIAP", "DIFAL",
  "SIMPLES", "MEI", "EPP", "ME", "SA", "S.A", "S.A.", "LTDA", "EIRELI", "CNPJ",
  "CPF", "BNDES", "FINAME", "JCP", "PAT", "RAT", "SAT", "GPS", "DARF", "DAS",
  "DRE", "DFC", "DVA", "DLPA", "BP", "PL", "CDB", "LCI", "LCA", "TR", "TJLP",
  "SELIC", "CDI", "IGPM", "IPCA", "INPC", "RET", "SCI", "EPI", "PPRA", "PCMSO",
  "CIPA", "FAP", "RH", "TI", "PDV", "ADM", "CMV", "CPV", "EBIT", "EBITDA",
]);

const MINUSCULAS = new Set([
  "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas",
  "a", "o", "as", "os", "ao", "aos", "à", "às", "para", "por", "com",
  "sem", "sob", "sobre", "ou", "the",
]);

/** "DESPESAS COM VALE TRANSPORTE" -> "Despesas com Vale Transporte" */
export function tituloConta(texto: string | null | undefined): string {
  if (!texto) return "";
  const original = String(texto);
  // Normaliza sempre, inclusive o que já vem em caixa mista: o objetivo é
  // uma formatação só em todo o BI. Rótulo já correto sai igual —
  // "(=) Lucro Bruto" continua "(=) Lucro Bruto".
  let primeiraPalavra = true;
  return original.replace(/[\wÀ-ÿ]+(?:[.'’-][\wÀ-ÿ]+)*/g, (palavra) => {
    const nu = palavra.toUpperCase();
    if (SIGLAS.has(nu)) {
      primeiraPalavra = false;
      return nu;
    }
    // número, ou código tipo "13o" / "1o" — deixa como está
    if (/^\d/.test(palavra)) {
      primeiraPalavra = false;
      return palavra;
    }
    const baixa = palavra.toLowerCase();
    if (!primeiraPalavra && MINUSCULAS.has(baixa)) return baixa;
    primeiraPalavra = false;
    return baixa.charAt(0).toUpperCase() + baixa.slice(1);
  });
}
