/**
 * Expandir / recolher em listas hierárquicas achatadas (nível por linha).
 *
 * Mesma lógica que a DRE/Balanço usam na `statement-table`, aqui isolada
 * para poder ser reaproveitada em outras tabelas (Análise › Comparativo)
 * sem duplicar as regras de "camada", "padrão" e "um nível".
 *
 * As linhas são identificadas pelo ÍNDICE no array — as tabelas que usam
 * isto montam o array inteiro de uma vez e só escondem linhas na renderização.
 */

export interface LinhaHierarquica {
  nivel: number;
}

export function filhosDiretos(rows: LinhaHierarquica[], index: number): number[] {
  const nivel = rows[index].nivel;
  const filhos: number[] = [];
  let nivelFilho: number | null = null;
  for (let i = index + 1; i < rows.length; i++) {
    if (rows[i].nivel <= nivel) break;
    if (nivelFilho === null) nivelFilho = rows[i].nivel;
    if (rows[i].nivel === nivelFilho) filhos.push(i);
  }
  return filhos;
}

export function indiceDoPai(rows: LinhaHierarquica[], index: number): number {
  const nivel = rows[index].nivel;
  for (let i = index - 1; i >= 0; i--) {
    if (rows[i].nivel < nivel) return i;
  }
  return -1;
}

export function linhaVisivel(
  rows: LinhaHierarquica[],
  index: number,
  abertos: Set<number>,
): boolean {
  let i = indiceDoPai(rows, index);
  while (i >= 0) {
    if (!abertos.has(i)) return false;
    i = indiceDoPai(rows, i);
  }
  return true;
}

export function indicesComFilhos(rows: LinhaHierarquica[]): number[] {
  const out: number[] = [];
  rows.forEach((_, i) => {
    if (filhosDiretos(rows, i).length > 0) out.push(i);
  });
  return out;
}

export function expandirAteNivel(rows: LinhaHierarquica[], nivelMax: number): Set<number> {
  const set = new Set<number>();
  rows.forEach((row, i) => {
    if (filhosDiretos(rows, i).length === 0) return;
    if (row.nivel <= nivelMax) set.add(i);
  });
  return set;
}

/** Abre só os pais já visíveis e ainda fechados — uma camada, mesmo se o nível pular. */
export function expandirUmaCamada(rows: LinhaHierarquica[], abertos: Set<number>): Set<number> {
  const next = new Set(abertos);
  rows.forEach((_, i) => {
    if (filhosDiretos(rows, i).length === 0) return;
    if (next.has(i)) return;
    if (!linhaVisivel(rows, i, abertos)) return;
    next.add(i);
  });
  return next;
}

export function nivelAbertoMaximo(rows: LinhaHierarquica[], abertos: Set<number>): number {
  let m = -1;
  rows.forEach((row, i) => {
    if (filhosDiretos(rows, i).length === 0) return;
    if (abertos.has(i)) m = Math.max(m, row.nivel);
  });
  return m;
}

export function mesmoConjunto(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export type ModoExpandir = "padrao" | "tudo" | "recolher" | "livre";

export function modoExpandirAtual(
  rows: LinhaHierarquica[],
  abertos: Set<number>,
  padraoMaxNivel: number,
): ModoExpandir {
  if (abertos.size === 0) return "recolher";
  const padrao = expandirAteNivel(rows, padraoMaxNivel);
  if (mesmoConjunto(abertos, padrao)) return "padrao";
  const todos = indicesComFilhos(rows);
  if (todos.length > 0 && todos.every((i) => abertos.has(i))) return "tudo";
  return "livre";
}
