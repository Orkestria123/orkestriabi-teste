// Busca de conta de destino — o miolo do seletor.
//
// O plano do escritório tem 135 mil contas, das quais ~950 são destino
// possível de um de-para (as da ESTRUTURA; cliente e fornecedor entram
// pela conta agregadora). 950 cabem na memória do navegador, então a
// busca é local e instantânea: sem ida ao servidor a cada tecla, sem
// exigir 3 caracteres, sem "carregando".
//
// A ordem importa mais do que parece. Quem digita "1.01" quer a conta
// cuja CLASSIFICAÇÃO começa com 1.01, não a décima conta que por acaso
// tem "101" no meio do nome. Por isso o resultado é ranqueado, e o
// ranqueamento é testado.

export interface ContaDestino {
  codigo: string;
  classificacao: string | null;
  descricao: string | null;
  tipo?: string | null;
  /**
   * Quantas contas de cliente/fornecedor esta linha representa.
   *
   * Só as agregadoras têm isto. Serve para a escolha ser informada:
   * apontar 300 contas de fornecedor de um ECD para uma linha só é a
   * decisão certa, mas quem escolhe precisa ver que aquela linha
   * responde por 84 mil contas do plano — e não é só mais uma conta com
   * nome parecido.
   */
  participantes?: number | null;
  /**
   * Onde esta conta cai na demonstração:
   * "Ativo > Circulante > Disponível". É a resposta para "em qual grupo
   * estou alocando" — escolher um código de 950 numa lista não diz nada
   * sobre onde o dinheiro vai parar.
   */
  galho?: string | null;
  /** 1-Ativo | 2-Passivo | 3-DRE — para o selo de cor. */
  demonstracao?: string | null;
  /** Código da DFC que esta classificação resolve, e o nome dele. */
  dfc?: string | null;
  dfcDescricao?: string | null;
}

/** Sem acento, minúsculo, espaços colapsados. */
export function normalizar(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Só dígitos e pontos — para comparar código com classificação. */
const soNumero = (s: string) => s.replace(/[^0-9.]/g, "");

/**
 * Nota de relevância: menor é melhor, `null` = não casa.
 *
 * A escala é deliberadamente grosseira (0 a 5) e o desempate é pela
 * classificação, para o resultado ser estável — a mesma busca devolve
 * sempre a mesma ordem, e não um ranking que "dança" a cada digitação.
 */
export function pontuarConta(c: ContaDestino, termo: string): number | null {
  const t = normalizar(termo);
  if (!t) return 3;

  const cod = normalizar(c.codigo);
  const cls = normalizar(c.classificacao);
  const desc = normalizar(c.descricao);
  const alvo = `${cod} ${cls} ${desc}`;

  // Todo pedaço do que foi digitado precisa aparecer em algum lugar.
  // "banco itau" acha "BANCO ITAU S/A" e também "ITAU — CONTA BANCO".
  const partes = t.split(" ").filter(Boolean);
  if (!partes.every((p) => alvo.includes(p))) return null;

  const tn = soNumero(t);
  if (cod === t || cls === t) return 0;
  if (tn && (soNumero(cls).startsWith(tn) || soNumero(cod).startsWith(tn))) return 1;
  if (cod.startsWith(t) || cls.startsWith(t)) return 1;
  if (desc.startsWith(t)) return 2;
  // Começo de palavra: "dupl" acha "DUPLICATAS A RECEBER".
  if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(desc)) return 3;
  if (desc.includes(t)) return 4;
  return 5;
}

export interface OpcoesBusca {
  /** Quantas devolver. O seletor não precisa desenhar 950 linhas. */
  limite?: number;
  /** Restringe ao mesmo tipo (1-Ativo, 3-DRE…). `null`/ausente = todas. */
  tipo?: string | null;
}

/**
 * Filtra e ranqueia. Devolve no máximo `limite` (padrão 50) — o corte é
 * do fim da lista, ou seja, só perde resultado pior que os mostrados.
 */
export function filtrarDestinos(
  lista: ContaDestino[],
  termo: string,
  opts: OpcoesBusca = {},
): ContaDestino[] {
  const { limite = 50, tipo } = opts;
  const base = tipo ? lista.filter((c) => c.tipo === tipo) : lista;
  const comNota: { c: ContaDestino; nota: number }[] = [];
  for (const c of base) {
    const nota = pontuarConta(c, termo);
    if (nota != null) comNota.push({ c, nota });
  }
  comNota.sort(
    (a, b) =>
      a.nota - b.nota ||
      normalizar(a.c.classificacao).localeCompare(normalizar(b.c.classificacao)) ||
      normalizar(a.c.codigo).localeCompare(normalizar(b.c.codigo)),
  );
  return comNota.slice(0, limite).map((x) => x.c);
}

/** Quantas casariam no total — para dizer "mostrando 50 de 312". */
export function contarDestinos(
  lista: ContaDestino[],
  termo: string,
  opts: OpcoesBusca = {},
): number {
  const base = opts.tipo ? lista.filter((c) => c.tipo === opts.tipo) : lista;
  let n = 0;
  for (const c of base) if (pontuarConta(c, termo) != null) n++;
  return n;
}

/** Rótulo curto e estável de uma conta, para caber numa linha. */
export function rotuloConta(c: ContaDestino | null | undefined): string {
  if (!c) return "";
  const cls = c.classificacao ? `${c.classificacao} · ` : "";
  return `${cls}${c.descricao ?? c.codigo}`;
}
