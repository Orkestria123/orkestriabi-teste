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
  /** Grupo do Plano Padrão em que esta folha cai (Receita, Custos Industriais, Despesas Administrativas…). */
  grupoPlano?: GrupoPlano | null;
}

export interface GrupoPlano {
  chave: string;
  rotulo: string;
}

/**
 * Grupos da DRE/BP. Cada linha pode ter vários prefixos: o plano atual
 * põe Despesas Financeiras em 3.07.01.01; o seed antigo usava 3.06.01.13.
 * O mais longo vence. A ordem desta lista é a ordem no seletor.
 */
const GRUPOS_PLANO: { prefixos: string[]; rotulo: string }[] = [
  { prefixos: ["3.01.01"], rotulo: "Receita Bruta" },
  { prefixos: ["3.01.02"], rotulo: "Deduções" },
  { prefixos: ["3.01"], rotulo: "Receita" },
  { prefixos: ["3.02"], rotulo: "Custos Industriais" },
  { prefixos: ["3.03"], rotulo: "Custos Comerciais" },
  { prefixos: ["3.04"], rotulo: "Custos Imobiliários" },
  { prefixos: ["3.05"], rotulo: "Custos de Serviços" },
  { prefixos: ["3.06.01.01"], rotulo: "Despesas Administrativas" },
  { prefixos: ["3.06.01.02"], rotulo: "Despesas Comerciais" },
  {
    prefixos: ["3.07.01.01", "3.07.01.14", "3.06.01.13", "3.06.01.14"],
    rotulo: "Despesas Financeiras",
  },
  { prefixos: ["3.06.01.15"], rotulo: "Despesas Tributárias" },
  { prefixos: ["3.06.01.05"], rotulo: "Despesas com Piscina" },
  { prefixos: ["3.06.01.06"], rotulo: "Despesas com Fisioterapia" },
  { prefixos: ["3.06.01.07"], rotulo: "Despesas com Musculação" },
  { prefixos: ["3.06.01.16"], rotulo: "Outras Despesas" },
  { prefixos: ["3.06"], rotulo: "Despesas Operacionais" },
  {
    prefixos: ["3.07.01.02", "3.07.01.03", "3.07.01.04", "3.10.01.02", "3.10.01.03", "3.10.01.04"],
    rotulo: "Receitas Financeiras",
  },
  { prefixos: ["3.10"], rotulo: "Outras Receitas" },
  { prefixos: ["3.15"], rotulo: "Outros Resultados" },
  { prefixos: ["3.17"], rotulo: "CSLL" },
  { prefixos: ["3.18"], rotulo: "IRPJ" },
  { prefixos: ["3.19"], rotulo: "Distribuição de Lucros" },
  { prefixos: ["1.01.01"], rotulo: "Disponível" },
  { prefixos: ["1.01.02"], rotulo: "Contas a Receber" },
  { prefixos: ["1.01.03"], rotulo: "Estoques" },
  { prefixos: ["1.01"], rotulo: "Ativo Circulante" },
  { prefixos: ["1.03.03"], rotulo: "Imobilizado" },
  { prefixos: ["1.03"], rotulo: "Ativo Não Circulante" },
  { prefixos: ["1"], rotulo: "Ativo" },
  { prefixos: ["2.05"], rotulo: "Patrimônio Líquido" },
  { prefixos: ["2.01"], rotulo: "Passivo Circulante" },
  { prefixos: ["2.02"], rotulo: "Passivo Não Circulante" },
  { prefixos: ["2"], rotulo: "Passivo" },
];

const PREFIXOS_GRUPO: { prefixo: string; rotulo: string }[] = GRUPOS_PLANO.flatMap((g) =>
  g.prefixos.map((prefixo) => ({ prefixo, rotulo: g.rotulo })),
);

