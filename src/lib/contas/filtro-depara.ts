// Filtro e ordenação da fila de de-para.
//
// Os dois painéis (ECD e plano de contas) mostram a mesma coisa: uma
// lista de contas de origem, cada uma com um destino que pode estar
// pendente, sugerido, confirmado ou ignorado. Antes cada painel tinha a
// sua própria ordenação enterrada num useMemo e nenhum filtro — com 500
// contas isso vira rolagem infinita.
//
// A lógica vive aqui, fora de componente, porque é ela que decide o que
// o usuário vê. Fora do componente, o harness testa; dentro, não.

export type EstadoLinha = "pendente" | "sugerido" | "vinculado" | "ignorado";

export interface LinhaDepara {
  /** Código da conta de ORIGEM (do ECD ou do plano da empresa). */
  codigo: string;
  descricao?: string | null;
  classificacao?: string | null;
  /**
   * O galho da conta em NOMES, da raiz até ela:
   * "ATIVO > ATIVO IMOBILIZADO > MAQUINAS E EQUIPAMENTOS".
   *
   * Existe porque nem todo ECD traz código estrutural. Quando o arquivo
   * numera as contas em sequência (119, 406, 748), a classificação não
   * diz de que galho a conta é — e colar o código do pai no do filho
   * produz "149.150", que não é código de plano nenhum. O caminho por
   * nome diz a mesma coisa que a estrutural diria, e vem do arquivo.
   */
  caminho?: string | null;
  /**
   * A mesma cadeia em CÓDIGOS ("149.150"). Não vai para a tela — serve
   * só para ordenar os grupos na ordem do plano (ativo, passivo, PL,
   * resultado) em vez de alfabética, que separaria "ATIVO CIRCULANTE"
   * de "ATIVO NÃO CIRCULANTE" por causa da letra.
   */
  caminhoCodigos?: string | null;
  /** Magnitude do movimento no período — ordena e filtra. */
  movimento: number;
  /** Conta de destino escolhida, ou null. */
  destino: string | null;
  ignorada: boolean;
  /** O destino atual veio de sugestão automática, ainda não revisada. */
  sugerido?: boolean;
}

/**
 * O vínculo veio de sugestão automática (e portanto ainda não foi
 * conferido por gente)?
 *
 * A única marca disponível é a `observacao` que o banco grava. O teste é
 * por "automática", não por "sugestão": a observação que a conferência
 * em lote grava é "sugestão conferida", e ela precisa SAIR desse estado
 * — se o teste fosse por "sugest", conferir não mudaria nada e o botão
 * pareceria quebrado.
 */
export function veioDeSugestaoAutomatica(observacao?: string | null): boolean {
  return /autom/i.test(observacao ?? "");
}

export function estadoDe(l: LinhaDepara): EstadoLinha {
  if (l.ignorada) return "ignorado";
  if (!l.destino) return "pendente";
  return l.sugerido ? "sugerido" : "vinculado";
}

/** Ordem de urgência: o que trava o "aplicar" primeiro. */
const PRIORIDADE: Record<EstadoLinha, number> = {
  pendente: 0, sugerido: 1, vinculado: 2, ignorado: 3,
};

export type FiltroEstado = "todas" | EstadoLinha | "com-movimento";

export interface Filtros {
  estado?: FiltroEstado;
  busca?: string;
}

const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function casaBusca(l: LinhaDepara, busca: string): boolean {
  const t = norm(busca).trim();
  if (!t) return true;
  // O caminho entra na busca: digitar "imobilizado" acha as contas do
  // galho inteiro, mesmo as que não têm a palavra no próprio nome.
  const alvo = `${norm(l.codigo)} ${norm(l.classificacao)} ${norm(l.descricao)} ` +
    `${norm(l.caminho)} ${norm(l.destino)}`;
  return t.split(/\s+/).every((p) => alvo.includes(p));
}

export function casaEstado(l: LinhaDepara, estado: FiltroEstado): boolean {
  if (estado === "todas") return true;
  // "com movimento" corta em zero absoluto: conta sem movimento no
  // período não atrapalha nada e não precisa de atenção agora.
  if (estado === "com-movimento") return Math.abs(l.movimento) > 0.005;
  return estadoDe(l) === estado;
}

