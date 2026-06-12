// Parser do CSV de Plano de Contas.
// Formato: ISO-8859-1, separador ";", header em pt-BR.
// Colunas: Código;Classificação;Descrição;Tipo;Natureza
// Cruzamento contábil sempre por CÓDIGO (classificação pode se repetir).

export const TIPOS_PARTICIPANTE = new Set([
  "4-Cli. Nac.",
  "5-For. Nac.",
  "6-Cli. Ex.",
  "7-For. Ex.",
]);

export interface PlanoContaRow {
  codigo: string;
  classificacao: string;
  descricao: string;
  tipo: string;
  natureza: "S" | "A";
  nivel: number;
  is_participante: boolean;
}

export interface PlanoParseResult {
  rows: PlanoContaRow[];
  total: number;
  estruturais: number;
  participantes: number;
  porTipo: Record<string, number>;
  encoding: "utf-8" | "iso-8859-1";
  warnings: string[];
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

const ALIASES: Record<keyof Omit<PlanoContaRow, "nivel" | "is_participante">, string[]> = {
  codigo: ["codigo", "cod", "conta", "cod conta", "cod. conta"],
  classificacao: ["classificacao", "class", "mascara", "estrutura"],
  descricao: ["descricao", "nome", "nome conta", "descricao da conta"],
  tipo: ["tipo", "grupo"],
  natureza: ["natureza", "s/a", "sintetica/analitica", "tipo conta"],
};

async function readWithEncoding(file: File): Promise<{ text: string; encoding: "utf-8" | "iso-8859-1" }> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (utf8.includes("\uFFFD")) {
    return { text: new TextDecoder("iso-8859-1").decode(buf), encoding: "iso-8859-1" };
  }
  return { text: utf8, encoding: "utf-8" };
}

// CSV ;-delimitado com aspas opcionais
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ";" && !inQ) {
      out.push(cur); cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectIndices(headerCols: string[]): Record<string, number> {
  const norm = headerCols.map(normalizeHeader);
  const idx: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      const i = norm.indexOf(a);
      if (i >= 0) { idx[key] = i; break; }
    }
  }
  return idx;
}

export async function parsePlanoContasCSV(file: File): Promise<PlanoParseResult> {
  const { text, encoding } = await readWithEncoding(file);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("Arquivo vazio ou sem cabeçalho.");

  const headerCols = splitCsvLine(lines[0]);
  const idx = detectIndices(headerCols);
  const missing = (["codigo", "classificacao", "descricao", "tipo", "natureza"] as const).filter(
    (k) => idx[k] === undefined,
  );
  if (missing.length) {
    throw new Error(
      `Cabeçalho inválido. Colunas faltando: ${missing.join(", ")}. Encontrado: ${headerCols.join(", ")}`,
    );
  }

  const warnings: string[] = [];
  const rows: PlanoContaRow[] = [];
  const seenCodigos = new Set<string>();
  let duplicados = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 5) continue;
    const codigo = cols[idx.codigo]?.trim();
    const classificacao = cols[idx.classificacao]?.trim();
    const descricao = cols[idx.descricao]?.trim();
    const tipo = cols[idx.tipo]?.trim();
    const natRaw = (cols[idx.natureza] ?? "").trim().toUpperCase();
    if (!codigo || !classificacao || !descricao) continue;
    if (seenCodigos.has(codigo)) { duplicados++; continue; }
    seenCodigos.add(codigo);
    const natureza: "S" | "A" = natRaw.startsWith("S") ? "S" : "A";
    const nivel = classificacao.split(".").length;
    rows.push({
      codigo,
      classificacao,
      descricao,
      tipo,
      natureza,
      nivel,
      is_participante: TIPOS_PARTICIPANTE.has(tipo),
    });
  }

  if (duplicados > 0) warnings.push(`${duplicados} linhas com código duplicado foram ignoradas.`);

  const porTipo: Record<string, number> = {};
  let estruturais = 0;
  let participantes = 0;
  for (const r of rows) {
    porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + 1;
    if (r.is_participante) participantes++; else estruturais++;
  }

  return { rows, total: rows.length, estruturais, participantes, porTipo, encoding, warnings };
}
