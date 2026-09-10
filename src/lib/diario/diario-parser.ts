// Parser do Livro Diário (XLSX).
// Atenção: sistemas contábeis Windows exportam .xlsx com caminhos internos
// usando "\" em vez de "/", o que quebra leitores padrão. Corrigimos via JSZip
// antes de passar para xlsx.

import JSZip from "jszip";
import * as XLSX from "xlsx";
import {
  layoutDeJson,
  truncarHistorico,
  type LayoutImportacao,
} from "@/lib/importacao/layout";
import { lerArquivoQualquer, valorDaLinha } from "@/lib/importacao/ler-arquivo";

export interface DiarioRow {
  conta_codigo: string;
  conta_nome: string | null;
  subconta_codigo: string | null;
  data: string; // ISO YYYY-MM-DD
  competencia: string; // YYYY-MM-01
  historico: string | null;
  debito: number;
  credito: number;
  grupo_lancamento: string | null;
  lote: string | null;
  numero_lancamento: string | null;
}

export interface DiarioParseResult {
  rows: DiarioRow[];
  total: number;
  total_debitos: number;
  total_creditos: number;
  partidas_fechadas: boolean;
  diferenca: number;
  competencia_inicio: string | null;
  competencia_fim: string | null;
  competencias: string[]; // distinct, ordered
  contas_codigos: string[]; // distinct
  invalid_rows: number;
  warnings: string[];
  /** Colunas do arquivo que o layout descartou. */
  colunas_ignoradas?: number;
}

function normalizeHeader(h: string): string {
  return String(h ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

const ALIASES = {
  conta: ["conta", "cod conta", "codigo conta"],
  // AJUSTE 04 — o diário costuma trazer o NOME da conta numa coluna
  // própria, e o parser vinha descartando. É esse nome que pré-preenche
  // o cadastro de contas novas (clientes/fornecedores) no Plano Padrão.
  conta_nome: [
    "nome conta", "nome da conta", "descricao conta", "descricao da conta",
    "conta descricao", "desc conta", "nome", "descricao", "titulo conta",
    "razao social", "participante", "cliente fornecedor",
  ],
  subconta: ["subconta", "sub conta"],
  data: ["data", "dt lancamento", "data lancamento"],
  historico: ["historico", "complemento"],
  debito: ["debito", "deb", "vl debito", "valor debito"],
  credito: ["credito", "cred", "vl credito", "valor credito"],
  grupo: ["grupo lancamento", "grupo", "partida"],
  lote: ["lote"],
  numero: ["lancamento", "nr lancto", "no lancto erp", "n lancto erp", "num lancamento", "no. lancto erp"],
};

function detectIndices(header: any[]): Record<string, number> {
  const norm = header.map(normalizeHeader);
  const out: Record<string, number> = {};
  for (const [key, list] of Object.entries(ALIASES)) {
    for (const a of list) {
      const i = norm.indexOf(a);
      if (i >= 0) { out[key] = i; break; }
    }
  }
  return out;
}

export function parseValorBR(v: any): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

export function parseDataBR(v: any): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Excel serial date
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return new Date(ms);
  }
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  return null;
}