/**
 * Filtra e ordena: pendente antes de sugerido, sugerido antes de
 * confirmado, e dentro de cada grupo o maior movimento primeiro — a
 * conta que mais move dinheiro é a que mais dói errar.
 */
export function filtrarLinhas<T extends LinhaDepara>(
  linhas: T[],
  { estado = "todas", busca = "" }: Filtros = {},
): T[] {
  return linhas
    .filter((l) => casaEstado(l, estado) && casaBusca(l, busca))
    .sort(
      (a, b) =>
        PRIORIDADE[estadoDe(a)] - PRIORIDADE[estadoDe(b)] ||
        Math.abs(b.movimento) - Math.abs(a.movimento) ||
        a.codigo.localeCompare(b.codigo),
    );
}

export interface Contagem {
  todas: number;
  pendente: number;
  sugerido: number;
  vinculado: number;
  ignorado: number;
  "com-movimento": number;
  /** Pendentes QUE TÊM movimento — as que travam o "aplicar". */
  pendenteComMovimento: number;
}

export function contarEstados(linhas: LinhaDepara[]): Contagem {
  const c: Contagem = {
    todas: linhas.length, pendente: 0, sugerido: 0, vinculado: 0, ignorado: 0,
    "com-movimento": 0, pendenteComMovimento: 0,
  };
  for (const l of linhas) {
    const e = estadoDe(l);
    c[e]++;
    const move = Math.abs(l.movimento) > 0.005;
    if (move) c["com-movimento"]++;
    if (e === "pendente" && move) c.pendenteComMovimento++;
  }
  return c;
}

// ---------------------------------------------------------------
// Agrupamento por classificação
// ---------------------------------------------------------------
// A fila de um plano de terceiro é repetitiva por construção: dezenas de
// contas de despesa penduradas no mesmo galho, todas indo para a mesma
// linha do plano padrão. Agrupando pelo prefixo da classificação, esse
// galho inteiro vira UMA decisão.

/** "1.01.01.1.0001" com nível 3 → "1.01.01". */
export function prefixoClassificacao(
  classificacao: string | null | undefined,
  nivel: number,
): string {
  const c = (classificacao ?? "").trim();
  if (!c || nivel <= 0) return "";
  return c.split(".").slice(0, nivel).join(".");
}

/**
 * Agrupa por uma chave qualquer, mantendo a ordem que `filtrarLinhas` já
 * deu dentro de cada grupo. A chave vazia ("") é o resto e vai para o
 * fim — seja "sem classificação", seja "sem conta superior".
 */
export function agruparPorChave<T extends LinhaDepara>(
  linhas: T[],
  chave: (l: T) => string,
  rotulo?: (k: string, l: T) => string,
  /**
   * Por que ordenar por outra coisa que não o rótulo: quando o grupo é
   * um NOME ("ATIVO", "PASSIVO"), a ordem alfabética é a ordem errada —
   * põe DESPESAS antes de PASSIVO e desmonta a leitura do plano. Quem
   * chama pode devolver aqui o código do galho, que ordena certo.
   */
  ordem?: (k: string, l: T) => string,
): GrupoDepara<T>[] {
  const mapa = new Map<string, GrupoDepara<T>>();
  for (const l of linhas) {
    const k = chave(l);
    let g = mapa.get(k);
    if (!g) {
      g = {
        prefixo: rotulo ? rotulo(k, l) : k,
        ordem: ordem ? ordem(k, l) : (rotulo ? rotulo(k, l) : k),
        linhas: [], movimento: 0, pendentes: 0,
      };
      mapa.set(k, g);
    }
    g.linhas.push(l);
    g.movimento += Math.abs(l.movimento);
    if (estadoDe(l) === "pendente") g.pendentes++;
  }
  return [...mapa.values()].sort((a, b) => {
    // O balde do "resto" (chave vazia) vai para o fim, sempre.
    if (!a.prefixo) return 1;
    if (!b.prefixo) return -1;
    return a.ordem.localeCompare(b.ordem, "pt-BR", { numeric: true });
  });
}

export interface GrupoDepara<T extends LinhaDepara> {
  /** Rótulo do grupo na tela; "" = contas sem classificação/galho. */
  prefixo: string;
  /** Chave de ordenação entre grupos — nem sempre igual ao rótulo. */
  ordem: string;
  linhas: T[];
  /** Soma dos movimentos — o peso do galho inteiro. */
  movimento: number;
  pendentes: number;
}

