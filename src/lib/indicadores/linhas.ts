// Catálogo de "linhas de demonstração" que podem ser usadas como termos
// de uma fórmula de indicador. Resolvidos usando as MESMAS convenções
// da DRE / Balanço, garantindo consistência entre indicador e demonstração.

import { descendeDe, grupoDe } from "@/lib/mascara/interpretar";
import { tipoCustoEfetivo } from "@/lib/plano/tipo-custo";
import {
  getEstruturaPadraoSync,
  compararClassificacao,
  type PapelEstrutura,
} from "@/lib/plano/estrutura";
import {
  valorConta,
  valorContaAnalitica,
  type EngineContext,
} from "./engine";

export type LinhaOrigem = "DRE" | "BP";

export interface LinhaCatalogo {
  key: string;
  label: string;
  origem: LinhaOrigem;
  descricao?: string;
}

export const LINHAS_CATALOGO: LinhaCatalogo[] = [
  // DRE ------------------------------------------------------
  { key: "RECEITA_BRUTA", label: "Receita Bruta", origem: "DRE" },
  { key: "DEDUCOES", label: "Deduções da Receita Bruta", origem: "DRE" },
  { key: "RECEITA_LIQUIDA", label: "Receita Líquida", origem: "DRE" },
  { key: "CUSTOS", label: "Custos (CMV/CPV/CSV)", origem: "DRE" },
  { key: "CUSTOS_FIXOS", label: "Custos Fixos", origem: "DRE", descricao: "Contas 3.x marcadas Fixo no plano (folha herda o grupo)" },
  { key: "CUSTOS_VARIAVEIS", label: "Custos Variáveis", origem: "DRE", descricao: "Contas 3.x marcadas Variável no plano" },
  { key: "PONTO_EQUILIBRIO", label: "Ponto de Equilíbrio", origem: "DRE", descricao: "Fixos / (1 − Variáveis / Receita Líquida)" },
  { key: "CUSTO_MERCADORIA", label: "Custo da mercadoria (EI + compras − deduções − EF)", origem: "DRE", descricao: "Só a parte com estoque: sem mão de obra, GGF e demais gastos" },
  { key: "LUCRO_BRUTO", label: "Lucro Bruto", origem: "DRE" },
  { key: "DESPESAS_OPERACIONAIS", label: "Despesas Operacionais", origem: "DRE" },
  { key: "DESPESAS_ADMINISTRATIVAS", label: "Despesas Administrativas", origem: "DRE" },
  { key: "DESPESAS_COMERCIAIS", label: "Despesas Comerciais", origem: "DRE" },
  { key: "RESULTADO_OPERACIONAL", label: "Resultado Operacional", origem: "DRE", descricao: "Subtotal da DRE até o operacional (conta .99 / corrido). Não é o KPI EBIT." },
  { key: "EBIT", label: "EBIT (DRE)", origem: "DRE", descricao: "Valor do indicador Ebit" },
  { key: "EBITDA", label: "EBITDA (DRE)", origem: "DRE", descricao: "Valor do indicador Ebitda" },
  { key: "RECEITAS_FINANCEIRAS", label: "Receitas Financeiras", origem: "DRE" },
  { key: "DESPESAS_FINANCEIRAS", label: "Despesas Financeiras", origem: "DRE" },
  { key: "RESULTADO_ANTES_IR", label: "Resultado antes do IR/CSLL", origem: "DRE" },
  { key: "IRPJ_CSLL", label: "IRPJ + CSLL", origem: "DRE" },
  { key: "LUCRO_LIQUIDO", label: "Lucro Líquido", origem: "DRE" },
  // BP -------------------------------------------------------
  { key: "ATIVO_TOTAL", label: "Ativo Total", origem: "BP" },
  { key: "ATIVO_CIRCULANTE", label: "Ativo Circulante", origem: "BP" },
  { key: "ATIVO_NAO_CIRCULANTE", label: "Ativo Não Circulante", origem: "BP" },
  { key: "REALIZAVEL_LP", label: "Realizável a Longo Prazo", origem: "BP" },
  { key: "DISPONIVEL", label: "Disponível / Caixa e Equivalentes", origem: "BP" },
  { key: "CONTAS_A_RECEBER", label: "Contas a Receber (Clientes)", origem: "BP" },
  { key: "ESTOQUES", label: "Estoques", origem: "BP" },
  { key: "IMOBILIZADO", label: "Imobilizado", origem: "BP" },
  { key: "PASSIVO_TOTAL_E_PL", label: "Passivo + Patrimônio Líquido (Total)", origem: "BP" },
  { key: "PASSIVO_CIRCULANTE", label: "Passivo Circulante", origem: "BP" },
  { key: "PASSIVO_NAO_CIRCULANTE", label: "Passivo Não Circulante", origem: "BP" },
  { key: "PATRIMONIO_LIQUIDO", label: "Patrimônio Líquido", origem: "BP" },
  { key: "FORNECEDORES", label: "Fornecedores", origem: "BP" },
  { key: "EMPRESTIMOS", label: "Empréstimos e Financiamentos", origem: "BP" },
];

