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
