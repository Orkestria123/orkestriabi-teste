// Classificação de custo (fixo / variável) por conta do plano.
//
// O tipo é gravado em `plano_contas.tipo_custo`. Nem toda conta analítica
// recebe a marcação: o normal é marcar a sintética do grupo e deixar as
// folhas herdarem. Por isso a resolução é por PREFIXO MAIS LONGO — a
// mesma regra usada no de-para e na DFC.

export type TipoCusto = "fixo" | "variavel";

export interface ContaTipoCusto {
  classificacao: string;
  tipo_custo?: string | null;
}

/** Contas de custo/despesa são as do grupo 3 (resultado, lado do gasto). */
export function ehContaDeCustoDespesa(classificacao: string | null | undefined): boolean {
  if (!classificacao) return false;
  const raiz = String(classificacao).split(/[.\-/]/)[0] ?? "";
  return raiz.charAt(0) === "3";
}

/**
 * Tipo de custo em vigor para uma classificação: o da própria conta e,
 * na falta dele, o da sintética mais próxima acima.
 */
export function tipoCustoEfetivo(
  classificacao: string | null | undefined,
  plano: ContaTipoCusto[] | null | undefined,
): TipoCusto | null {
  if (!classificacao || !plano || plano.length === 0) return null;
  const alvo = String(classificacao);
  let melhor: { len: number; tipo: TipoCusto } | null = null;
  for (const c of plano) {
    const t = c.tipo_custo;
    if (t !== "fixo" && t !== "variavel") continue;
    const cls = String(c.classificacao ?? "");
    if (!cls) continue;
    const casa = alvo === cls || alvo.startsWith(cls + ".");
    if (!casa) continue;
    if (!melhor || cls.length > melhor.len) melhor = { len: cls.length, tipo: t };
  }
  return melhor?.tipo ?? null;
}
