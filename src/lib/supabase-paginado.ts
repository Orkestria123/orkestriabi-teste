// Leitura paginada do PostgREST — e por que ela precisa existir.
//
// `supabase/config.toml` define `max_rows = 1000`. Isso significa que
// QUALQUER consulta sem paginação devolve no máximo 1000 linhas — sem
// erro, sem aviso, sem nada no objeto de resposta que diga que faltou
// coisa. O código recebe um array de 1000 e segue como se fosse tudo.
//
// Isso já causou, neste projeto:
//
//   · os meses trazidos por um ECD nunca aparecerem no seletor de
//     período do BI (`saldos_mensais` tem uma linha por conta × mês, e
//     as linhas gravadas por um ECD, que entram DEPOIS das do diário,
//     ficavam fora do corte);
//   · o tradutor de de-para montar o mapa só com as 1.000 primeiras
//     contas — as demais viravam código não encontrado e o SALDO DELAS
//     SUMIA da demonstração, calado;
//   · DRE/Balanço/Fluxo "às vezes" fecharem errado: paginação SEM
//     ORDER BY (OFFSET sobre heap instável) + consulta que quebra no
//     meio e o motor segue com metade das linhas.
//
// `.range(0, 5000)` NÃO resolve: o PostgREST aplica
// `LIMIT min(pedido, max_rows)`. Só paginando de verdade.
//
// Quem chama TEM que ordenar por chave única (ex.: conta_codigo,
// competencia). Sem isso o OFFSET pula e repete linhas entre páginas.
// Na primeira página, passar `{ count: "exact" }` no select — daí
// conferimos se veio o total, em vez de montar demonstração pela metade.

/** O teto do servidor. Se mudar em config.toml, muda aqui. */
export const PAGINA = 1000;

/** Primeira página pede o total; as outras não pagam o COUNT de novo. */
export function countNaPrimeira(de: number): { count?: "exact" } {
  return de === 0 ? { count: "exact" } : {};
}

function ehAbortado(err: unknown): boolean {
  const e = err as { name?: string; message?: string; code?: string } | null;
  const msg = `${e?.name ?? ""} ${e?.message ?? ""}`.toLowerCase();
  return msg.includes("abort") || e?.code === "20" || msg.includes("cancel");
}

const CONCORRENCIA = 4;

/**
 * Lê tudo, de mil em mil.
 *
 * `build(de, ate)` monta a consulta já com `.range(de, ate)` e, na
 * primeira página, `{ count: "exact" }` via `countNaPrimeira(de)`.
 *
 * Se o servidor disser que existem N linhas e vieram menos, isso é
 * falha — não um total "quase certo".
 *
 * Depois da primeira página (que traz o COUNT), as demais sobem em
 * paralelo — na nuvem a latência por round-trip importa mais que o
 * tamanho da página.
 */
export async function lerTudo<T>(
  build: (de: number, ate: number) => any,
  rotulo = "consulta",
): Promise<T[]> {
  const first = await build(0, PAGINA - 1);
  if (first.error) {
    if (ehAbortado(first.error)) throw first.error;
    throw first.error;
  }
  const firstRows = (first.data ?? []) as T[];
  const esperado = typeof first.count === "number" ? first.count : null;

  if (firstRows.length < PAGINA) {
    if (esperado != null && firstRows.length !== esperado) {
      throw new Error(
        `${rotulo}: a consulta cortou no meio (${firstRows.length} de ${esperado} linhas). Recarregue a tela.`,
      );
    }
    return firstRows;
  }

  if (esperado == null) {
    const out = [...firstRows];
    let de = PAGINA;
    for (let i = 1; i < 500; i++) {
      const res = await build(de, de + PAGINA - 1);
      if (res.error) {
        if (ehAbortado(res.error)) throw res.error;
        throw res.error;
      }
      const linhas = (res.data ?? []) as T[];
      out.push(...linhas);
      if (linhas.length < PAGINA) return out;
      de += PAGINA;
    }
    throw new Error(
      `${rotulo}: parei em ${out.length} linhas (teto de segurança). Falta um filtro.`,
    );
  }

  const nPaginas = Math.ceil(esperado / PAGINA);
  const resto: T[][] = Array.from({ length: nPaginas - 1 }, () => []);
  for (let i = 1; i < nPaginas; i += CONCORRENCIA) {
    const lote: Promise<{ j: number; res: any }>[] = [];
    for (let j = i; j < Math.min(i + CONCORRENCIA, nPaginas); j++) {
      const de = j * PAGINA;
      lote.push(Promise.resolve(build(de, de + PAGINA - 1)).then((res: any) => ({ j, res })));
    }
    const done = await Promise.all(lote);
    for (const { j, res } of done) {
      if (res.error) {
        if (ehAbortado(res.error)) throw res.error;
        throw res.error;
      }
      resto[j - 1] = (res.data ?? []) as T[];
    }
  }
  const out = [...firstRows, ...resto.flat()];
  if (out.length !== esperado) {
    throw new Error(
      `${rotulo}: a consulta cortou no meio (${out.length} de ${esperado} linhas). Recarregue a tela.`,
    );
  }
  return out;
}

/**
 * RPC com teto de 1.000 linhas (PostgREST). Avança pela última chave
 * em vez de OFFSET, para o banco não remontar a consulta inteira a
 * cada página.
 */
export async function lerRpcKeyset<T extends Record<string, unknown>>(
  chave: keyof T & string,
  pagina: (depois: string | null) => Promise<{ data: T[] | null; error: any }>,
  rotulo = "rpc",
): Promise<T[]> {
  const out: T[] = [];
  let depois: string | null = null;
  for (let i = 0; i < 500; i++) {
    const { data, error } = await pagina(depois);
    if (error) {
      if (ehAbortado(error)) throw error;
      throw error;
    }
    const linhas = data ?? [];
    out.push(...linhas);
    if (linhas.length < PAGINA) return out;
    const last = linhas[linhas.length - 1]?.[chave];
    if (last == null || last === "") {
      throw new Error(`${rotulo}: página sem chave para continuar.`);
    }
    depois = String(last);
  }
  throw new Error(
    `${rotulo}: parei em ${out.length} linhas (teto de segurança). Falta um filtro.`,
  );
}
