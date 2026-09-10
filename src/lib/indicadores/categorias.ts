/** Ordem das seções na aba Indicadores (e listas de admin). */
export const ORDEM_CATEGORIAS = [
  "Rentabilidade",
  "Liquidez",
  "Atividade",
  "Endividamento",
] as const;

export const CATEGORIAS_INDICADOR = [
  ...ORDEM_CATEGORIAS,
  "Personalizado",
] as const;

export function compararCategoria(a: string, b: string): number {
  const rank = (c: string) => {
    const i = ORDEM_CATEGORIAS.indexOf(c as (typeof ORDEM_CATEGORIAS)[number]);
    if (i >= 0) return i;
    if (!c || c === "Personalizado") return 100;
    return 50;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b, "pt-BR");
}
