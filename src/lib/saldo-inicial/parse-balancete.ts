// Parser do balancete de SALDO INICIAL (formato Transpio e similares).
// Entrada: CSV ';' delimitado, encoding UTF-8 (com BOM) ou Latin-1.
// Colunas esperadas: Classificação;Conta;Sub;Nome da conta contábil/C. Custo;Tipo conta;Nível;Cta. título;Estab.;Valor
//
// REGRAS:
//   - Processa SOMENTE analíticas (Cta. título = "2-Não")
//   - INCLUI participantes (tipos 4-7) — eles carregam saldo e somam na conta-pai
//   - Sintéticas (Cta. título = "1-Sim") são totais calculados → ignoradas
//   - Sinal padronizado para D−C via saldoPadronizado()

import { saldoPadronizado } from "./sinal";
import {
  dividir,
  grupoDe,
  MASCARA_DEFAULT,
  type MascaraConfig,
} from "@/lib/mascara/interpretar";

export const TIPOS_PARTICIPANTE = new Set([
  "4-cli. nac.",
  "5-for. nac.",
  "6-cli. ex.",
  "7-for. ex.",
]);

export interface SaldoInicialRow {
  conta_codigo: string;
  classificacao: string;
  descricao: string;
  tipo: string;
  nivel: number;
  is_participante: boolean;
  saldo: number; // padronizado D−C
  valor_origem: number; // valor cru do arquivo (auditoria)
}

