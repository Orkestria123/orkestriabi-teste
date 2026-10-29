// Layout de planilha dos lançamentos gerenciais (exportar modelo / importar).
// Browser-safe e puro: a resolução de contas é injetada.

export const COLUNAS_AJUSTES = [
  "Competência",
  "Conta Débito",
  "Conta Crédito",
  "Valor",
  "Descrição",
  "Justificativa",
  "Movimenta DFC",
] as const;

export interface LinhaAjusteImport {
  linha: number;
  competencia: string; // YYYY-MM-01
  conta_debito: string;
  conta_credito: string;
  valor: number;
  descricao: string;
  justificativa: string | null;
  movimenta_dfc: boolean;
  erro?: string;
}

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Aceita 08/2026, 8/2026, 2026-08, 2026-08-01, 01/08/2026 e serial Excel. */
export function parseCompetencia(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && v > 20000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (m) return mes(m[1], m[2]);
  m = s.match(/^(?:\d{1,2}\/)?(\d{1,2})\/(\d{4})$/);
  if (m) return mes(m[2], m[1]);
  return null;
}
function mes(y: string, m: string): string | null {
  const n = Number(m);
  if (n < 1 || n > 12) return null;
  return `${y}-${String(n).padStart(2, "0")}-01`;
}

/** "1.500,00", "1500.5", 1500 → número. */
export function parseValorPlanilha(v: unknown): number {
  if (typeof v === "number") return v;
  const t = String(v ?? "").replace(/[R$\s]/g, "").trim();
  if (!t) return NaN;
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(t);
}

export function parseSimNao(v: unknown): boolean {
  const s = norm(v);
  if (!s) return true;
  return !["nao", "n", "false", "0", "no"].includes(s);
}

/**
 * rows: matriz (header na primeira linha). resolver: código/classificação → código
 * da conta, ou null se não existir.
 */
export function lerLinhasAjustes(
  rows: unknown[][],
  resolver: (ref: string) => string | null,
): LinhaAjusteImport[] {
  if (!rows.length) return [];
  const head = rows[0].map(norm);
  const idx = (...nomes: string[]) => head.findIndex((h) => nomes.some((n) => h.startsWith(n)));
  const iC = idx("competencia");
  const iD = idx("conta debito", "debito");
  const iK = idx("conta credito", "credito");
  const iV = idx("valor");
  const iDesc = idx("descricao", "historico");
  const iJ = idx("justificativa");
  const iF = idx("movimenta");
  const out: LinhaAjusteImport[] = [];
  rows.slice(1).forEach((r, i) => {
    if (!r || r.every((c) => String(c ?? "").trim() === "")) return;
    const refD = String(r[iD] ?? "").trim();
    const refK = String(r[iK] ?? "").trim();
    const l: LinhaAjusteImport = {
      linha: i + 2,
      competencia: parseCompetencia(r[iC]) ?? "",
      conta_debito: resolver(refD) ?? refD,
      conta_credito: resolver(refK) ?? refK,
      valor: parseValorPlanilha(r[iV]),
      descricao: String(r[iDesc] ?? "").trim(),
      justificativa: iJ >= 0 ? String(r[iJ] ?? "").trim() || null : null,
      movimenta_dfc: iF >= 0 ? parseSimNao(r[iF]) : true,
    };
    if (!l.competencia) l.erro = "Competência inválida";
    else if (!refD || !resolver(refD)) l.erro = `Conta débito "${refD}" não encontrada`;
    else if (!refK || !resolver(refK)) l.erro = `Conta crédito "${refK}" não encontrada`;
    else if (l.conta_debito === l.conta_credito) l.erro = "Débito e crédito iguais";
    else if (!Number.isFinite(l.valor) || l.valor <= 0) l.erro = "Valor deve ser positivo";
    else if (!l.descricao) l.erro = "Descrição vazia";
    out.push(l);
  });
  return out;
}

/** Referências usadas na planilha (para buscar contas fora da lista carregada). */
export function referenciasContas(rows: unknown[][]): string[] {
  if (!rows.length) return [];
  const head = rows[0].map(norm);
  const cols = head.map((h, i) => (h.includes("debito") || h.includes("credito") ? i : -1)).filter((i) => i >= 0);
  const s = new Set<string>();
  rows.slice(1).forEach((r) => cols.forEach((c) => { const v = String(r?.[c] ?? "").trim(); if (v) s.add(v); }));
  return [...s];
}
