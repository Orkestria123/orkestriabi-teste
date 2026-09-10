// Layout de arquivo de um SISTEMA contábil.
//
// O ERP exporta dezenas de colunas. O JSON gravado diz QUAIS posições
// o BI guarda (`#3` = terceira coluna). O resto do arquivo não entra.
// Toda linha é lançamento analítico; sintéticas vêm da máscara.

export const HISTORICO_MAX_CHARS = 400;

export type GrupoCampoLayout = "conta" | "lancamento";

export const CAMPOS_LAYOUT = [
  { id: "classificacao", rotulo: "Classificação", obrigatorio: true, grupo: "conta" as const },
  { id: "conta", rotulo: "Conta (reduzido)", obrigatorio: true, grupo: "conta" as const },
  { id: "descricao", rotulo: "Nome da conta", obrigatorio: true, grupo: "conta" as const },
  { id: "valor", rotulo: "Valor / saldo", obrigatorio: false, grupo: "conta" as const },
  { id: "data", rotulo: "Data do lançamento", obrigatorio: false, grupo: "lancamento" as const },
  { id: "debito", rotulo: "Débito", obrigatorio: false, grupo: "lancamento" as const },
  { id: "credito", rotulo: "Crédito", obrigatorio: false, grupo: "lancamento" as const },
  { id: "historico", rotulo: "Histórico do lançamento", obrigatorio: false, grupo: "lancamento" as const },
  { id: "numero", rotulo: "Nº lançamento", obrigatorio: false, grupo: "lancamento" as const },
  { id: "sub", rotulo: "Subconta", obrigatorio: false, grupo: "lancamento" as const },
] as const;

export type CampoLayoutId = (typeof CAMPOS_LAYOUT)[number]["id"];

export interface LayoutImportacao {
  /** 1-based. 0 quando o arquivo não tem linha de cabeçalho. */
  linha_cabecalho: number;
  /** false = todas as linhas são dado; colunas gravadas por posição (#1, #2…). */
  tem_cabecalho: boolean;
  colunas: Partial<Record<CampoLayoutId, string>>;
}

export const LAYOUT_VAZIO: LayoutImportacao = {
  linha_cabecalho: 0,
  tem_cabecalho: false,
  colunas: {},
};

const ALIASES: Record<CampoLayoutId, string[]> = {
  classificacao: ["classificacao", "classificação", "classificacao contabil"],
  conta: ["conta", "codigo", "código", "cod conta", "codigo conta", "reduzido"],
  descricao: [
    "nome da conta contabil/c. custo",
    "nome da conta contabil/c custo",
    "nome da conta contabil",
    "nome da conta contábil/c. custo",
    "nome da conta",
    "nome conta",
    "nome",
    "descricao",
    "descrição",
  ],
  valor: ["valor", "saldo", "saldo atual", "vl saldo"],
  data: ["data", "dt lancamento", "data lancamento", "dt lcto", "data lcto"],
  debito: ["debito", "débito", "deb", "vl debito", "valor debito"],
  credito: ["credito", "crédito", "cred", "vl credito", "valor credito"],
  historico: [
    "historico", "histórico", "complemento", "hist",
    "historico lancamento", "histórico do lançamento", "descricao lancamento",
  ],
  numero: [
    "lancamento", "nr lancto", "no lancto erp", "n lancto erp",
    "num lancamento", "no. lancto erp", "numero", "n lancamento",
  ],
  sub: ["sub", "subconta", "sub conta", "sub-conta"],
};