export function labelLinha(key: string): string {
  return LINHAS_CATALOGO.find((l) => l.key === key)?.label ?? key;
}

// ------------------------------------------------------------
// DemoDre: valores da DRE por período (vindos de buildDRE).
// key = "descricao|periodo" → valor.
// ------------------------------------------------------------

export type DemoDre = Map<string, number>;

export const keyDre = (desc: string, periodo: string) => `${desc}|${periodo}`;

const ROTULOS_EBIT = [
  "(=) EBIT",
  "(=) Resultado Operacional (EBIT)",
  "(=) Resultado Operacional",
];
const ROTULOS_EBITDA = ["(=) EBITDA"];
const ROTULOS_LL = [
  "(=) Lucro do Exercício",
  "(=) Prejuízo do Exercício",
  "(=) Lucro Líquido do Exercício",
  "Lucro Líquido",
];

function normTxt(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^\(=\)\s*|^ \(-\)\s*|^\(\+\)\s*/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function periodosCandidatos(periodo: string): string[] {
  const ym = periodo.slice(0, 7);
  const dia = /^\d{4}-\d{2}$/.test(ym) ? `${ym}-01` : periodo.slice(0, 10);
  return Array.from(new Set([periodo, dia, `${ym}-01`, periodo.slice(0, 10)]));
}

function aliasesDaLinha(key: string, est: PapelEstrutura[] | null | undefined): string[] {
  const aliases = new Set<string>();
  const cat = LINHAS_CATALOGO.find((l) => l.key === key);
  if (cat) {
    aliases.add(cat.label);
    aliases.add(`(=) ${cat.label}`);
    aliases.add(`(-) ${cat.label}`);
    aliases.add(`(+) ${cat.label}`);
  }
  for (const e of est ?? []) {
    if (e.papel !== key || !e.rotulo) continue;
    aliases.add(e.rotulo);
  }
  if (key === "EBIT") ROTULOS_EBIT.forEach((a) => aliases.add(a));
  if (key === "EBITDA") ROTULOS_EBITDA.forEach((a) => aliases.add(a));
  if (key === "LUCRO_LIQUIDO") ROTULOS_LL.forEach((a) => aliases.add(a));
  return Array.from(aliases);
}

function putDemo(
  map: DemoDre,
  k: string,
  v: number,
  prefer: boolean,
) {
  if (!map.has(k)) {
    map.set(k, v);
    return;
  }
  const prev = map.get(k)!;
  const prevZ = Math.abs(prev) < 0.005;
  const vZ = Math.abs(v) < 0.005;
  if (prevZ && !vZ) {
    map.set(k, v);
    return;
  }
  if (!prevZ && vZ) return;
  if (prefer) map.set(k, v);
}

/** Indexa as linhas da DRE para o resolvedor de indicadores. */
export function indexarDemoDre(
  rows: {
    descricao: string;
    periodo: string;
    valor: number;
    codigo_conta?: string | null;
    is_subtotal?: boolean;
  }[],
  estrutura?: PapelEstrutura[] | null,
): DemoDre {
  const map: DemoDre = new Map();
  const est = estrutura ?? [];

  for (const r of rows) {
    const per = (r.periodo ?? "").slice(0, 10) || r.periodo;
    const ym = per.slice(0, 7);
    const v = Number(r.valor);
    const val = Number.isFinite(v) ? v : 0;
    const prefer = !!r.is_subtotal;
    putDemo(map, keyDre(r.descricao, per), val, prefer);
    putDemo(map, keyDre(r.descricao, ym), val, prefer);
    putDemo(map, keyDre(normTxt(r.descricao), ym), val, prefer);
    if (r.codigo_conta) {
      putDemo(map, `CLS:${r.codigo_conta}|${ym}`, val, prefer);
    }

    const nd = normTxt(r.descricao);
    for (const e of est) {
      if (e.demonstracao !== "DRE" || !e.papel) continue;
      const matchCls = !!(r.codigo_conta && r.codigo_conta === e.classificacao);
      const matchRotulo = !!(e.rotulo && normTxt(e.rotulo) === nd);
      // Conta .98/.99 não tem lançamento: o valor 0 dela não pode virar o PAPEL.
      if (matchCls && !r.is_subtotal && Math.abs(val) < 0.005) continue;
      if (matchCls || matchRotulo) {
        putDemo(map, `PAPEL:${e.papel}|${ym}`, val, !!r.is_subtotal || matchRotulo);
        putDemo(map, `PAPEL:${e.papel}|${per}`, val, !!r.is_subtotal || matchRotulo);
      }
    }
    for (const cat of LINHAS_CATALOGO) {
      if (cat.origem !== "DRE") continue;
      const nlab = normTxt(cat.label);
      if (nlab.length < 4) continue;
      if (nd === nlab || nd.includes(nlab) || (nd.length >= 6 && nlab.includes(nd))) {
        if (prefer || nd === nlab) {
          putDemo(map, `PAPEL:${cat.key}|${ym}`, val, prefer || nd === nlab);
        }
      }
    }
  }
  return map;
}

function valorDemoDre(
  demo: DemoDre | undefined,
  periodo: string,
  rotulos: string[],
  papel?: string,
): number | null {
  if (!demo || demo.size === 0) return null;
  const pers = periodosCandidatos(periodo);
  const ym = periodo.slice(0, 7);
  const candidatos: number[] = [];

  const push = (v: number | undefined) => {
    if (v == null || !Number.isFinite(v)) return;
    candidatos.push(v);
  };

  if (papel) {
    for (const per of [`PAPEL:${papel}|${ym}`, ...pers.map((p) => `PAPEL:${papel}|${p}`)]) {
      if (demo.has(per)) push(demo.get(per));
    }
  }

  for (const d of rotulos) {
    for (const per of pers) {
      const k = keyDre(d, per);
      if (demo.has(k)) push(demo.get(k));
    }
    const kn = keyDre(normTxt(d), ym);
    if (demo.has(kn)) push(demo.get(kn));
  }

  const needles = rotulos.map(normTxt).filter((n) => n.length >= 4);
  if (needles.length > 0) {
    for (const [k, v] of demo) {
      if (k.startsWith("PAPEL:") || k.startsWith("CLS:")) continue;
      const sep = k.lastIndexOf("|");
      if (sep < 0) continue;
      const desc = k.slice(0, sep);
      const per = k.slice(sep + 1);
      if (!pers.some((p) => per.startsWith(p.slice(0, 7)))) continue;
      const nd = normTxt(desc);
      // Igualdade estrita. "ebit" ⊂ "ebitda" fazia o EBITDA do indicador
      // puxar a linha de EBIT (ou o contrário) — a DRE estava certa e o
      // card não. Substring só em rótulos longos (Lucro Bruto, etc.).
      if (!needles.some((n) => nd === n || (n.length >= 8 && nd.includes(n)))) continue;
      push(v);
    }
  }

  if (candidatos.length === 0) return null;
  const naoZero = candidatos.filter((v) => Math.abs(v) > 0.005);
  if (naoZero.length === 0) return candidatos[0];
  return naoZero.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
}

/** Valor de um papel (RECEITA_BRUTA, LUCRO_LIQUIDO, EBIT, …) na DRE já indexada. */
export function valorEbitEbitdaDaDre(
  demo: DemoDre | undefined,
  qual: "EBIT" | "EBITDA",
  periodo: string,
): number | null {
  const rotulo = qual === "EBITDA" ? "(=) EBITDA" : "(=) EBIT";
  return valorDemoDre(demo, periodo, [rotulo], undefined);
}

export function valorPapelDemo(
  demo: DemoDre | undefined,
  papel: string,
  periodo: string,
  estrutura?: PapelEstrutura[] | null,
): number | null {
  if (papel === "EBIT" || papel === "EBITDA") {
    return valorEbitEbitdaDaDre(demo, papel, periodo);
  }
  return valorDemoDre(demo, periodo, aliasesDaLinha(papel, estrutura), papel);
}

/** Custos da DRE (CPV + CMV + CSP + imobiliário), convenção da demonstração. */
export function valorCustosDemo(
  demo: DemoDre | undefined,
  periodo: string,
  estrutura?: PapelEstrutura[] | null,
): number | null {
  let t = 0;
  let hit = false;
  for (const papel of ["CPV", "CMV", "CSP", "CUSTO_IMOBILIARIO"]) {
    const v = valorPapelDemo(demo, papel, periodo, estrutura);
    if (v == null) continue;
    t += v;
    hit = true;
  }
  return hit ? t : null;
}

// ------------------------------------------------------------
// Resolução por PAPEL (a partir do `estrutura_padrao`)
//
// Por que isto existe: o resolvedor antigo procurava as linhas da DRE
// pelo RÓTULO exibido — `dreVal(demoDre, "(=) Lucro Bruto", periodo)`.
// Como a DRE passou a ser desenhada com os nomes do plano do escritório
// ("LUCRO/PREJUIZO BRUTO"), NENHUMA dessas buscas casava e todo
// indicador que dependia da DRE devolvia null. Era essa a causa de os
// indicadores não funcionarem.
//
// Agora a busca é por papel → classificação, com as MESMAS três regras
// que o motor da DRE usa (detalhe, bloco, corrido). Rótulo é
// apresentação; papel é contrato.
// ------------------------------------------------------------

/** Movimento do período na convenção da DRE: receita +, custo/despesa −. */
function saldoNoPeriodo(
  saldos: Map<string, { total_debitos: number; total_creditos: number }> | undefined,
  periodo: string,
) {
  if (!saldos) return null;
  for (const p of periodosCandidatos(periodo)) {
    const s = saldos.get(p);
    if (s) return s;
  }
  const ym = periodo.slice(0, 7);
  for (const [k, s] of saldos) {
    if (k.startsWith(ym)) return s;
  }
  return null;
}

function valorDreClass(classificacao: string, periodo: string, ctx: EngineContext): number {
  let total = 0;
  const vistos = new Set<string>();
  for (const p of ctx.plano) {
    if (p.is_sintetica) continue;
    if (vistos.has(p.classificacao)) continue;
    vistos.add(p.classificacao);
    if (
      p.classificacao !== classificacao &&
      !descendeDe(p.classificacao, classificacao, ctx.mascara)
    )
      continue;
    const s = saldoNoPeriodo(ctx.saldosByClass.get(p.classificacao), periodo);
    if (!s) continue;
    total += Number(s.total_creditos) - Number(s.total_debitos);
  }
  return total;
}

/** Soma de tudo que vem ANTES de `limite` no grupo de resultado. */
function valorDreAcumulado(
  limite: string,
  periodo: string,
  ctx: EngineContext,
  ehApuracao: (c: string) => boolean,
): number {
  const raiz = limite.split(/[.\-/]/)[0];
  let total = 0;
  const vistos = new Set<string>();
  for (const p of ctx.plano) {
    if (p.is_sintetica) continue;
    if (vistos.has(p.classificacao)) continue;
    vistos.add(p.classificacao);
    if (p.classificacao.split(/[.\-/]/)[0] !== raiz) continue;
    if (ehApuracao(p.classificacao)) continue;
    if (compararClassificacao(p.classificacao, limite) >= 0) continue;
    const s = saldoNoPeriodo(ctx.saldosByClass.get(p.classificacao), periodo);
    if (!s) continue;
    total += Number(s.total_creditos) - Number(s.total_debitos);
  }
  return total;
}

const ehApuracaoClass = (c: string) =>
  c.split(/[.\-/]/).slice(1).some((seg) => seg === "98" || seg === "99");

function resolverPorPapel(
  est: PapelEstrutura[],
  key: string,
  periodo: string,
  ctx: EngineContext,
): number | null {
  const entradas = est.filter((e) => e.papel === key);
  if (entradas.length === 0) return null;

  let total = 0;
  for (const e of entradas) {
    if (e.demonstracao === "DRE") {
      let tipo = e.tipo_linha;
      // .98/.99 não têm saldo; se a estrutura marcou como detalhe, fecha o bloco pai.
      if (tipo === "detalhe" && ehApuracaoClass(e.classificacao)) tipo = "bloco";
      if (tipo === "corrido") {
        total += valorDreAcumulado(e.classificacao, periodo, ctx, ehApuracaoClass);
      } else if (tipo === "bloco") {
        const partes = e.classificacao.split(".");
        const pai = partes.length > 1 ? partes.slice(0, -1).join(".") : e.classificacao;
        total += valorDreClass(pai, periodo, ctx);
      } else {
        total += valorDreClass(e.classificacao, periodo, ctx);
      }
    } else {
      // Balanço: `valorConta` já acumula abertura + movimento e trata o
      // sinal pelo grupo (ativo devedor, passivo/PL credor).
      total += valorConta(e.classificacao, periodo, ctx);
    }
  }
  return total;
}

/** Papéis que são combinação de outros. */
function resolverDerivado(
  est: PapelEstrutura[],
  key: string,
  periodo: string,
  ctx: EngineContext,
): number | null {
  const v = (k: string) => resolverPorPapel(est, k, periodo, ctx) ?? 0;
  switch (key) {
    case "CUSTOS":
      // todos os blocos de custo do plano
      return v("CPV") + v("CMV") + v("CUSTO_IMOBILIARIO") + v("CSP");
    case "CUSTO_MERCADORIA":
      // EI + compras + deduções de compras + EF — sem MOD, GGF, depreciação.
      return v("ESTOQUE_INICIAL") + v("COMPRAS") + v("DEDUCOES_COMPRAS") + v("ESTOQUE_FINAL");
    case "IRPJ_CSLL":
      return v("PROVISAO_IRPJ") + v("PROVISAO_CSLL");
    case "EBITDA": {
      const ebit = resolverPorPapel(est, "EBIT", periodo, ctx);
      if (ebit === null) return null;
      // depreciação é despesa (crédito - débito < 0); somar de volta = subtrair
      return ebit - v("DEPRECIACAO_AMORTIZACAO");
    }
    case "PASSIVO_TOTAL_E_PL":
      return null; // tem regra própria abaixo (inclui o resultado do exercício)
    default:
      return null;
  }
}

/** Resultado acumulado do exercício até o período (Σ movimento contas grupo 3,
 * do início do ano até a competência, na natureza credora → lucro positivo). */
function resultadoExercicioAte(ctx: EngineContext, periodo: string): number {
  const inicio = `${periodo.slice(0, 4)}-01`;
  let total = 0;
  const vistos = new Set<string>();
  for (const p of ctx.plano) {
    if (p.is_sintetica) continue;
    if (vistos.has(p.classificacao)) continue;
    vistos.add(p.classificacao);
    const g = grupoDe(p.classificacao, ctx.mascara);
    if (g !== "receita" && g !== "despesa" && g !== "resultado") continue;
    if (ehApuracaoClass(p.classificacao)) continue; // .98/.99 não têm lançamento
    const saldos = ctx.saldosByClass.get(p.classificacao);
    if (!saldos) continue;
    // Convenção da DRE, igual à do motor de demonstrações: crédito − débito,
    // então lucro é positivo.
    for (const [comp, s] of saldos) {
      if (comp < inicio || comp > periodo) continue;
      total += Number(s.total_creditos) - Number(s.total_debitos);
    }
  }
  return total;
}

/** Soma positiva de custos/despesas (3.x, sem receita) com aquele tipo_custo. */
export function valorCustosPorTipo(
  ctx: EngineContext,
  periodo: string,
  tipo: "fixo" | "variavel",
): number {
  let total = 0;
  const vistos = new Set<string>();
  for (const p of ctx.plano) {
    if (p.is_sintetica || p.is_participante) continue;
    if (vistos.has(p.classificacao)) continue;
    vistos.add(p.classificacao);
    const g = grupoDe(p.classificacao, ctx.mascara);
    if (g === "receita") continue;
    const raiz = p.classificacao.split(/[.\-/]/)[0] ?? "";
    if ((raiz.charAt(0) || "") !== "3") continue;
    if (ehApuracaoClass(p.classificacao)) continue;
    if (tipoCustoEfetivo(p.classificacao, ctx.plano) !== tipo) continue;
    const s = saldoNoPeriodo(ctx.saldosByClass.get(p.classificacao), periodo);
    if (!s) continue;
    // Despesa na DRE: crédito − débito é negativo; PE usa valor absoluto.
    total += Math.abs(Number(s.total_creditos) - Number(s.total_debitos));
  }
  return total;
}

export function resolverLinha(
  key: string,
  periodo: string,
  ctx: EngineContext,
  demoDre: DemoDre | undefined,
  estrutura?: PapelEstrutura[],
): number | null {
  // CAMINHO ÚNICO. Antes havia dois: o papel do `estrutura_padrao` e um
  // caminho "legado" que somava por grupo da máscara. Quando o
  // `estrutura_padrao` ainda não tinha carregado (ele é assíncrono e o
  // resolvedor é síncrono), o mesmo indicador caía no legado e devolvia
  // OUTRO número — no plano do escritório, Ativo Total vinha 1,9× maior.
  //
  // O motivo do erro do legado: ele iterava as contas do plano somando
  // por CLASSIFICAÇÃO, e 28 classificações do plano têm mais de uma
  // conta (o próprio export repete: 1.03.03.02.01 é "VEICULOS INDUSTRIA"
  // E "VEICULOS SERVICOS"; 1.03.01.03.01 tem 7 contas). Cada repetição
  // somava o mesmo saldo de novo.
  //
  // Dois caminhos de cálculo para a mesma pergunta é o defeito de fundo.
  // Ficou um só. Sem a estrutura carregada devolve `null` — a tela mostra
  // "—" por um instante, o que é infinitamente melhor que um número
  // quase-dobrado que parece certo.
  if (key === "CUSTOS_FIXOS") return valorCustosPorTipo(ctx, periodo, "fixo");
  if (key === "CUSTOS_VARIAVEIS") return valorCustosPorTipo(ctx, periodo, "variavel");
  if (key === "PONTO_EQUILIBRIO") {
    const rec = resolverLinha("RECEITA_LIQUIDA", periodo, ctx, demoDre, estrutura);
    const fixos = valorCustosPorTipo(ctx, periodo, "fixo");
    const vars = valorCustosPorTipo(ctx, periodo, "variavel");
    if (rec == null || rec <= 0) return null;
    const mcPct = 1 - vars / rec;
    if (mcPct <= 0) return null;
    return fixos / mcPct;
  }

  const est = estrutura ?? getEstruturaPadraoSync();
  const cat = LINHAS_CATALOGO.find((l) => l.key === key);

  // DRE: prefere o valor já montado na demonstração. Zero na conta .99
  // não conta — cai no cálculo por papel (bloco/corrido), igual à DRE.
  // EBIT / EBITDA: o valor é o dos indicadores Ebit / Ebitda, gravado
  // na DRE. Sem essa linha, devolve null — não recalcula pela estrutura
  // (isso era outro número e quebrava o termo "EBITDA (DRE)").
  if (key === "EBIT" || key === "EBITDA") {
    return valorEbitEbitdaDaDre(demoDre, key, periodo);
  }
  if (key === "RESULTADO_OPERACIONAL") {
    const daDre = valorDemoDre(
      demoDre,
      periodo,
      [
        "(=) Resultado Operacional",
        "(=) Resultado Operacional (EBIT)",
        "Resultado Operacional",
      ],
      "EBIT",
    );
    if (daDre != null && Math.abs(daDre) > 0.005) return daDre;
    if (!est || est.length === 0) return daDre;
    return resolverPorPapel(est, "EBIT", periodo, ctx);
  }

  if (cat?.origem === "DRE") {
    const daDre = valorDemoDre(demoDre, periodo, aliasesDaLinha(key, est), key);
    if (daDre != null && Math.abs(daDre) > 0.005) return daDre;
  }

  if (!est || est.length === 0) return null;

  const derivado = resolverDerivado(est, key, periodo, ctx);
  if (derivado !== null) return derivado;
  if (key === "PATRIMONIO_LIQUIDO") {
    const pl = resolverPorPapel(est, key, periodo, ctx);
    if (pl !== null) return pl + resultadoExercicioAte(ctx, periodo);
  }
  if (key === "PASSIVO_TOTAL_E_PL") {
    const t = resolverPorPapel(est, key, periodo, ctx);
    if (t !== null) return t + resultadoExercicioAte(ctx, periodo);
  }
  return resolverPorPapel(est, key, periodo, ctx);
}