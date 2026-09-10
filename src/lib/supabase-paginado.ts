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
//     as do ECD entram por último);
//   · o tradutor de de-para montar o mapa só com as 1000 primeiras
//     contas — as demais viravam código não encontrado e o SALDO DELAS
//     SUMIA da demonstração, calado;
//   · a fila de vínculo do ECD mostrar parte das contas e travar o
//     "aplicar" por contas que já estavam vinculadas.
//
// Nenhum desses aparece como erro. Por isso a regra aqui é: toda leitura
// que pode passar de 1000 linhas passa por este arquivo.
//
// `.range(0, 5000)` NÃO resolve: o PostgREST aplica
// `LIMIT min(pedido, max_rows)`. Só paginando de verdade.

/** O teto do servidor. Se mudar em config.toml, muda aqui. */
export const PAGINA = 1000;

/**
 * Lê tudo, de mil em mil.
 *
 * `build(de, ate)` monta a consulta já com `.range(de, ate)`. O laço
 * para quando uma página vem menor que o tamanho pedido.
 *
 * O teto de 500 páginas (500 mil linhas) é rede de segurança contra um
 * filtro que não filtra: melhor parar do que travar o navegador.
 */
export async function lerTudo<T>(
  build: (de: number, ate: number) => any,
  rotulo = "consulta",
): Promise<T[]> {
  const out: T[] = [];
  let de = 0;
  for (let i = 0; i < 500; i++) {
    const { data, error } = await build(de, de + PAGINA - 1);
    if (error) throw error;
    const linhas = (data ?? []) as T[];
    out.push(...linhas);
    if (linhas.length < PAGINA) return out;
    de += PAGINA;
  }
  // Chegar aqui é defeito, não caso de uso. Falar alto é melhor do que
  // devolver meio milhão de linhas fingindo que é o total.
  console.warn(
    `[paginacao] ${rotulo}: parei em ${out.length} linhas (500 páginas). ` +
    "Provavelmente falta um filtro.",
  );
  return out;
}