export function normalizarCabecalho(h: string): string {
  return (h ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** `#3` ou `Coluna 3` → 3 (1-based). */
export function parsePosicaoColuna(ref: string | undefined): number | null {
  if (!ref) return null;
  const t = String(ref).trim();
  const m = /^#(\d+)$/.exec(t) || /^coluna\s+(\d+)$/i.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export function tokenPosicao(indice0: number): string {
  return `#${indice0 + 1}`;
}

export function rotuloRefColuna(ref: string): string {
  const p = parsePosicaoColuna(ref);
  return p != null ? `Coluna ${p}` : ref;
}

export function indiceDaColuna(headers: string[], ref: string | undefined): number {
  if (!ref) return -1;
  const pos = parsePosicaoColuna(ref);
  if (pos != null) return pos - 1;
  const alvo = normalizarCabecalho(ref);
  return headers.findIndex((h) => normalizarCabecalho(h) === alvo);
}

/** Índices 0-based das colunas que o layout usa — o resto do arquivo descarta. */
export function indicesDoLayout(layout: LayoutImportacao): number[] {
  const set = new Set<number>();
  for (const ref of Object.values(layout.colunas)) {
    const p = parsePosicaoColuna(ref);
    if (p != null) set.add(p - 1);
  }
  return [...set].sort((a, b) => a - b);
}

export function truncarHistorico(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (s.length <= HISTORICO_MAX_CHARS) return s;
  return s.slice(0, HISTORICO_MAX_CHARS).trimEnd();
}

/** Primeira linha parece título de coluna, ou já é dado (código/valor)? */
export function pareceLinhaDeCabecalho(row: string[]): boolean {
  const cells = (row ?? []).map((c) => (c ?? "").trim()).filter(Boolean);
  if (cells.length === 0) return false;
  const aliases = new Set(Object.values(ALIASES).flat().map(normalizarCabecalho));
  const hits = cells.filter((c) => aliases.has(normalizarCabecalho(c))).length;
  return hits >= 2;
}

function refDeValor(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 1) return tokenPosicao(Math.floor(v) - 1);
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

export function layoutDeJson(raw: unknown): LayoutImportacao {
  const o = (raw ?? {}) as any;
  const colunas: LayoutImportacao["colunas"] = {};
  const src = o.colunas && typeof o.colunas === "object" ? o.colunas : {};
  const legado: Record<string, CampoLayoutId> = {
    codigo: "conta",
    reduzido: "conta",
    nome: "descricao",
  };
  for (const c of CAMPOS_LAYOUT) {
    const ref = refDeValor(src[c.id]);
    if (ref) colunas[c.id] = ref;
  }
  for (const [antigo, id] of Object.entries(legado)) {
    if (colunas[id]) continue;
    const ref = refDeValor(src[antigo]);
    if (ref) colunas[id] = ref;
  }
  const refs = Object.values(colunas);
  const todosPosicao = refs.length > 0 && refs.every((r) => parsePosicaoColuna(r) != null);
  const temNomeCab = refs.some((r) => parsePosicaoColuna(r) == null);
  const linha = Number(o.linha_cabecalho);
  const temCabecalho =
    o.tem_cabecalho === true || temNomeCab
      ? o.tem_cabecalho !== false
      : !(o.tem_cabecalho === false || linha === 0 || todosPosicao || refs.length === 0);
  return {
    tem_cabecalho: temCabecalho,
    linha_cabecalho: temCabecalho
      ? (Number.isFinite(linha) && linha >= 1 ? Math.floor(linha) : 1)
      : 0,
    colunas,
  };
}

export function sugerirColunas(headers: string[]): LayoutImportacao["colunas"] {
  const norm = headers.map(normalizarCabecalho);
  const colunas: LayoutImportacao["colunas"] = {};
  const usados = new Set<number>();
  for (const campo of CAMPOS_LAYOUT) {
    for (const alias of ALIASES[campo.id]) {
      const i = norm.findIndex((h, idx) => !usados.has(idx) && h === alias);
      if (i >= 0) {
        colunas[campo.id] = headers[i];
        usados.add(i);
        break;
      }
    }
  }
  return colunas;
}

export function layoutPronto(layout: LayoutImportacao): string[] {
  return CAMPOS_LAYOUT
    .filter((c) => c.obrigatorio)
    .map((c) => c.id)
    .filter((id) => !layout.colunas[id]);
}

/** Campos do diário já atribuídos (não bloqueiam gravar o layout). */
export function camposDiarioFaltando(layout: LayoutImportacao): string[] {
  const ids: CampoLayoutId[] = ["data", "debito", "credito", "historico"];
  return CAMPOS_LAYOUT
    .filter((c) => (ids as readonly string[]).includes(c.id) && !layout.colunas[c.id])
    .map((c) => c.rotulo);
}

export function refAindaVale(ref: string, nColunas: number, headers: string[]): boolean {
  const pos = parsePosicaoColuna(ref);
  if (pos != null) return pos <= nColunas;
  const alvo = normalizarCabecalho(ref);
  return headers.some((h) => normalizarCabecalho(h) === alvo);
}

/** Grava sempre `#N` — o texto da 1ª linha muda todo mês; a posição não. */
export function refsParaPosicao(
  colunas: LayoutImportacao["colunas"],
  headers: string[],
): LayoutImportacao["colunas"] {
  const out: LayoutImportacao["colunas"] = {};
  for (const c of CAMPOS_LAYOUT) {
    const ref = colunas[c.id];
    if (!ref) continue;
    const pos = parsePosicaoColuna(ref);
    if (pos != null) {
      if (pos <= headers.length) out[c.id] = tokenPosicao(pos - 1);
      continue;
    }
    const i = indiceDaColuna(headers, ref);
    if (i >= 0) out[c.id] = tokenPosicao(i);
  }
  return out;
}