/**
 * Agrupa mantendo a ordem que `filtrarLinhas` já deu dentro de cada
 * grupo. Grupos vêm em ordem de classificação, e o "sem classificação"
 * vai para o fim — ele é o resto, não o começo.
 */
export function agruparPorClassificacao<T extends LinhaDepara>(
  linhas: T[],
  nivel: number,
): GrupoDepara<T>[] {
  return agruparPorChave(linhas, (l) => prefixoClassificacao(l.classificacao, nivel));
}

// ---------------------------------------------------------------
// Agrupamento pelo GALHO (caminho de nomes)
// ---------------------------------------------------------------
// Mesmo desenho do agrupamento por classificação, sobre a outra coluna.
// Vale para o ECD que não traz código estrutural: o galho existe na
// hierarquia do arquivo, só não tem número.

/** O separador que o banco grava em `ecd_conta.caminho_nomes`. */
export const SEP_CAMINHO = " > ";
/** O que aparece na tela — mais leve de ler que ">". */
export const SEP_CAMINHO_TELA = " › ";

export function segmentosCaminho(caminho: string | null | undefined): string[] {
  return (caminho ?? "").split(SEP_CAMINHO).map((s) => s.trim()).filter(Boolean);
}

/**
 * "ATIVO > IMOBILIZADO > MAQUINAS" com nível 2 → "ATIVO > IMOBILIZADO".
 *
 * Uma conta mais rasa que o nível pedido devolve o caminho inteiro em
 * vez de "" — ela tem galho, só tem menos degraus, e mandá-la para o
 * balde "sem galho" esconderia justamente as contas de primeiro nível.
 */
export function prefixoCaminho(
  caminho: string | null | undefined,
  nivel: number,
): string {
  const segs = segmentosCaminho(caminho);
  if (segs.length === 0 || nivel <= 0) return "";
  return segs.slice(0, nivel).join(SEP_CAMINHO);
}

/** O galho SEM a própria conta — o nome dela já é o título da linha. */
export function caminhoSemFolha(caminho: string | null | undefined): string {
  const segs = segmentosCaminho(caminho);
  return segs.length <= 1 ? "" : segs.slice(0, -1).join(SEP_CAMINHO);
}

export function agruparPorCaminho<T extends LinhaDepara>(
  linhas: T[],
  nivel: number,
): GrupoDepara<T>[] {
  return agruparPorChave(
    linhas,
    (l) => prefixoCaminho(l.caminho, nivel),
    (k) => k.split(SEP_CAMINHO).join(SEP_CAMINHO_TELA),
    // Ordena pelos CÓDIGOS do mesmo galho: ativo, passivo, PL, resultado
    // — a ordem do plano, não a do dicionário.
    (_k, l) => prefixoClassificacao(l.caminhoCodigos, nivel) ||
               prefixoCaminho(l.caminho, nivel),
  );
}

/** Quantos degraus o galho mais fundo tem — limita o seletor. */
export function niveisDoCaminho(linhas: LinhaDepara[]): number {
  let max = 0;
  for (const l of linhas) {
    const n = segmentosCaminho(l.caminho).length;
    if (n > max) max = n;
  }
  return max;
}

/** Quantos níveis a classificação mais funda tem — limita o seletor. */
export function niveisDisponiveis(linhas: LinhaDepara[]): number {
  let max = 0;
  for (const l of linhas) {
    const n = (l.classificacao ?? "").trim().split(".").filter(Boolean).length;
    if (n > max) max = n;
  }
  return max;
}

/** Só os filtros que têm alguma linha — botão que não filtra nada some. */
export function filtrosUteis(c: Contagem): { chave: FiltroEstado; rotulo: string; n: number }[] {
  const todos: { chave: FiltroEstado; rotulo: string; n: number }[] = [
    { chave: "todas", rotulo: "Todas", n: c.todas },
    { chave: "pendente", rotulo: "Pendentes", n: c.pendente },
    { chave: "sugerido", rotulo: "Sugeridas", n: c.sugerido },
    { chave: "vinculado", rotulo: "Vinculadas", n: c.vinculado },
    { chave: "ignorado", rotulo: "Ignoradas", n: c.ignorado },
    { chave: "com-movimento", rotulo: "Com movimento", n: c["com-movimento"] },
  ];
  return todos.filter((f) => f.chave === "todas" || f.n > 0);
}