export interface SaldoInicialParseResult {
  rows: SaldoInicialRow[];
  total: number;
  total_ativo: number; // Σ saldo onde grupo 1
  total_passivo_pl: number; // Σ |saldo| onde grupo 2 (já invertido → positivo no credor)
  diferenca: number; // ativo - |passivo+pl| (deve ser ≈ 0)
  equilibrado: boolean;
  encoding: "utf-8" | "iso-8859-1";
  warnings: string[];
  participantes: number;
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

async function readWithEncoding(
  file: File,
): Promise<{ text: string; encoding: "utf-8" | "iso-8859-1" }> {
  const buf = await file.arrayBuffer();
  let utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  // Remove BOM
  if (utf8.charCodeAt(0) === 0xfeff) utf8 = utf8.slice(1);
  if (utf8.includes("\uFFFD")) {
    return { text: new TextDecoder("iso-8859-1").decode(buf), encoding: "iso-8859-1" };
  }
  return { text: utf8, encoding: "utf-8" };
}

function splitCsv(line: string): string[] {
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
    } else if (c === ";" && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const ALIASES = {
  classificacao: ["classificacao", "classificação"],
  conta: ["conta", "codigo", "código", "cod conta"],
  descricao: [
    "nome da conta contabil/c. custo",
    "nome da conta contabil",
    "nome da conta",
    "nome",
    "descricao",
    "descrição",
  ],
  tipo: ["tipo conta", "tipo"],
  nivel: ["nivel", "nível"],
  cta_titulo: ["cta. titulo", "cta titulo", "cta. título", "cta título", "titulo", "título"],
  valor: ["valor", "saldo"],
} as const;

function detectIdx(header: string[]): Record<keyof typeof ALIASES, number> {
  const norm = header.map(normalizeHeader);
  const idx: any = {};
  for (const [key, aliases] of Object.entries(ALIASES)) {
    idx[key] = -1;
    for (const a of aliases) {
      const i = norm.indexOf(a);
      if (i >= 0) {
        idx[key] = i;
        break;
      }
    }
  }
  return idx;
}

// Aceita "1.539.255,93" ou "-1.234,56" ou "1234.56" etc.
function parseValorBR(raw: string): number {
  if (!raw) return 0;
  const s = raw.trim();
  if (!s) return 0;
  // Se tem vírgula, é formato BR: remove pontos de milhar, troca vírgula por ponto
  if (s.includes(",")) {
    return Number(s.replace(/\./g, "").replace(",", ".")) || 0;
  }
  return Number(s) || 0;
}

export async function parseSaldoInicialCSV(
  file: File,
  mascara: MascaraConfig = MASCARA_DEFAULT,
): Promise<SaldoInicialParseResult> {
  const { text, encoding } = await readWithEncoding(file);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("Arquivo vazio ou sem cabeçalho.");

  const header = splitCsv(lines[0]);
  const idx = detectIdx(header);
  const obrig: (keyof typeof ALIASES)[] = [
    "classificacao",
    "conta",
    "descricao",
    "cta_titulo",
    "valor",
  ];
  const missing = obrig.filter((k) => idx[k] < 0);
  if (missing.length) {
    throw new Error(
      `Cabeçalho inválido. Colunas faltando: ${missing.join(", ")}. Encontrado: ${header.join(", ")}`,
    );
  }

  const warnings: string[] = [];
  const rows: SaldoInicialRow[] = [];
  const seen = new Set<string>();
  let totAtivo = 0;
  let totPassivoPL = 0;
  let participantes = 0;
  let sinteticasIgnoradas = 0;
  let semSaldoIgnoradas = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsv(lines[i]);
    if (cols.length < header.length - 2) continue;

    const ctaTitulo = (cols[idx.cta_titulo] ?? "").trim();
    // Aceita "2-Não", "2 - Não", "Não", "N", "A"
    const ctaTituloNorm = normalizeHeader(ctaTitulo);
    const isAnalitica =
      ctaTituloNorm.startsWith("2") ||
      ctaTituloNorm.startsWith("nao") ||
      ctaTituloNorm === "n" ||
      ctaTituloNorm === "a";
    if (!isAnalitica) {
      sinteticasIgnoradas++;
      continue;
    }

    const classificacao = (cols[idx.classificacao] ?? "").trim();
    const conta = (cols[idx.conta] ?? "").trim();
    const descricao = (cols[idx.descricao] ?? "").trim();
    const tipo = (cols[idx.tipo] ?? "").trim();
    const nivelStr = idx.nivel >= 0 ? (cols[idx.nivel] ?? "").trim() : "";
    const valorRaw = cols[idx.valor] ?? "";
    if (!classificacao || !conta) continue;

    const valorOrigem = parseValorBR(valorRaw);
    if (valorOrigem === 0) {
      semSaldoIgnoradas++;
      continue;
    }

    if (seen.has(conta)) continue;
    seen.add(conta);

    const tipoNorm = tipo.toLowerCase();
    const isPart = TIPOS_PARTICIPANTE.has(tipoNorm);
    if (isPart) participantes++;

    const saldo = saldoPadronizado(valorOrigem, classificacao, mascara);
    const g = grupoDe(classificacao, mascara);
    if (g === "ativo") totAtivo += saldo;
    else if (g === "passivo" || g === "pl") totPassivoPL += -saldo; // mostra como positivo

    rows.push({
      conta_codigo: conta,
      classificacao,
      descricao,
      tipo,
      nivel: Number(nivelStr) || dividir(classificacao, mascara).length,
      is_participante: isPart,
      saldo,
      valor_origem: valorOrigem,
    });
  }

  if (sinteticasIgnoradas > 0)
    warnings.push(`${sinteticasIgnoradas} sintéticas ignoradas (são totalizadoras).`);
  if (semSaldoIgnoradas > 0)
    warnings.push(`${semSaldoIgnoradas} contas com saldo zero foram descartadas.`);

  const diferenca = totAtivo - totPassivoPL;
  const equilibrado = Math.abs(diferenca) < 0.5;

  if (!equilibrado) {
    warnings.push(
      `Balanço não fecha: Ativo=${totAtivo.toFixed(2)}, Passivo+PL=${totPassivoPL.toFixed(2)}, diferença=${diferenca.toFixed(2)}.`,
    );
  }

  return {
    rows,
    total: rows.length,
    total_ativo: totAtivo,
    total_passivo_pl: totPassivoPL,
    diferenca,
    equilibrado,
    encoding,
    warnings,
    participantes,
  };
}