function fmtISO(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function readXlsxFixingBackslashes(file: File): Promise<XLSX.WorkBook> {
  const buf = await file.arrayBuffer();
  try {
    return XLSX.read(buf, { type: "array" });
  } catch {
    const src = await JSZip.loadAsync(buf);
    const dst = new JSZip();
    const names = Object.keys(src.files);
    for (const n of names) {
      const data = await src.files[n].async("uint8array");
      dst.file(n.replace(/\\/g, "/"), data);
    }
    const fixed = await dst.generateAsync({ type: "arraybuffer" });
    return XLSX.read(fixed, { type: "array" });
  }
}

export async function parseDiarioXLSX(
  file: File,
  layout?: LayoutImportacao | null,
): Promise<DiarioParseResult> {
  const l = layout ? layoutDeJson(layout) : null;
  if (l && l.colunas.conta && l.colunas.data && (l.colunas.debito || l.colunas.credito)) {
    return parseComLayout(file, l);
  }
  return parsePorAlias(file);
}

async function parseComLayout(file: File, layout: LayoutImportacao): Promise<DiarioParseResult> {
  const grade = await lerArquivoQualquer(file, {
    temCabecalho: layout.tem_cabecalho,
    linhaCabecalho: layout.linha_cabecalho,
  });
  const headers = grade.headers;
  const rows: DiarioRow[] = [];
  const comps = new Set<string>();
  const contas = new Set<string>();
  let total_debitos = 0;
  let total_creditos = 0;
  let invalid_rows = 0;

  for (const r of grade.linhas) {
    const conta = valorDaLinha(headers, r, layout.colunas.conta);
    if (!conta) continue;
    const d = parseDataBR(valorDaLinha(headers, r, layout.colunas.data));
    if (!d) { invalid_rows++; continue; }
    const debito = parseValorBR(valorDaLinha(headers, r, layout.colunas.debito));
    const credito = parseValorBR(valorDaLinha(headers, r, layout.colunas.credito));
    if (debito === 0 && credito === 0) continue;
    const dataISO = fmtISO(d);
    const competencia = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    total_debitos += debito;
    total_creditos += credito;
    comps.add(competencia);
    contas.add(conta);
    rows.push({
      conta_codigo: conta,
      conta_nome: valorDaLinha(headers, r, layout.colunas.descricao) || null,
      subconta_codigo: valorDaLinha(headers, r, layout.colunas.sub) || null,
      data: dataISO,
      competencia,
      historico: truncarHistorico(valorDaLinha(headers, r, layout.colunas.historico)),
      debito,
      credito,
      grupo_lancamento: null,
      lote: null,
      numero_lancamento: valorDaLinha(headers, r, layout.colunas.numero) || null,
    });
  }

  const nMapeadas = Object.values(layout.colunas).filter(Boolean).length;
  const warnings: string[] = [];
  if (invalid_rows > 0) warnings.push(`${invalid_rows} linhas com data inválida foram ignoradas.`);
  return fecharResultado(rows, total_debitos, total_creditos, comps, contas, invalid_rows, warnings, {
    colunas_ignoradas: Math.max(0, grade.nColunasArquivo - nMapeadas),
  });
}

async function parsePorAlias(file: File): Promise<DiarioParseResult> {
  const wb = await readXlsxFixingBackslashes(file);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const matrix: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  if (matrix.length < 2) throw new Error("Planilha vazia.");
  const header = matrix[0];
  const idx = detectIndices(header);
  const required = ["conta", "data", "debito", "credito"] as const;
  const missing = required.filter((k) => idx[k] === undefined);
  if (missing.length) {
    throw new Error(
      `Cabeçalho inválido. Faltando: ${missing.join(", ")}. Encontrado: ${header.join(", ")}`,
    );
  }

  const rows: DiarioRow[] = [];
  const comps = new Set<string>();
  const contas = new Set<string>();
  let total_debitos = 0;
  let total_creditos = 0;
  let invalid_rows = 0;

  for (let i = 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (!r || r.length === 0) continue;
    const conta = String(r[idx.conta] ?? "").trim();
    if (!conta) continue;
    const d = parseDataBR(r[idx.data]);
    if (!d) { invalid_rows++; continue; }
    const debito = parseValorBR(r[idx.debito]);
    const credito = parseValorBR(r[idx.credito]);
    if (debito === 0 && credito === 0) continue;
    const dataISO = fmtISO(d);
    const competencia = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    total_debitos += debito;
    total_creditos += credito;
    comps.add(competencia);
    contas.add(conta);
    rows.push({
      conta_codigo: conta,
      conta_nome: idx.conta_nome != null ? (String(r[idx.conta_nome] ?? "").trim() || null) : null,
      subconta_codigo: idx.subconta != null ? (String(r[idx.subconta] ?? "").trim() || null) : null,
      data: dataISO,
      competencia,
      historico: truncarHistorico(idx.historico != null ? String(r[idx.historico] ?? "") : null),
      debito,
      credito,
      grupo_lancamento: idx.grupo != null ? (String(r[idx.grupo] ?? "").trim() || null) : null,
      lote: idx.lote != null ? (String(r[idx.lote] ?? "").trim() || null) : null,
      numero_lancamento: idx.numero != null ? (String(r[idx.numero] ?? "").trim() || null) : null,
    });
  }

  const nIgnoradas = Math.max(0, header.length - Object.keys(idx).length);
  const warnings: string[] = [];
  if (invalid_rows > 0) warnings.push(`${invalid_rows} linhas com data inválida foram ignoradas.`);
  if (nIgnoradas > 0) {
    warnings.push(`${nIgnoradas} coluna(s) do arquivo não entram no BI.`);
  }
  return fecharResultado(rows, total_debitos, total_creditos, comps, contas, invalid_rows, warnings, {
    colunas_ignoradas: nIgnoradas,
  });
}

function fecharResultado(
  rows: DiarioRow[],
  total_debitos: number,
  total_creditos: number,
  comps: Set<string>,
  contas: Set<string>,
  invalid_rows: number,
  warnings: string[],
  extra?: { colunas_ignoradas?: number },
): DiarioParseResult {
  const diferenca = Math.abs(total_debitos - total_creditos);
  const comps_ord = Array.from(comps).sort();
  return {
    rows,
    total: rows.length,
    total_debitos: Math.round(total_debitos * 100) / 100,
    total_creditos: Math.round(total_creditos * 100) / 100,
    partidas_fechadas: diferenca < 0.01,
    diferenca: Math.round(diferenca * 100) / 100,
    competencia_inicio: comps_ord[0] ?? null,
    competencia_fim: comps_ord[comps_ord.length - 1] ?? null,
    competencias: comps_ord,
    contas_codigos: Array.from(contas),
    invalid_rows,
    warnings,
    colunas_ignoradas: extra?.colunas_ignoradas,
  };
}