/** Sem acento, minúsculo, espaços colapsados. */
export function normalizar(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function chaveGrupo(rotulo: string): string {
  return normalizar(rotulo).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const ORDEM_GRUPO = new Map(GRUPOS_PLANO.map((g, i) => [chaveGrupo(g.rotulo), i]));
const ROTULO_CATALOGO = new Set(GRUPOS_PLANO.map((g) => chaveGrupo(g.rotulo)));

/** Chaves antigas do seletor (Adm/Com abreviados) → nome por extenso. */
const ALIAS_CHAVE: Record<string, string> = {
  "despesas-adm": "despesas-administrativas",
  "despesas-com": "despesas-comerciais",
};

export function chaveGrupoCanon(chave: string | null | undefined): string | null {
  if (!chave) return null;
  return ALIAS_CHAVE[chave] ?? chave;
}

const GRUPO_GENERICO = new Set([
  "despesas-operacionais",
  "ativo",
  "passivo",
  "receita",
]);

function clsNorm(cls: string): string {
  return cls.trim().replace(/,/g, ".").replace(/\s+/g, "");
}

function clsNoPrefixo(cls: string, prefixo: string): boolean {
  const c = clsNorm(cls);
  const p = clsNorm(prefixo);
  if (c === p) return true;
  if (!c.startsWith(p)) return false;
  const proximo = c.charAt(p.length);
  return proximo === "." || proximo === "-" || proximo === "/";
}

/** Aliases do plano → o nome da linha na DRE, por extenso. */
export function encurtarRotuloGrupo(s: string): string {
  const t = s.replace(/^\(\s*[-+=]\s*\)\s*/, "").trim();
  const n = normalizar(t);
  if (/^grupo\s+[\d.]+$/.test(n)) return t;
  if (n.includes("despesas administr")) return "Despesas Administrativas";
  if (n.includes("comercializ") || (n.includes("despesas") && n.includes("comerc"))) {
    return "Despesas Comerciais";
  }
  if (n.includes("despesas financ")) return "Despesas Financeiras";
  if (n.includes("despesas tribut")) return "Despesas Tributárias";
  if (n.includes("outras despesas")) return "Outras Despesas";
  if (n.includes("custos industri") || n.includes("produtos vendidos")) return "Custos Industriais";
  if (n.includes("custos comerc") || n.includes("mercadorias vendidas")) return "Custos Comerciais";
  if (/\bcustos?\b/.test(n) && n.includes("imobili")) return "Custos Imobiliários";
  if (n.includes("servico prest") || n.includes("prestacao de serv") || n.includes("custos de serv") || n.includes("custos dos serv")) {
    return "Custos de Serviços";
  }
  if (n.includes("receita bruta")) return "Receita Bruta";
  if (n.includes("deducoes da receita") || n.includes("deducoes da receita bruta")) return "Deduções";
  if (n.includes("receitas financ")) return "Receitas Financeiras";
  if (n.includes("efeitos inflacionarios") && n.includes("ativ")) return "Receitas Financeiras";
  if (n.includes("efeitos inflacionarios")) return "Despesas Financeiras";
  if (n.includes("patrimonio")) return "Patrimônio Líquido";
  return t;
}

function grupoDe(rotulo: string): GrupoPlano {
  const r = encurtarRotuloGrupo(rotulo);
  return { chave: chaveGrupo(r), rotulo: r };
}

/** Só aceita nome que é linha do catálogo — "Juros Pagos" / "Grupo 3.07" não viram grupo. */
function grupoDoCatalogo(texto?: string | null): GrupoPlano | null {
  if (!texto || !texto.trim()) return null;
  const g = grupoDe(texto);
  if (GRUPO_GENERICO.has(g.chave)) return null;
  if (!ROTULO_CATALOGO.has(g.chave)) return null;
  return g;
}

function grupoPorPrefixo(cls: string): GrupoPlano | null {
  let best: { prefixo: string; rotulo: string } | null = null;
  for (const g of PREFIXOS_GRUPO) {
    if (!clsNoPrefixo(cls, g.prefixo)) continue;
    if (!best || g.prefixo.length > best.prefixo.length) best = g;
  }
  return best ? grupoDe(best.rotulo) : null;
}

function grupoPorGalho(galho?: string | null, descricao?: string | null): GrupoPlano | null {
  const bruto = [galho, descricao].filter((s) => s && s.trim()).join(" > ");
  const partes = bruto.split(/\s*>\s*/).map((p) => p.trim()).filter(Boolean);
  const uniq: string[] = [];
  for (const p of partes) {
    if (uniq[uniq.length - 1] !== p) uniq.push(p);
  }
  // Da folha para a raiz: "… > Resultado Financeiro > Despesas Financeiras"
  // acerta o grupo mesmo quando o prefixo do plano mudou (3.06 → 3.07).
  for (let i = uniq.length - 1; i >= 0; i--) {
    const n = normalizar(uniq[i]);
    if (/^(ativo|passivo|resultado|patrimonio|dre|balanco)$/.test(n)) continue;
    if (/^grupo\s+[\d.]+$/.test(n) || n.includes("resultado financeiro")) continue;
    const g = grupoDoCatalogo(uniq[i]);
    if (g) return g;
  }
  return null;
}

export function grupoDoDestino(c: {
  classificacao?: string | null;
  descricao?: string | null;
  galho?: string | null;
}): GrupoPlano | null {
  const cls = clsNorm(c.classificacao ?? "");
  const doPrefixo = cls ? grupoPorPrefixo(cls) : null;
  // Prefixo específico manda: 3.07.01.01 é Despesas Financeiras, não
  // "Grupo 3.07" nem o saco genérico de Despesas Operacionais.
  if (doPrefixo && !GRUPO_GENERICO.has(doPrefixo.chave)) return doPrefixo;
  const doGalho = grupoPorGalho(c.galho, c.descricao);
  if (doGalho) return doGalho;
  return doPrefixo;
}

/** A conta cai neste grupo do seletor? Prefixo (todos os aliases) OU nome. */
export function contaPertenceAoGrupo(
  c: { classificacao?: string | null; descricao?: string | null; galho?: string | null },
  chave: string | null | undefined,
): boolean {
  const alvo = chaveGrupoCanon(chave);
  if (!alvo) return true;
  if (chaveGrupoCanon(grupoDoDestino(c)?.chave) === alvo) return true;
  const cls = clsNorm(c.classificacao ?? "");
  if (!cls) return false;
  for (const g of GRUPOS_PLANO) {
    if (chaveGrupo(g.rotulo) !== alvo) continue;
    if (g.prefixos.some((p) => clsNoPrefixo(cls, p))) return true;
  }
  return false;
}

export function grupoDeConta(c: ContaDestino): GrupoPlano | null {
  return grupoDoDestino(c);
}

/**
 * 3-DRE da origem casa com 3-DRE do padrão mesmo se o rótulo do ERP
 * for outro ("3-Despesa"). O primeiro dígito é a demonstração.
 */
export function mesmoTipoConta(
  contaTipo: string | null | undefined,
  filtro?: string | null,
): boolean {
  if (!filtro) return true;
  const t = (contaTipo ?? "").trim();
  if (!t) return true;
  if (t === filtro) return true;
  return t.charAt(0) === filtro.charAt(0);
}

export function listarGruposDestino(
  lista: ContaDestino[],
): { chave: string; rotulo: string; n: number }[] {
  const m = new Map<string, { rotulo: string; n: number; ordem: number }>();

  const add = (chave: string, rotulo: string, delta: number) => {
    const k = chaveGrupoCanon(chave) ?? chave;
    const cur = m.get(k);
    const ordem = ORDEM_GRUPO.get(k) ?? 1000;
    if (!cur) m.set(k, { rotulo, n: delta, ordem });
    else cur.n += delta;
  };

  for (const c of lista) {
    const g = grupoDeConta(c);
    if (!g) continue;
    add(g.chave, g.rotulo, 1);
  }

  return [...m.entries()]
    .sort((a, b) => a[1].ordem - b[1].ordem || a[1].rotulo.localeCompare(b[1].rotulo, "pt-BR"))
    .map(([chave, v]) => ({ chave, rotulo: v.rotulo, n: v.n }));
}

/** O grupo que mais aparece nas origens — só para a primeira escolha, se ainda não houver um grupo fixo. */
export function grupoMaisFrequente(
  linhas: {
    descricao?: string | null;
    classificacao?: string | null;
    galho?: string | null;
    caminho?: string | null;
  }[],
): string | null {
  const n = new Map<string, number>();
  for (const l of linhas) {
    const g = grupoDoDestino({
      descricao: l.descricao,
      classificacao: l.classificacao,
      galho: l.galho ?? l.caminho,
    });
    if (!g) continue;
    n.set(g.chave, (n.get(g.chave) ?? 0) + 1);
  }
  let best: string | null = null;
  let max = 0;
  for (const [k, q] of n) {
    if (q > max) {
      max = q;
      best = k;
    }
  }
  return max > 0 ? best : null;
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
  const galho = normalizar(c.galho);
  const alvo = `${cod} ${cls} ${desc} ${galho}`;

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
  /** Grupo do Plano Padrão (chave). `null`/ausente = todos. */
  grupo?: string | null;
}

function baseFiltrada(lista: ContaDestino[], opts: OpcoesBusca): ContaDestino[] {
  const { tipo, grupo } = opts;
  let base = tipo ? lista.filter((c) => mesmoTipoConta(c.tipo, tipo)) : lista;
  if (grupo) {
    base = base.filter((c) => contaPertenceAoGrupo(c, grupo));
  }
  return base;
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
  const { limite = 50 } = opts;
  const base = baseFiltrada(lista, opts);
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
  const base = baseFiltrada(lista, opts);
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
