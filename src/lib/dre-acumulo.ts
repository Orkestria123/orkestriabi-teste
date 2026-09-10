/** Totalizadores da DRE/DFC — mesmo layout da nuvem (bi.orkestria.app.br). */

import { MES_ABBR } from "@/lib/format";

export type Agrupador = "mes" | "trimestre" | "semestre" | "ano" | "selecao";

export const AGRUPADOR_LABEL: Record<Agrupador, string> = {
  mes: "Mês",
  trimestre: "Trimestre",
  semestre: "Semestre",
  ano: "Ano",
  selecao: "Seleção inteira",
};

export const AGRUPADORES: Agrupador[] = [
  "mes",
  "trimestre",
  "semestre",
  "ano",
  "selecao",
];

const ORD = ["1º", "2º", "3º", "4º"];

export type ColunaAgrupada =
  | { kind: "p"; key: string; periodo: string }
  | { kind: "s"; key: string; label: string; banda: string; periodos: string[] };

function anoDe(p: string) {
  return p.slice(0, 4);
}
function mesDe(p: string) {
  return parseInt(p.slice(5, 7), 10);
}

export function ehMultiAno(periodos: string[]): boolean {
  return new Set(periodos.map(anoDe)).size > 1;
}

export function anoCurto(periodo: string): string {
  return anoDe(periodo).slice(2);
}

export interface GrupoMesYoY {
  mes: number;
  rotulo: string;
  periodos: string[];
}

/** Meses lado a lado por ano (Jan/24, Jan/25, Fev/24, Fev/25, …). */
export function gruposMesAnoAAno(periodos: string[]): GrupoMesYoY[] {
  const ordenados = [...periodos].sort();
  const anos = [...new Set(ordenados.map(anoDe))].sort();
  const meses = [...new Set(ordenados.map(mesDe))].sort((a, b) => a - b);
  return meses.map((m) => ({
    mes: m,
    rotulo: MES_ABBR[m - 1] ?? String(m).padStart(2, "0"),
    periodos: anos
      .map((ano) => ordenados.find((p) => anoDe(p) === ano && mesDe(p) === m))
      .filter((p): p is string => !!p),
  }));
}

export function ordenarPeriodosMesAnoAAno(periodos: string[]): string[] {
  if (!ehMultiAno(periodos)) return [...periodos].sort();
  return gruposMesAnoAAno(periodos).flatMap((g) => g.periodos);
}

function grupoDe(p: string, ag: Agrupador): string {
  if (ag === "selecao") return "all";
  const ano = anoDe(p);
  if (ag === "ano") return ano;
  const m = mesDe(p);
  if (ag === "trimestre") return `${ano}-T${Math.ceil(m / 3)}`;
  if (ag === "semestre") return `${ano}-S${Math.ceil(m / 6)}`;
  return `${ano}-${p}`;
}

function rotulosGrupo(
  p: string,
  ag: Agrupador,
  multiAno: boolean,
): { label: string; banda: string } {
  const ano = anoDe(p);
  const m = mesDe(p);
  if (ag === "selecao") return { label: "Total", banda: "Seleção" };
  if (ag === "ano") return { label: `Total ${ano}`, banda: ano };
  if (ag === "trimestre") {
    const i = ORD[Math.ceil(m / 3) - 1];
    return {
      label: multiAno ? `${i} Tri ${ano}` : `${i} Tri`,
      banda: `${i} Trimestre ${ano}`,
    };
  }
  const i = ORD[Math.ceil(m / 6) - 1];
  return {
    label: multiAno ? `${i} Sem ${ano}` : `${i} Sem`,
    banda: `${i} Semestre ${ano}`,
  };
}

export function montarColunas(periods: string[], ag: Agrupador): ColunaAgrupada[] {
  const ordenados =
    ag === "mes" ? ordenarPeriodosMesAnoAAno(periods) : [...periods].sort();
  const cols: ColunaAgrupada[] = [];
  if (ag === "mes") {
    return ordenados.map((p) => ({ kind: "p" as const, key: p, periodo: p }));
  }
  const multiAno = new Set(ordenados.map(anoDe)).size > 1;
  let atual: string | null = null;
  let bucket: string[] = [];
  const fechar = () => {
    if (!atual || bucket.length === 0) return;
    const { label, banda } = rotulosGrupo(bucket[0], ag, multiAno);
    cols.push({ kind: "s", key: `sub:${atual}`, label, banda, periodos: [...bucket] });
    bucket = [];
  };
  for (const p of ordenados) {
    const g = grupoDe(p, ag);
    if (atual !== null && g !== atual) fechar();
    atual = g;
    bucket.push(p);
    cols.push({ kind: "p", key: p, periodo: p });
  }
  fechar();
  return cols;
}

/** Subtotal: soma nos fluxos (DRE/DFC), saldo do último mês no Balanço. */
export function valorSubtotal(
  valores: Record<string, number> | undefined,
  periodos: string[],
  variante: "dre" | "bp" | "dfc",
): number {
  if (!valores) return 0;
  if (variante === "bp") {
    const ultimo = periodos[periodos.length - 1];
    return Number(valores[ultimo] ?? 0) || 0;
  }
  return periodos.reduce((acc, p) => acc + (Number(valores[p] ?? 0) || 0), 0);
}
