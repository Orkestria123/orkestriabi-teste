import JSZip from "jszip";
import * as XLSX from "xlsx";
import {
  indiceDaColuna,
  parsePosicaoColuna,
  pareceLinhaDeCabecalho,
} from "./layout";
import { textoDoArquivo as decodificarTexto } from "./encoding";

export interface GradeArquivo {
  nome: string;
  headers: string[];
  /** Linhas de dados guardadas (pode ser só a amostra). */
  linhas: string[][];
  preview: string[][];
  encoding: "utf-8" | "iso-8859-1" | "xlsx";
  /** true = sem cabeçalho; headers são "Coluna 1"… e a 1ª linha já é dado. */
  porPosicao: boolean;
  /** Linhas de dado no arquivo (estimado se a leitura foi limitada). */
  totalLinhas: number;
  truncado: boolean;
  bytesArquivo: number;
  nColunasArquivo: number;
}

export type OpcoesLeituraArquivo = {
  /** 1-based. Ignorado se temCabecalho for false. */
  linhaCabecalho?: number;
  /** false = sem cabeçalho (posição). omitido/"auto" = detecta pela 1ª linha. */
  temCabecalho?: boolean | "auto";
  /** Só guarda as primeiras N linhas de dado — para mapear layout. */
  maxLinhas?: number;
};

function splitCsv(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (c === sep && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectarSeparador(linha: string): string {
  const cand = [";", ",", "\t", "|"];
  let best = ";";
  let n = -1;
  for (const s of cand) {
    const c = splitCsv(linha, s).length;
    if (c > n) {
      n = c;
      best = s;
    }
  }
  return best;
}

async function textoDoArquivo(file: File): Promise<{ text: string; encoding: "utf-8" | "iso-8859-1" }> {
  const { text, encoding } = await decodificarTexto(file);
  return { text, encoding: encoding === "windows-1252" ? "iso-8859-1" : "utf-8" };
}

async function workbookDeXlsx(file: File, sheetRows?: number): Promise<XLSX.WorkBook> {
  const buf = await file.arrayBuffer();
  const opts: XLSX.ParsingOptions = { type: "array" };
  if (file.name.toLowerCase().endsWith(".xls")) opts.codepage = 1252;
  if (sheetRows != null && sheetRows > 0) opts.sheetRows = sheetRows;
  try {
    return XLSX.read(buf, opts);
  } catch {
    const src = await JSZip.loadAsync(buf);
    const dst = new JSZip();
    for (const n of Object.keys(src.files)) {
      dst.file(n.replace(/\\/g, "/"), await src.files[n].async("uint8array"));
    }
    return XLSX.read(await dst.generateAsync({ type: "arraybuffer" }), opts);
  }
}

function celula(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

function montarGrade(
  file: File,
  matrix: string[][],
  encoding: GradeArquivo["encoding"],
  temCabecalho: boolean,
  linhaCabecalho: number,
  maxLinhas?: number,
): GradeArquivo {
  if (matrix.length === 0) throw new Error("Arquivo vazio.");
  const nCols = Math.max(1, ...matrix.map((r) => r.length));
  const pad = (r: string[]) => {
    if (r.length === nCols) return r;
    const x = r.slice();
    while (x.length < nCols) x.push("");
    return x;
  };

  if (!temCabecalho) {
    const todas = matrix.filter((r) => r.some((c) => String(c).length > 0)).map(pad);
    const linhas = maxLinhas != null ? todas.slice(0, maxLinhas) : todas;
    return {
      nome: file.name,
      headers: Array.from({ length: nCols }, (_, i) => `Coluna ${i + 1}`),
      linhas,
      preview: linhas.slice(0, 8),
      encoding,
      porPosicao: true,
      totalLinhas: todas.length,
      truncado: linhas.length < todas.length,
      bytesArquivo: file.size,
      nColunasArquivo: nCols,
    };
  }

  const idxCab = Math.max(0, linhaCabecalho - 1);
  if (matrix.length <= idxCab) throw new Error("Não há linha de cabeçalho nesse arquivo.");
  const headers = pad(matrix[idxCab]).map((h, i) => h || `Coluna ${i + 1}`);
  const todas = matrix.slice(idxCab + 1).filter((r) => r.some((c) => String(c).length > 0)).map(pad);
  const linhas = maxLinhas != null ? todas.slice(0, maxLinhas) : todas;
  return {
    nome: file.name,
    headers,
    linhas,
    preview: linhas.slice(0, 8),
    encoding,
    porPosicao: false,
    totalLinhas: todas.length,
    truncado: linhas.length < todas.length,
    bytesArquivo: file.size,
    nColunasArquivo: nCols,
  };
}

export async function lerArquivoQualquer(
  file: File,
  opts: number | OpcoesLeituraArquivo = 1,
): Promise<GradeArquivo> {
  const op: OpcoesLeituraArquivo = typeof opts === "number"
    ? { linhaCabecalho: opts, temCabecalho: opts >= 1 }
    : opts;
  const nome = file.name.toLowerCase();
  const ehXlsx = nome.endsWith(".xlsx") || nome.endsWith(".xls");
  const max = op.maxLinhas;
  const linhaCab = op.linhaCabecalho ?? 1;

  let matrix: string[][] = [];
  let encoding: GradeArquivo["encoding"] = "utf-8";
  let csvTruncado = false;

  if (ehXlsx) {
    // sheetRows limita o parse do xlsx — arquivo de 50 MB não vira 200 mil
    // linhas no navegador só para atribuir coluna.
    const extraCab = 2;
    const sheetRows = max != null ? max + extraCab + Math.max(0, linhaCab) : undefined;
    const wb = await workbookDeXlsx(file, sheetRows);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1, raw: false, defval: "",
    });
    matrix = raw.map((r) => (Array.isArray(r) ? r.map(celula) : []));
    encoding = "xlsx";
  } else {
    const { text, encoding: enc } = await textoDoArquivo(file);
    encoding = enc;
    const lines = text.split(/\r?\n/);
    if (lines.every((l) => l.trim().length === 0)) throw new Error("Arquivo vazio.");
    const primeira = lines.find((l) => l.trim().length > 0) ?? "";
    const sep = detectarSeparador(primeira);
    const teto = max != null ? max + 8 : Number.POSITIVE_INFINITY;
    let nUteis = 0;
    for (const l of lines) {
      if (!l.trim()) continue;
      matrix.push(splitCsv(l, sep));
      nUteis++;
      if (nUteis > teto) { csvTruncado = true; break; }
    }
  }

  let temCabecalho = op.temCabecalho;
  if (temCabecalho === undefined || temCabecalho === "auto") {
    temCabecalho = pareceLinhaDeCabecalho(matrix[0] ?? []);
  }

  const grade = montarGrade(file, matrix, encoding, !!temCabecalho, linhaCab, max);
  if ((ehXlsx && max != null && grade.linhas.length >= max) || csvTruncado) {
    grade.truncado = true;
  }
  return grade;
}

export function valorDaLinha(
  headers: string[],
  row: string[],
  nomeColuna: string | undefined,
): string {
  if (!nomeColuna) return "";
  const pos = parsePosicaoColuna(nomeColuna);
  if (pos != null) return (row[pos - 1] ?? "").trim();
  const i = indiceDaColuna(headers, nomeColuna);
  if (i < 0) return "";
  return (row[i] ?? "").trim();
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}
