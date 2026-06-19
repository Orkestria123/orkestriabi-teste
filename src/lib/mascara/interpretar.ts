// Helper para interpretar classificações contábeis conforme a máscara
// configurável do escritório/empresa. Default: separador "." e grupos
// 1=Ativo, 2=Passivo, 3=Despesa, 4=Receita, 5=Resultado.

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

export function interpretarClassificacao(
  classificacao: string,
  mascara: MascaraConfig = MASCARA_DEFAULT,
): ClassificacaoInterpretada {
  const sep = mascara.separador || ".";
  const partes = classificacao.trim().split(sep).filter(Boolean);
  const primeira = partes[0] ?? "";
  const digito = primeira.charAt(0);
  const grupo = (mascara.grupos[digito] ?? "desconhecido") as GrupoContabil;
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
        separador: row.separador || ".",
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
