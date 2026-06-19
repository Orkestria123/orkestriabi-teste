// Helper para interpretar classificações contábeis conforme a máscara
// configurável do escritório/empresa. Default: separador "." e grupos
// 1=Ativo, 2=Passivo, 3=Despesa, 4=Receita, 5=Resultado.
//
// Estes helpers substituem `.split(".")`, `.startsWith(p + ".")` e
// `charAt(0)` espalhados pelo código, permitindo que o contador troque
// o separador (".", "-", "/" ou largura fixa) sem reprogramar.

import { supabase } from "@/integrations/supabase/client";

export type GrupoContabil =
  | "ativo"
  | "passivo"
  | "pl"
  | "despesa"
  | "receita"
  | "resultado"
  | "desconhecido";

export interface NivelMascara {
  nome: string;
  tamanho?: number;
}

export interface MascaraConfig {
  separador: string;
  niveis: NivelMascara[];
  /** map: dígito do 1º nível → grupo */
  grupos: Record<string, GrupoContabil>;
  /** larguras para máscaras sem separador (ex: "10101" → [1,2,2]) */
  larguras?: number[];
}

export const MASCARA_DEFAULT: MascaraConfig = {
  separador: ".",
  niveis: [
    { nome: "Grupo" },
    { nome: "Subgrupo" },
    { nome: "Conta" },
    { nome: "Subconta" },
    { nome: "Analítica" },
  ],
  grupos: {
    "1": "ativo",
    "2": "passivo",
    "3": "despesa",
    "4": "receita",
    "5": "resultado",
  },
};

export interface ClassificacaoInterpretada {
  classificacao: string;
  partes: string[];
  nivel: number;
  grupo: GrupoContabil;
  /** rótulo de cada parte conforme a máscara */
  rotulos: { nome: string; valor: string }[];
}

// =====================================================================
// Utilitários puros — toda a lógica de hierarquia passa por aqui.
// =====================================================================

/** Divide a classificação em partes conforme a máscara. */
export function dividir(classificacao: string, m: MascaraConfig = MASCARA_DEFAULT): string[] {
  const s = (classificacao ?? "").trim();
  if (!s) return [];
  if (m.separador) return s.split(m.separador).filter(Boolean);
  // largura fixa
  const larguras = m.larguras ?? [];
  if (larguras.length === 0) return [s];
  const out: string[] = [];
  let pos = 0;
  for (const w of larguras) {
    if (pos >= s.length) break;
    out.push(s.slice(pos, pos + w));
    pos += w;
  }
  if (pos < s.length) out.push(s.slice(pos));
  return out;
}

/** Junta partes usando o separador da máscara (vazio se largura fixa). */
export function juntar(partes: string[], m: MascaraConfig = MASCARA_DEFAULT): string {
  return partes.join(m.separador || "");
}

/** Prefixo até `n` níveis (1-indexado). */
export function prefixoAteNivel(
  classificacao: string,
  n: number,
  m: MascaraConfig = MASCARA_DEFAULT,
): string {
  const partes = dividir(classificacao, m);
  if (n >= partes.length) return classificacao;
  return juntar(partes.slice(0, n), m);
}

/** Classificação do pai imediato (null se for raiz). */
export function paiDe(
  classificacao: string,
  m: MascaraConfig = MASCARA_DEFAULT,
): string | null {
  const partes = dividir(classificacao, m);
  if (partes.length <= 1) return null;
  return juntar(partes.slice(0, -1), m);
}

/** Quantos níveis tem essa classificação. */
export function nivelDe(classificacao: string, m: MascaraConfig = MASCARA_DEFAULT): number {
  return dividir(classificacao, m).length;
}

/**
 * `filho` é a própria `ancestral` OU está dentro dela na árvore.
 * Substitui `c === p || c.startsWith(p + ".")` com suporte a qualquer separador.
 */
export function descendeDe(
  filho: string,
  ancestral: string,
  m: MascaraConfig = MASCARA_DEFAULT,
): boolean {
  if (!filho || !ancestral) return false;
  if (filho === ancestral) return true;
  if (m.separador) return filho.startsWith(ancestral + m.separador);
  // largura fixa: o filho deve começar com ancestral e ter mais partes
  return filho.startsWith(ancestral) && filho.length > ancestral.length;
}

/** Grupo contábil derivado da primeira parte da classificação. */
export function grupoDe(
  classificacao: string,
  m: MascaraConfig = MASCARA_DEFAULT,
): GrupoContabil {
  const partes = dividir(classificacao, m);
  const primeira = partes[0] ?? "";
  const chave = primeira; // tenta primeiro casar a parte inteira ("1", "10")
  if (m.grupos[chave]) return m.grupos[chave];
  const digito = primeira.charAt(0);
  return m.grupos[digito] ?? "desconhecido";
}

export function interpretarClassificacao(
  classificacao: string,
  mascara: MascaraConfig = MASCARA_DEFAULT,
): ClassificacaoInterpretada {
  const partes = dividir(classificacao, mascara);
  const grupo = grupoDe(classificacao, mascara);
  const rotulos = partes.map((valor, i) => ({
    nome: mascara.niveis[i]?.nome ?? `Nível ${i + 1}`,
    valor,
  }));
  return { classificacao, partes, nivel: partes.length, grupo, rotulos };
}

/** Sinal de exibição do saldo inicial: Ativo mantém, Passivo/PL invertem. */
export function sinalSaldoInicial(grupo: GrupoContabil, valor: number): number {
  if (grupo === "passivo" || grupo === "pl") return -valor;
  return valor;
}

// ----- carregamento da config -----

const cache = new Map<string, MascaraConfig>();

export async function getMascaraConfig(opts: {
  tenantId: string;
  companyId?: string | null;
}): Promise<MascaraConfig> {
  const key = `${opts.tenantId}::${opts.companyId ?? ""}`;
  const cached = cache.get(key);
  if (cached) return cached;

  // tenta config da empresa; cai para config do tenant; cai para default
  const { data } = await supabase
    .from("mascara_classificacao" as any)
    .select("separador, niveis, grupos, company_id")
    .eq("tenant_id", opts.tenantId);

  const rows = (data ?? []) as any[];
  const empresaRow = opts.companyId
    ? rows.find((r) => r.company_id === opts.companyId)
    : null;
  const tenantRow = rows.find((r) => r.company_id == null);
  const row = empresaRow ?? tenantRow;

  const cfg: MascaraConfig = row
    ? {
        separador: row.separador ?? ".",
        niveis: (row.niveis as NivelMascara[]) ?? MASCARA_DEFAULT.niveis,
        grupos: (row.grupos as Record<string, GrupoContabil>) ?? MASCARA_DEFAULT.grupos,
      }
    : MASCARA_DEFAULT;
  cache.set(key, cfg);
  return cfg;
}

export function invalidarCacheMascara() {
  cache.clear();
}
