// Bases da análise vertical (AV%).
//
// Na DRE a AV% tem DUAS leituras legítimas, e as duas são usadas na
// prática: "quanto isto pesa no faturamento" (sobre a Receita Bruta) e
// "quanto isto pesa no que sobrou depois dos impostos" (sobre a Receita
// Líquida). A tabela mostrava só uma; quem quisesse a outra calculava na
// mão. Agora saem as duas, lado a lado.
//
// No Balanço continua uma base só (Total do Ativo / do Passivo), que é a
// única leitura que faz sentido lá.
//
// Isto vive fora do componente de propósito: assim o harness testa a
// escolha da base pelo MESMO código que a tela usa, sem montar React.

/** O mínimo que uma linha de demonstração precisa ter para servir de base. */
export interface LinhaAV {
  descricao: string;
  codigo_conta?: string | null;
  is_subtotal: boolean;
  values: Record<string, number>;
}

export interface BaseAV<T extends LinhaAV> {
  /** Rótulo curto da coluna: "AV% RB", "AV% RL" ou "AV%". */
  rotulo: string;
  /** Nome por extenso, para o title do cabeçalho. */
  titulo: string;
  /** A linha usada como denominador. `null` = coluna mostra "—". */
  row: T | null;
}

/**
 * "(=) Receita Líquida" → "receita liquida".
 * Tira acento, tira os prefixos "(=)" / "(-)" / "(+)" e junta espaços.
 * Sem isso, um plano que escreva "Receita Liquida" sem acento perdia a base.
 */
export function chaveLinha(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const temValor = (r: LinhaAV) =>
  Object.values(r.values ?? {}).some((v) => Math.abs(v) > 0.005);

// Da mais específica para a mais tolerante. A primeira que casar E tiver
// valor ganha — assim o rótulo canônico do plano vence uma aproximação.
const BASES_DRE = [
  {
    rotulo: "AV% RB",
    titulo: "Receita Bruta",
    // O `!deduc` é o que impede "(-) Deduções da Receita Bruta" de ser
    // confundido com a própria Receita Bruta.
    testes: [
      (k: string) => k === "receita bruta",
      (k: string) => /receita.*bruta|faturamento bruto/.test(k) && !/deduc/.test(k),
    ],
  },
  {
    rotulo: "AV% RL",
    titulo: "Receita Líquida",
    testes: [
      (k: string) => k === "receita liquida",
      (k: string) => /receita.*liquida|vendas liquidas/.test(k),
    ],
  },
];

export function resolverBasesAV<T extends LinhaAV>(
  rows: T[],
  opts: { variante?: "dre" | "bp" | "dfc"; avBaseCodigo?: string } = {},
): BaseAV<T>[] {
  const { variante = "dre", avBaseCodigo } = opts;

  const achar = (testes: ((k: string) => boolean)[]): T | null => {
    for (const t of testes) {
      const achado = rows.find(
        (x) => temValor(x) && (t(chaveLinha(x.descricao)) || t(chaveLinha(x.codigo_conta))),
      );
      if (achado) return achado;
    }
    return null;
  };

  if (variante === "dre") {
    const dre = BASES_DRE.map((b) => ({
      rotulo: b.rotulo,
      titulo: b.titulo,
      row: achar(b.testes),
    })).filter((b): b is BaseAV<T> => b.row != null);
    // Achou uma das duas (ou as duas) → é isso que vale. Se a empresa não
    // tem nenhuma linha de receita reconhecível, cai na cadeia geral
    // abaixo em vez de deixar a coluna em branco.
    if (dre.length > 0) return dre;
  }

  // Base única — Balanço, ou DRE sem linha de receita reconhecível.
  // A cadeia de alternativas existe porque a base era procurada só pelo
  // rótulo exato passado pela página: se o plano da empresa não gera essa
  // linha, a coluna AV% aparecia vazia e parecia botão quebrado.
  const candidatos = [
    avBaseCodigo,
    "Receita Líquida",
    "Receita Bruta",
    "Total do Ativo",
    "Total do Passivo",
  ].filter(Boolean) as string[];

  for (const alvo of candidatos) {
    const achado = rows.find(
      (x) =>
        x.codigo_conta === alvo ||
        x.descricao.toLowerCase().includes(alvo.toLowerCase()),
    );
    if (achado && temValor(achado)) {
      return [{ rotulo: "AV%", titulo: achado.descricao, row: achado }];
    }
  }

  // Último recurso: a linha de maior magnitude — melhor uma AV% relativa
  // a algo do que coluna em branco.
  const porMagnitude = [...rows]
    .filter((x) => x.is_subtotal)
    .sort(
      (a, b) =>
        Math.max(...Object.values(b.values).map(Math.abs), 0) -
        Math.max(...Object.values(a.values).map(Math.abs), 0),
    );
  if (porMagnitude.length > 0) {
    return [{ rotulo: "AV%", titulo: porMagnitude[0].descricao, row: porMagnitude[0] }];
  }

  const r = avBaseCodigo
    ? rows.find(
        (x) =>
          x.codigo_conta === avBaseCodigo ||
          x.descricao.toLowerCase().includes(avBaseCodigo.toLowerCase()),
      )
    : undefined;
  // Sempre devolve pelo menos uma coluna: com base nula ela mostra "—",
  // que é honesto. Lista vazia faria o botão AV% não fazer nada visível.
  return [{ rotulo: "AV%", titulo: r?.descricao ?? "", row: r ?? null }];
}

/** O valor da AV% de uma linha em um período, ou null quando a base é 0. */
export function percentualAV(
  linha: LinhaAV,
  base: LinhaAV | null,
  periodo: string,
): number | null {
  const den = base?.values[periodo];
  if (den == null || Math.abs(den) < 0.001) return null;
  return ((linha.values[periodo] ?? 0) / den) * 100;
}
