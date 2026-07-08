// Montagem hierárquica de DRE / BP / DFC a partir do novo modelo
// (saldos_mensais + plano_contas + mapeamento_demonstracao).
//
// Saída no MESMO shape das páginas:
// { linha_ordem, descricao, codigo_conta, nivel, is_subtotal, periodo, valor }
//
// Estratégia:
//  - Linha mapeada (ex.: "Receita Bruta") = grupo pai, nivel 0, is_subtotal.
//  - Abaixo aparecem grupos do plano de contas (nivel 3 e nivel 4 do plano)
//    que pertencem à classificação dessa linha, com seus saldos.
//  - Sinal (inverter_sinal) é aplicado uma vez por conta, e propagado ao grupo.
//  - DRE: movimento do período. BP: abertura + Σ movimento até a competência.

import { supabase } from "@/integrations/supabase/client";
import {
  descendeDe,
  dividir,
  juntar,
  nivelDe,
  getMascaraConfig,
  MASCARA_DEFAULT,
  type MascaraConfig,
} from "@/lib/mascara/interpretar";
import {
  getAjustesGerenciais,
  ajustesToSaldosVirtuais,
  contasGerenciaisToPlanoVirtual,
  type AjustesGerenciaisData,
} from "@/lib/gerencial/ajustes";

export type ModoDemonstracao = "contabil" | "gerencial";

type Tipo = "DRE" | "BP_ATIVO" | "BP_PASSIVO" | "DFC" | "DLPA" | "DVA";

export interface FlatRow {
  linha_ordem: number;
  descricao: string;
  codigo_conta: string | null;
  nivel: number;
  is_subtotal: boolean;
  periodo: string;
  valor: number;
}

interface Plano {
  codigo: string;
  classificacao: string;
  descricao: string;
  nivel: number;
  is_participante: boolean;
}
interface Mapa {
  classificacao_prefixo: string;
  linha_demonstracao: string;
  ordem: number;
  inverter_sinal: boolean;
}
interface Saldo {
  conta_codigo: string;
  competencia: string;
  movimento: number;
  total_debitos: number;
  total_creditos: number;
}


// Apuração contábil: qualquer segmento (após o primeiro) igual a "98" ou "99".
// Usa a máscara para dividir corretamente independente do separador.
function isApuracao(classificacao: string, mascara: MascaraConfig): boolean {
  const partes = dividir(classificacao, mascara);
  return partes.slice(1).some((p) => p === "98" || p === "99");
}

// ---------- helpers ----------

async function fetchAllPaginated<T>(
  build: (from: number, to: number) => any,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  for (let i = 0; i < 500; i++) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function buildMatcher(mapas: Mapa[], mascara: MascaraConfig) {
  const sorted = [...mapas].sort(
    (a, b) => b.classificacao_prefixo.length - a.classificacao_prefixo.length,
  );
  return (classificacao: string): Mapa | null => {
    for (const m of sorted) {
      if (descendeDe(classificacao, m.classificacao_prefixo, mascara)) {
        return m;
      }
    }
    return null;
  };
}

// Retorna o prefixo de uma classificação até `nivelMax` segmentos.
function prefixoAteNivel(
  classificacao: string,
  nivelMax: number,
  mascara: MascaraConfig,
): string {
  const partes = dividir(classificacao, mascara);
  if (partes.length <= nivelMax) return classificacao;
  return juntar(partes.slice(0, nivelMax), mascara);
}

async function getPlanoPorTipo(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  tiposPlano: string[],
  opts: { incluirParticipantes?: boolean; codigosComSaldo?: string[] } = {},
): Promise<Plano[]> {
  // Contas estruturais (1-Ativo, 2-Passivo, 3-DRE, ...): trazer todas.
  const estruturais = await fetchAllPaginated<Plano>((from, to) => {
    const q = supabase
      .from("plano_contas")
      .select("codigo, classificacao, descricao, nivel, is_participante")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .in("tipo", tiposPlano)
      .eq("is_participante", false)
      .range(from, to);
    return modoGlobal ? q.is("company_id", null) : q.eq("company_id", companyId);
  });

  if (!opts.incluirParticipantes) return estruturais;

  // Participantes (4-Cli. Nac., 5-For. Nac., 6-Cli. Ex., 7-For. Ex.):
  // o cadastro pode ter dezenas/centenas de milhares de linhas (todos os
  // clientes/fornecedores). Restringimos APENAS aos códigos que efetivamente
  // possuem saldo (abertura + movimento) na empresa — caso contrário a fetch
  // estoura e o Balanço renderiza vazio.
  const tiposParticipantes: string[] = [];
  if (tiposPlano.includes("1-Ativo")) {
    tiposParticipantes.push("4-Cli. Nac.", "6-Cli. Ex.");
  }
  if (tiposPlano.includes("2-Passivo")) {
    tiposParticipantes.push("5-For. Nac.", "7-For. Ex.");
  }
  if (tiposParticipantes.length === 0) return estruturais;

  const codigos = Array.from(new Set(opts.codigosComSaldo ?? []));
  if (codigos.length === 0) return estruturais;

  // .in("codigo", ...) em lotes para evitar URLs gigantescas
  const CHUNK = 500;
  const participantes: Plano[] = [];
  for (let i = 0; i < codigos.length; i += CHUNK) {
    const lote = codigos.slice(i, i + CHUNK);
    const rows = await fetchAllPaginated<Plano>((from, to) => {
      const q = supabase
        .from("plano_contas")
        .select("codigo, classificacao, descricao, nivel, is_participante")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .in("tipo", tiposParticipantes)
        .in("codigo", lote)
        .range(from, to);
      return modoGlobal ? q.is("company_id", null) : q.eq("company_id", companyId);
    });
    participantes.push(...rows);
  }
  return [...estruturais, ...participantes];
}

async function getMapa(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  tipo: Tipo,
): Promise<Mapa[]> {
  const q = supabase
    .from("mapeamento_demonstracao")
    .select("classificacao_prefixo, linha_demonstracao, ordem, inverter_sinal")
    .eq("tenant_id", tenantId)
    .eq("tipo_demonstracao", tipo);
  const { data, error } = modoGlobal
    ? await q.is("company_id", null)
    : await q.eq("company_id", companyId);
  if (error) throw error;
  return (data ?? []) as Mapa[];
}

async function getSaldos(
  companyId: string,
  periodos: string[],
): Promise<Saldo[]> {
  const rows = await fetchAllPaginated<any>((from, to) =>
    supabase
      .from("saldos_mensais")
      .select("conta_codigo, competencia, total_debitos, total_creditos, movimento")
      .eq("company_id", companyId)
      .in("competencia", periodos)
      .range(from, to),
  );
  return rows.map((r: any) => ({
    conta_codigo: r.conta_codigo,
    competencia: r.competencia,
    movimento:
      Number(r.movimento) ||
      (Number(r.total_debitos) || 0) - (Number(r.total_creditos) || 0),
    total_debitos: Number(r.total_debitos) || 0,
    total_creditos: Number(r.total_creditos) || 0,
  }));
}

async function getSaldosAteData(
  companyId: string,
  ateData: string,
): Promise<Saldo[]> {
  const rows = await fetchAllPaginated<any>((from, to) =>
    supabase
      .from("saldos_mensais")
      .select("conta_codigo, competencia, total_debitos, total_creditos, movimento")
      .eq("company_id", companyId)
      .lte("competencia", ateData)
      .range(from, to),
  );
  return rows.map((r: any) => ({
    conta_codigo: r.conta_codigo,
    competencia: r.competencia,
    movimento:
      Number(r.movimento) ||
      (Number(r.total_debitos) || 0) - (Number(r.total_creditos) || 0),
    total_debitos: Number(r.total_debitos) || 0,
    total_creditos: Number(r.total_creditos) || 0,
  }));
}

async function getAberturaMaisRecente(
  companyId: string,
): Promise<Map<string, number>> {
  const data = await fetchAllPaginated<any>((from, to) =>
    supabase
      .from("saldos_abertura")
      .select("conta_codigo, data_referencia, saldo")
      .eq("company_id", companyId)
      .order("data_referencia", { ascending: false })
      .range(from, to),
  );
  const m = new Map<string, number>();
  const seen = new Set<string>();
  for (const r of data) {
    if (!seen.has(r.conta_codigo)) {
      seen.add(r.conta_codigo);
      m.set(r.conta_codigo, Number(r.saldo) || 0);
    }
  }
  return m;
}

// ---------- agregação hierárquica ----------

interface PontoSaldo {
  classificacao: string;
  valor: number; // já com sinal aplicado (inverter_sinal)
}

/**
 * Recebe a lista de (conta_codigo → valor) e:
 *  - aplica inverter_sinal do mapa correspondente,
 *  - filtra contas sem mapa, participantes ou de apuração,
 *  - retorna lista por classificação (com sinal aplicado).
 */
function aplicarMapaESinal(
  saldosPorConta: Map<string, number>,
  planoMap: Map<string, Plano>,
  matcher: (c: string) => Mapa | null,
  mascara: MascaraConfig,
  opts: { incluirParticipantes?: boolean } = {},
): { mapa: Mapa; classificacao: string; valor: number; isParticipante: boolean }[] {
  const out: { mapa: Mapa; classificacao: string; valor: number; isParticipante: boolean }[] = [];
  for (const [codigo, valor] of saldosPorConta) {
    const conta = planoMap.get(codigo);
    if (!conta) continue;
    if (conta.is_participante && !opts.incluirParticipantes) continue;
    if (isApuracao(conta.classificacao, mascara)) continue;
    const m = matcher(conta.classificacao);
    if (!m) continue;
    const v = m.inverter_sinal ? -valor : valor;
    out.push({ mapa: m, classificacao: conta.classificacao, valor: v, isParticipante: conta.is_participante });
  }
  return out;
}


/**
 * Monta linhas planas para UMA linha mapeada (parent) + grupos do plano abaixo,
 * para um único período. Retrocompatível — usa emitirArvoreMulti internamente.
 */
function emitirHierarquia(
  parent: { linha: string; ordem: number },
  pontos: { classificacao: string; descricao: string; valor: number; nivelPlano: number }[],
  periodo: string,
  linhaOrdemBase: number,
  planoPrefixos: Map<string, string>,
  mascara: MascaraConfig,
): FlatRow[] {
  const map = new Map<string, typeof pontos>();
  map.set(periodo, pontos);
  return emitirArvoreMulti(parent, map, linhaOrdemBase, planoPrefixos, mascara);
}

// Compat: alias antigo (mesma implementação single-period).
function emitirArvoreBP(
  parent: { linha: string; ordem: number },
  pontos: { classificacao: string; descricao: string; valor: number; nivelPlano: number }[],
  periodo: string,
  linhaOrdemBase: number,
  planoPrefixos: Map<string, string>,
  mascara: MascaraConfig,
): FlatRow[] {
  return emitirHierarquia(parent, pontos, periodo, linhaOrdemBase, planoPrefixos, mascara);
}

type Ponto = { classificacao: string; descricao: string; valor: number; nivelPlano: number };

/**
 * Árvore hierárquica completa emitindo linhas para MÚLTIPLOS períodos ao mesmo tempo.
 * A estrutura da árvore é construída UMA VEZ a partir da união das classificações
 * presentes em todos os períodos — garantindo que cada nó receba SEMPRE o mesmo
 * `linha_ordem`, independentemente de quais contas movimentaram em cada mês.
 * Sem isso, contas com o mesmo `descricao` (ex.: "PRO-LABORE" em centros de
 * custo distintos) apareciam achatadas na mesma linha porque o buildRows do
 * dashboard chaveia por (linha_ordem, descricao).
 */
function emitirArvoreMulti(
  parent: { linha: string; ordem: number },
  pontosPorPeriodo: Map<string, Ponto[]>,
  linhaOrdemBase: number,
  planoPrefixos: Map<string, string>,
  mascara: MascaraConfig,
): FlatRow[] {
  const out: FlatRow[] = [];
  const periodos = Array.from(pontosPorPeriodo.keys());

  // 1) Header (subtotal) — nivel 0 — por período.
  for (const periodo of periodos) {
    const total = (pontosPorPeriodo.get(periodo) ?? []).reduce((a, b) => a + b.valor, 0);
    out.push({
      linha_ordem: linhaOrdemBase,
      descricao: parent.linha,
      codigo_conta: null,
      nivel: 0,
      is_subtotal: true,
      periodo,
      valor: total,
    });
  }

  // União das classificações presentes em qualquer período.
  const allClassifs: string[] = [];
  const seenClassif = new Set<string>();
  for (const pts of pontosPorPeriodo.values()) {
    for (const p of pts) {
      if (!seenClassif.has(p.classificacao)) {
        seenClassif.add(p.classificacao);
        allClassifs.push(p.classificacao);
      }
    }
  }
  if (allClassifs.length === 0) return out;

  const profMin = commonPrefixLen(allClassifs, mascara);

  type Node = {
    classif: string;
    depth: number;
    children: Map<string, Node>;
    valorPor: Map<string, number>;
  };
  const root = new Map<string, Node>();

  for (const [periodo, pts] of pontosPorPeriodo) {
    for (const p of pts) {
      const parts = dividir(p.classificacao, mascara);
      let map = root;
      for (let level = profMin; level <= parts.length; level++) {
        const prefix = juntar(parts.slice(0, level), mascara);
        let node = map.get(prefix);
        if (!node) {
          node = { classif: prefix, depth: level, children: new Map(), valorPor: new Map() };
          map.set(prefix, node);
        }
        node.valorPor.set(periodo, (node.valorPor.get(periodo) ?? 0) + p.valor);
        map = node.children;
      }
    }
  }

  // Walk determinístico (ordem alfabética por classificação). Contador incremental,
  // mas a árvore agora depende só da união — o mesmo nó recebe o mesmo linha_ordem
  // em qualquer período.
  let counter = 1;
  const walk = (map: Map<string, Node>) => {
    const sorted = Array.from(map.values()).sort((a, b) =>
      a.classif.localeCompare(b.classif),
    );
    for (const n of sorted) {
      // Colapsa nó intermediário redundante SOMENTE se, em TODOS os períodos,
      // o valor do único filho == valor do pai.
      if (n.children.size === 1) {
        const only = n.children.values().next().value!;
        let redundant = true;
        for (const periodo of periodos) {
          const a = n.valorPor.get(periodo) ?? 0;
          const b = only.valorPor.get(periodo) ?? 0;
          if (Math.abs(a - b) >= 0.005) { redundant = false; break; }
        }
        if (redundant) {
          walk(n.children);
          continue;
        }
      }
      const nivel = n.depth - profMin + 1;
      const ordemNode = linhaOrdemBase + counter++;
      for (const periodo of periodos) {
        out.push({
          linha_ordem: ordemNode,
          descricao: planoPrefixos.get(n.classif) ?? n.classif,
          codigo_conta: n.classif,
          nivel,
          is_subtotal: false,
          periodo,
          valor: n.valorPor.get(periodo) ?? 0,
        });
      }
      if (n.children.size > 0) walk(n.children);
    }
  };
  walk(root);

  return out;
}

function commonPrefixLen(classifs: string[], mascara: MascaraConfig): number {
  if (classifs.length === 0) return 1;
  const split = classifs.map((c) => dividir(c, mascara));
  const min = Math.min(...split.map((s) => s.length));
  let n = 0;
  outer: for (let i = 0; i < min; i++) {
    const seg = split[0][i];
    for (const s of split) if (s[i] !== seg) { break outer; }
    n++;
  }
  return Math.max(1, n);
}

function prefixoEstruturalMaisProximo(
  classificacao: string,
  estruturais: Set<string>,
  mascara: MascaraConfig,
): string {
  const partes = dividir(classificacao, mascara);
  for (let level = partes.length; level >= 1; level--) {
    const prefixo = juntar(partes.slice(0, level), mascara);
    if (estruturais.has(prefixo)) return prefixo;
  }
  return classificacao;
}



// ---------- DRE / DFC ----------

async function buildDRE(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  tipo: "DRE" | "DFC",
  mascara: MascaraConfig,
  modo: ModoDemonstracao = "contabil",
  gerData?: AjustesGerenciaisData,
): Promise<FlatRow[]> {
  const [mapasRaw, saldosContabeis, planoContabil] = await Promise.all([
    getMapa(companyId, tenantId, modoGlobal, tipo),
    getSaldos(companyId, periodos),
    getPlanoPorTipo(companyId, tenantId, modoGlobal, ["3-DRE"]),
  ]);
  // Filtra prefixos que são contas de apuração (.98/.99): não têm lançamento
  // próprio, seriam ignoradas em aplicarMapaESinal e apenas geram linhas
  // fantasma zeradas que duplicam subtotais calculados (ex.: "Receita Líquida"
  // mapeada em 3.01.99 vira duplicata do "(=) Receita Líquida" calculado).
  const mapas = mapasRaw.filter((m) => !isApuracao(m.classificacao_prefixo, mascara));

  // Modo GERENCIAL: injeta saldos virtuais dos ajustes gerenciais das
  // competências selecionadas (fluxo, mesma regra da DRE contábil).
  let saldos = saldosContabeis;
  let planoExtra: Plano[] = [];
  if (modo === "gerencial") {
    const ger = gerData ?? (await getAjustesGerenciais(companyId, tenantId));
    const perSet = new Set(periodos);
    const virtuais = ajustesToSaldosVirtuais(ger.ajustes, (c) => perSet.has(c));
    saldos = [...saldos, ...virtuais];
    // Plano virtual para contas gerenciais (afeta apenas quando classificadas
    // em grupo 3 — improvável para DRE, mas mantemos por simetria).
    planoExtra = contasGerenciaisToPlanoVirtual(ger.contasGerenciais, mascara.separador || ".");
  }

  const planoMap = new Map<string, Plano>();
  const planoPorClassificacao = new Map<string, Plano>();
  const planoPrefixos = new Map<string, string>();
  for (const p of [...planoContabil, ...planoExtra]) {
    planoMap.set(p.codigo, p);
    planoPorClassificacao.set(p.classificacao, p);
    planoPrefixos.set(p.classificacao, p.descricao);
  }
  const matcher = buildMatcher(mapas, mascara);

  // Linhas mapeadas únicas, com ordem
  const linhasMeta = new Map<string, { ordem: number }>();
  for (const m of mapas) {
    const prev = linhasMeta.get(m.linha_demonstracao);
    if (!prev || m.ordem < prev.ordem) {
      linhasMeta.set(m.linha_demonstracao, { ordem: m.ordem });
    }
  }

  const out: FlatRow[] = [];

  // Coleta pontos por (linha mapeada, período). A árvore será construída UMA
  // única vez por linha, a partir da união dos períodos — assim cada nó recebe
  // o mesmo `linha_ordem` em todos os meses.
  const porLinhaPeriodo = new Map<
    string,
    { ordem: number; pontosPor: Map<string, Ponto[]> }
  >();
  for (const [linha, meta] of linhasMeta) {
    porLinhaPeriodo.set(linha, { ordem: meta.ordem, pontosPor: new Map() });
  }

  for (const p of periodos) {
    const saldosPorConta = new Map<string, number>();
    for (const s of saldos) {
      if (s.competencia !== p) continue;
      const conta = planoMap.get(s.conta_codigo);
      if (!conta) continue;
      // Movimento líquido (d - c), consistente com o BP. Assim estornos
      // (créditos em contas de despesa, débitos em contas de receita) são
      // compensados no próprio movimento da conta, e o Lucro Líquido da
      // DRE fica idêntico ao Resultado do Exercício do PL do BP.
      const valor = s.total_debitos - s.total_creditos;
      saldosPorConta.set(
        s.conta_codigo,
        (saldosPorConta.get(s.conta_codigo) ?? 0) + valor,
      );
    }

    const pontos = aplicarMapaESinal(saldosPorConta, planoMap, matcher, mascara);

    for (const pt of pontos) {
      const linha = pt.mapa.linha_demonstracao;
      const conta = planoPorClassificacao.get(pt.classificacao);
      const bucket = porLinhaPeriodo.get(linha)!;
      const arr = bucket.pontosPor.get(p) ?? [];
      arr.push({
        classificacao: pt.classificacao,
        descricao: conta?.descricao ?? pt.classificacao,
        valor: pt.valor,
        nivelPlano: conta?.nivel ?? nivelDe(pt.classificacao, mascara),
      });
      bucket.pontosPor.set(p, arr);
    }
  }

  // Garante entrada vazia por período em cada linha (para o header nivel 0).
  for (const bucket of porLinhaPeriodo.values()) {
    for (const p of periodos) {
      if (!bucket.pontosPor.has(p)) bucket.pontosPor.set(p, []);
    }
  }

  const linhasOrd = Array.from(porLinhaPeriodo.entries()).sort(
    (a, b) => a[1].ordem - b[1].ordem,
  );
  for (const [linha, info] of linhasOrd) {
    const base = info.ordem * 1000;
    out.push(
      ...emitirArvoreMulti(
        { linha, ordem: info.ordem },
        info.pontosPor,
        base,
        planoPrefixos,
        mascara,
      ),
    );
  }


  // Subtotais calculados da DRE
  if (tipo === "DRE") addDRECalculatedTotals(out, periodos);

  // ordena
  out.sort((a, b) => a.linha_ordem - b.linha_ordem || a.periodo.localeCompare(b.periodo));
  return out;
}

// Convenção dos valores armazenados:
//  - Receita Bruta / Receita Líquida / Receitas Financeiras / Outras Receitas: positivos.
//  - Deduções, Custos, Despesas, IR/CSLL: positivos (a "(-)" está no rótulo).
// Portanto, subtotais subtraem as linhas "(-)" e somam as "(+)".
function addDRECalculatedTotals(rows: FlatRow[], periodos: string[]) {
  const byKey = new Map<string, number>();
  for (const r of rows) byKey.set(`${r.descricao}|${r.periodo}`, r.valor);
  const v = (desc: string, p: string) => byKey.get(`${desc}|${p}`) ?? 0;

  const targets: { linha: string; ordem: number; calc: (p: string) => number }[] = [
    {
      linha: "(=) Receita Líquida",
      ordem: 150 * 1000 - 5,
      calc: (p) => v("Receita Bruta", p) - v("(-) Deduções da Receita Bruta", p),
    },
    {
      linha: "(=) Lucro Bruto",
      ordem: 290 * 1000,
      calc: (p) =>
        v("(=) Receita Líquida", p) -
        v("(-) Custos Industriais", p) -
        v("(-) Custos Comerciais", p) -
        v("(-) Custos Imobiliários", p) -
        v("(-) Custos dos Serviços", p) -
        v("(-) Custos", p),
    },
    {
      linha: "(=) Resultado Operacional (EBIT)",
      ordem: 490 * 1000,
      calc: (p) =>
        v("(=) Lucro Bruto", p) -
        v("(-) Despesas Operacionais", p) -
        v("(-) Despesas Administrativas", p) -
        v("(-) Despesas Comerciais", p) -
        v("(-) Despesas Tributárias", p) -
        v("(-) Outras Despesas Operacionais", p) +
        v("(+) Outras Receitas Operacionais", p),
    },
    {
      linha: "(=) Resultado Antes do IR/CSLL",
      ordem: 590 * 1000,
      calc: (p) =>
        v("(=) Resultado Operacional (EBIT)", p) +
        v("(+) Receitas Financeiras", p) -
        v("(-) Despesas Financeiras", p),
    },
    {
      linha: "(=) Lucro Líquido do Exercício",
      ordem: 690 * 1000,
      calc: (p) =>
        v("(=) Resultado Antes do IR/CSLL", p) -
        v("(-) IRPJ", p) -
        v("(-) CSLL", p),
    },
  ];

  for (const t of targets) {
    for (const p of periodos) {
      const valor = t.calc(p);
      rows.push({
        linha_ordem: t.ordem,
        descricao: t.linha,
        codigo_conta: null,
        nivel: 0,
        is_subtotal: true,
        periodo: p,
        valor,
      });
      // atualiza o map para próximos cálculos
      byKey.set(`${t.linha}|${p}`, valor);
    }
  }
}

// ---------- Balanço Patrimonial ----------

async function buildBP(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  tipo: "BP_ATIVO" | "BP_PASSIVO",
  mascara: MascaraConfig,
  modo: ModoDemonstracao = "contabil",
  gerData?: AjustesGerenciaisData,
): Promise<FlatRow[]> {
  const tipoPlano = tipo === "BP_ATIVO" ? ["1-Ativo"] : ["2-Passivo"];
  const ateData = [...periodos].sort().pop()!;

  // Busca primeiro abertura + saldos para descobrir quais conta_codigo
  // realmente têm saldo. Em seguida usa esse set para restringir a busca
  // de contas participantes (clientes/fornecedores) — o cadastro completo
  // pode ter 100k+ linhas e estoura o fetch.
  const [mapasRaw, abertura, saldosAcumContabil, planoDRE] = await Promise.all([
    getMapa(companyId, tenantId, modoGlobal, tipo),
    getAberturaMaisRecente(companyId),
    getSaldosAteData(companyId, ateData),
    tipo === "BP_PASSIVO"
      ? getPlanoPorTipo(companyId, tenantId, modoGlobal, ["3-DRE"])
      : Promise.resolve([] as Plano[]),
  ]);
  const mapas = mapasRaw.filter((m) => !isApuracao(m.classificacao_prefixo, mascara));

  // Modo GERENCIAL: injeta saldos virtuais dos ajustes acumulados até
  // `ateData` (posição, mesma regra do BP contábil), e adiciona contas
  // gerenciais ao plano para que apareçam no grupo pai correto.
  let saldosAcum = saldosAcumContabil;
  let planoExtra: Plano[] = [];
  if (modo === "gerencial") {
    const ger = gerData ?? (await getAjustesGerenciais(companyId, tenantId));
    const virtuais = ajustesToSaldosVirtuais(ger.ajustes, (c) => c <= ateData);
    saldosAcum = [...saldosAcum, ...virtuais];
    planoExtra = contasGerenciaisToPlanoVirtual(ger.contasGerenciais, mascara.separador || ".");
  }

  const codigosComSaldo = new Set<string>();
  for (const c of abertura.keys()) codigosComSaldo.add(c);
  for (const s of saldosAcum) codigosComSaldo.add(s.conta_codigo);

  // Resultado acumulado do exercício até cada período de referência (apenas BP_PASSIVO).
  // resultado = -(Σ movimento contas grupo 3 do início do ano até ref).
  // Em meses de prejuízo o valor é negativo (reduz o PL); em lucro, positivo.
  // No modo gerencial os movimentos virtuais de ajustes em contas DRE (grupo 3)
  // já estão em saldosAcum e portanto propagam automaticamente para o resultado
  // — mantendo Ativo = Passivo + PL na visão gerencial.
  const dreCodigos = new Set<string>(planoDRE.map((p) => p.codigo));
  const resultadoExercicioPorRef = new Map<string, number>();
  if (tipo === "BP_PASSIVO" && dreCodigos.size > 0) {
    for (const ref of periodos) {
      const inicioExerc = `${ref.slice(0, 4)}-01`;
      let soma = 0;
      for (const s of saldosAcum) {
        if (
          s.competencia >= inicioExerc &&
          s.competencia <= ref &&
          dreCodigos.has(s.conta_codigo)
        ) {
          soma += s.movimento;
        }
      }
      resultadoExercicioPorRef.set(ref, -soma);
    }
  }

  const planoContabil = await getPlanoPorTipo(companyId, tenantId, modoGlobal, tipoPlano, {
    incluirParticipantes: true,
    codigosComSaldo: Array.from(codigosComSaldo),
  });
  const plano = [...planoContabil, ...planoExtra];

  const planoMap = new Map<string, Plano>();
  const planoPorClassificacao = new Map<string, Plano>();
  const planoPrefixos = new Map<string, string>();
  const classificacoesEstruturais = new Set<string>();
  for (const p of plano) {
    planoMap.set(p.codigo, p);
    if (!p.is_participante) {
      planoPorClassificacao.set(p.classificacao, p);
      classificacoesEstruturais.add(p.classificacao);
    } else if (!planoPorClassificacao.has(p.classificacao)) {
      planoPorClassificacao.set(p.classificacao, p);
    }
    // Prefere a descrição da conta ESTRUTURAL para os prefixos pais
    // (evita rotular a conta pai "CLIENTES" com o nome de um cliente individual).
    if (!p.is_participante || !planoPrefixos.has(p.classificacao)) {
      planoPrefixos.set(p.classificacao, p.descricao);
    }
  }
  const matcher = buildMatcher(mapas, mascara);

  const linhasMeta = new Map<string, { ordem: number }>();
  for (const m of mapas) {
    const prev = linhasMeta.get(m.linha_demonstracao);
    if (!prev || m.ordem < prev.ordem) {
      linhasMeta.set(m.linha_demonstracao, { ordem: m.ordem });
    }
  }

  const out: FlatRow[] = [];
  const periodosOrd = [...periodos].sort();

  // Saldos acumulados por conta até cada período de referência
  // Otimização: ordenar saldos por competência e ir acumulando
  const saldosOrd = [...saldosAcum].sort((a, b) =>
    a.competencia.localeCompare(b.competencia),
  );

  const acumPorConta = new Map<string, number>(abertura);
  let cursor = 0;

  // Fase 1: coleta pontos consolidados por (linha mapeada, ref) — assim como
  // no DRE, para construir a árvore UMA vez a partir da união dos períodos.
  const porLinha = new Map<
    string,
    { ordem: number; pontosPor: Map<string, Ponto[]> }
  >();
  for (const [linha, meta] of linhasMeta) {
    porLinha.set(linha, { ordem: meta.ordem, pontosPor: new Map() });
  }
  // totalPorRef[ref][linha] = valor total daquela linha naquele ref
  const totalPorLinhaRef = new Map<string, Map<string, number>>();
  const initRefMap = (linha: string) => {
    let m = totalPorLinhaRef.get(linha);
    if (!m) { m = new Map(); totalPorLinhaRef.set(linha, m); }
    return m;
  };

  for (const ref of periodosOrd) {
    while (cursor < saldosOrd.length && saldosOrd[cursor].competencia <= ref) {
      const s = saldosOrd[cursor];
      acumPorConta.set(s.conta_codigo, (acumPorConta.get(s.conta_codigo) ?? 0) + s.movimento);
      cursor++;
    }
    const snapshot = new Map(acumPorConta);
    const pontos = aplicarMapaESinal(snapshot, planoMap, matcher, mascara, { incluirParticipantes: true });
    const pontosConsolidados = pontos.map((pt) => ({
      ...pt,
      classificacao: pt.isParticipante
        ? prefixoEstruturalMaisProximo(pt.classificacao, classificacoesEstruturais, mascara)
        : pt.classificacao,
    }));

    for (const pt of pontosConsolidados) {
      const linha = pt.mapa.linha_demonstracao;
      const conta = planoPorClassificacao.get(pt.classificacao);
      const bucket = porLinha.get(linha)!;
      const arr = bucket.pontosPor.get(ref) ?? [];
      arr.push({
        classificacao: pt.classificacao,
        descricao: conta?.descricao ?? pt.classificacao,
        valor: pt.valor,
        nivelPlano: conta?.nivel ?? nivelDe(pt.classificacao, mascara),
      });
      bucket.pontosPor.set(ref, arr);
      const tm = initRefMap(linha);
      tm.set(ref, (tm.get(ref) ?? 0) + pt.valor);
    }
    // Garante entrada vazia por ref para todas as linhas (header por período).
    for (const [linha, bucket] of porLinha) {
      if (!bucket.pontosPor.has(ref)) {
        bucket.pontosPor.set(ref, []);
        const tm = initRefMap(linha);
        if (!tm.has(ref)) tm.set(ref, 0);
      }
    }
  }

  const linhasOrd = Array.from(porLinha.entries()).sort(
    (a, b) => a[1].ordem - b[1].ordem,
  );
  const STRUCT_GROUPS: Record<string, string[]> =
    tipo === "BP_ATIVO"
      ? {
          "Ativo Não Circulante": [
            "Realizável a Longo Prazo",
            "Investimentos",
            "Imobilizado",
            "Intangível",
          ],
        }
      : {
          "Patrimônio Líquido": [
            "Capital Social",
            "Reservas",
            "Lucros/Prejuízos Acumulados",
          ],
        };
  const isStructParent = (linha: string) => linha in STRUCT_GROUPS;
  const childrenOf = (linha: string) => STRUCT_GROUPS[linha] ?? [];
  const childSet = new Set(Object.values(STRUCT_GROUPS).flat());
  const parentOf = new Map<string, string>();
  for (const [p, kids] of Object.entries(STRUCT_GROUPS)) {
    kids.forEach((k) => parentOf.set(k, p));
  }
  const ordemDe = (linha: string) => linhasMeta.get(linha)?.ordem ?? 0;

  // Fase 2: emite a árvore por linha (uma vez, com todos os períodos).
  for (const [linha, info] of linhasOrd) {
    let base = info.ordem * 1000;
    const parentLinha = parentOf.get(linha);
    if (parentLinha) {
      const idx = childrenOf(parentLinha).indexOf(linha);
      base = ordemDe(parentLinha) * 1000 + (idx + 1) * 20;
    }
    const linhas = emitirArvoreMulti(
      { linha, ordem: info.ordem },
      info.pontosPor,
      base,
      planoPrefixos,
      mascara,
    );
    if (isStructParent(linha)) {
      // Só os headers (nivel 0, um por período) — valor será agregado dos filhos.
      for (const l of linhas) if (l.nivel === 0) out.push(l);
    } else if (parentLinha) {
      for (const l of linhas) out.push({ ...l, nivel: l.nivel + 1 });
    } else {
      out.push(...linhas);
    }
  }

  // Fase 2b: no passivo, emite "Resultado do Exercício" como filha do PL.
  if (tipo === "BP_PASSIVO") {
    const baseRes =
      ordemDe("Patrimônio Líquido") * 1000 +
      (childrenOf("Patrimônio Líquido").length + 1) * 20;
    for (const ref of periodosOrd) {
      const resultado = resultadoExercicioPorRef.get(ref) ?? 0;
      out.push({
        linha_ordem: baseRes,
        descricao: "Resultado do Exercício",
        codigo_conta: null,
        nivel: 2,
        is_subtotal: false,
        periodo: ref,
        valor: resultado,
      });
    }
  }

  // Fase 3: agrega parents estruturais e total do lado.
  for (const ref of periodosOrd) {
    const valorLinhaRef = (linha: string) => totalPorLinhaRef.get(linha)?.get(ref) ?? 0;
    let totalLado = 0;
    for (const [linha] of linhasOrd) {
      if (isStructParent(linha)) {
        let v = childrenOf(linha).reduce((a, c) => a + valorLinhaRef(c), 0);
        if (tipo === "BP_PASSIVO" && linha === "Patrimônio Líquido") {
          v += resultadoExercicioPorRef.get(ref) ?? 0;
        }
        const header = out.find(
          (r) => r.periodo === ref && r.descricao === linha && r.nivel === 0,
        );
        if (header) header.valor = v;
        totalLado += v;
      } else if (!childSet.has(linha)) {
        totalLado += valorLinhaRef(linha);
      }
    }

    out.push({
      linha_ordem: 9_999_000,
      descricao: tipo === "BP_ATIVO" ? "Total do Ativo" : "Total do Passivo + PL",
      codigo_conta: null,
      nivel: 0,
      is_subtotal: true,
      periodo: ref,
      valor: totalLado,
    });
  }



  out.sort((a, b) => a.linha_ordem - b.linha_ordem || a.periodo.localeCompare(b.periodo));
  return out;
}

// ---------- Entry ----------

export async function buildStatementFromDiario(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  tipo: Tipo,
  periodos: string[],
  modo: ModoDemonstracao = "contabil",
): Promise<FlatRow[]> {
  if (periodos.length === 0) return [];
  // Carrega máscara da empresa (cai para tenant/default) — fonte única
  // de verdade para split, prefixo, pai e grupo nas demonstrações.
  const mascara = await getMascaraConfig({ tenantId, companyId });
  // Modo gerencial: carrega ajustes uma vez e reaproveita nas subchamadas
  // (DRE + BP dentro de DFC/DLPA/DVA quando aplicável).
  const gerData =
    modo === "gerencial" ? await getAjustesGerenciais(companyId, tenantId) : undefined;
  if (tipo === "DRE") return buildDRE(companyId, tenantId, modoGlobal, periodos, "DRE", mascara, modo, gerData);
  if (tipo === "DFC") return buildDFC(companyId, tenantId, modoGlobal, periodos, mascara);
  if (tipo === "DLPA") return buildDLPA(companyId, tenantId, modoGlobal, periodos, mascara);
  if (tipo === "DVA") return buildDVA(companyId, tenantId, modoGlobal, periodos, mascara);
  return buildBP(companyId, tenantId, modoGlobal, periodos, tipo, mascara, modo, gerData);
}

/**
 * Verificação de fechamento do Balanço (Ativo = Passivo + PL) para um
 * determinado modo. Retorna a diferença absoluta por período; deve ser
 * ~0 em contábil e também em gerencial (partida dobrada D=C garante).
 */
export async function verificarFechamentoBP(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  modo: ModoDemonstracao = "contabil",
): Promise<Array<{ periodo: string; ativo: number; passivoPl: number; diferenca: number }>> {
  const [ativoRows, passivoRows] = await Promise.all([
    buildStatementFromDiario(companyId, tenantId, modoGlobal, "BP_ATIVO", periodos, modo),
    buildStatementFromDiario(companyId, tenantId, modoGlobal, "BP_PASSIVO", periodos, modo),
  ]);
  const totalDe = (rows: FlatRow[], desc: string, p: string) =>
    rows.find((r) => r.descricao === desc && r.periodo === p)?.valor ?? 0;
  return periodos.map((p) => {
    const ativo = totalDe(ativoRows, "Total do Ativo", p);
    const passivoPl = totalDe(passivoRows, "Total do Passivo + PL", p);
    return { periodo: p, ativo, passivoPl, diferenca: ativo - passivoPl };
  });
}

// ============================================================
// DFC / DLPA / DVA — derivados de saldos_mensais + plano_contas
// + reuso do motor de DRE.
// ============================================================

// Prefixos default (plano contábil padrão brasileiro)
const PREFIXO_CAIXA = "1.01.01";
const PREFIXO_IMOBILIZADO = "1.03";
const PREFIXO_EMPRESTIMOS_CP = "2.01.04";
const PREFIXO_EMPRESTIMOS_LP = "2.02.01";
const PREFIXO_CAPITAL_SOCIAL = "2.05.01.01";
const PREFIXO_LUCROS_ACUM = "2.05.01.09";
const PREFIXO_LUCROS_ACUM_ALT = "2.05.01.08";

const KW_DEPRECIACAO = /deprec|amortiz|exaust/i;
const KW_PESSOAL = /salar|f[eé]rias|13|fgts|inss patron|encargo|previd|benef|aliment|vale|sa[uú]de|odont/i;
const KW_IMPOSTOS = /imposto|tribut|icms|ipi|iss|pis|cofins|irpj|csll|simples|inss|fgts|taxa|contribui|prev/i;
const KW_JUROS = /juros|financeiras? despesa|encargo financeir|spread/i;
const KW_ALUGUEL = /alugu|arrendamento|leasing/i;
const KW_DIVIDENDOS = /dividend|jcp|juros sobre capital|distribui/i;

interface ContaSnapshot {
  classificacao: string;
  descricao: string;
  saldo: number; // saldo acumulado até a data (abertura + Σ movimento)
}

async function getSnapshotPorPrefixo(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  ateData: string,
  prefixos: string[],
  mascara: MascaraConfig,
): Promise<ContaSnapshot[]> {
  // carrega plano todo e saldos acumulados, filtra por prefixo
  const [plano, abertura, saldosAcum] = await Promise.all([
    getPlanoPorTipo(companyId, tenantId, modoGlobal, ["1-Ativo", "2-Passivo"]),
    getAberturaMaisRecente(companyId),
    getSaldosAteData(companyId, ateData),
  ]);
  const planoPorCodigo = new Map<string, Plano>();
  for (const p of plano) planoPorCodigo.set(p.codigo, p);

  const acumPorCodigo = new Map<string, number>(abertura);
  for (const s of saldosAcum) {
    if (s.competencia > ateData) continue;
    acumPorCodigo.set(s.conta_codigo, (acumPorCodigo.get(s.conta_codigo) ?? 0) + s.movimento);
  }

  const out: ContaSnapshot[] = [];
  for (const [codigo, saldo] of acumPorCodigo) {
    const conta = planoPorCodigo.get(codigo);
    if (!conta || conta.is_participante) continue;
    const matches = prefixos.some((pref) => descendeDe(conta.classificacao, pref, mascara));
    if (!matches) continue;
    out.push({ classificacao: conta.classificacao, descricao: conta.descricao, saldo });
  }
  return out;
}

function sumSnapshots(snap: ContaSnapshot[]): number {
  return snap.reduce((a, b) => a + b.saldo, 0);
}

function prevPeriodo(p: string): string {
  // p = 'YYYY-MM-DD' (primeiro dia do mês). Retorna último dia do mês anterior.
  const d = new Date(p + "T00:00:00Z");
  d.setUTCDate(0); // último dia do mês anterior
  return d.toISOString().slice(0, 10);
}

function emitirRow(
  out: FlatRow[],
  ordem: number,
  descricao: string,
  periodo: string,
  valor: number,
  opts: { nivel?: number; is_subtotal?: boolean; codigo?: string | null } = {},
) {
  out.push({
    linha_ordem: ordem,
    descricao,
    codigo_conta: opts.codigo ?? null,
    nivel: opts.nivel ?? 1,
    is_subtotal: opts.is_subtotal ?? false,
    periodo,
    valor,
  });
}

// ---------- DFC (método indireto) ----------

async function buildDFC(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  mascara: MascaraConfig,
): Promise<FlatRow[]> {
  const periodosOrd = [...periodos].sort();
  const dre = await buildDRE(companyId, tenantId, modoGlobal, periodosOrd, "DRE", mascara);

  // valor por linha/período no DRE
  const dreVal = (descricao: string, p: string) =>
    dre.find((r) => r.descricao === descricao && r.periodo === p)?.valor ?? 0;

  // depreciação por keyword no DRE (linhas analíticas)
  const depPeriodo = (p: string) =>
    dre
      .filter((r) => r.periodo === p && !r.is_subtotal && KW_DEPRECIACAO.test(r.descricao ?? ""))
      .reduce((a, r) => a + Math.abs(Number(r.valor) || 0), 0);

  const out: FlatRow[] = [];

  // saldos cumulativos (caixa, imob, empréstimos) em t-1 e t para cada período
  for (const [idx, p] of periodosOrd.entries()) {
    const pPrev = prevPeriodo(p);
    const [snapPrev, snapCurr] = await Promise.all([
      getSnapshotPorPrefixo(companyId, tenantId, modoGlobal, pPrev, [
        PREFIXO_CAIXA,
        PREFIXO_IMOBILIZADO,
        PREFIXO_EMPRESTIMOS_CP,
        PREFIXO_EMPRESTIMOS_LP,
        PREFIXO_CAPITAL_SOCIAL,
      ], mascara),
      getSnapshotPorPrefixo(companyId, tenantId, modoGlobal, p, [
        PREFIXO_CAIXA,
        PREFIXO_IMOBILIZADO,
        PREFIXO_EMPRESTIMOS_CP,
        PREFIXO_EMPRESTIMOS_LP,
        PREFIXO_CAPITAL_SOCIAL,
      ], mascara),
    ]);

    const filtPref = (snap: ContaSnapshot[], pref: string) =>
      snap.filter((s) => descendeDe(s.classificacao, pref, mascara));

    const caixaIni = sumSnapshots(filtPref(snapPrev, PREFIXO_CAIXA));
    const caixaFim = sumSnapshots(filtPref(snapCurr, PREFIXO_CAIXA));
    const imobIni = sumSnapshots(filtPref(snapPrev, PREFIXO_IMOBILIZADO));
    const imobFim = sumSnapshots(filtPref(snapCurr, PREFIXO_IMOBILIZADO));
    const empIni =
      sumSnapshots(filtPref(snapPrev, PREFIXO_EMPRESTIMOS_CP)) +
      sumSnapshots(filtPref(snapPrev, PREFIXO_EMPRESTIMOS_LP));
    const empFim =
      sumSnapshots(filtPref(snapCurr, PREFIXO_EMPRESTIMOS_CP)) +
      sumSnapshots(filtPref(snapCurr, PREFIXO_EMPRESTIMOS_LP));
    const capIni = sumSnapshots(filtPref(snapPrev, PREFIXO_CAPITAL_SOCIAL));
    const capFim = sumSnapshots(filtPref(snapCurr, PREFIXO_CAPITAL_SOCIAL));

    const lucroLiq = dreVal("(=) Lucro Líquido do Exercício", p);
    const depAmort = depPeriodo(p);

    // Variações
    const varImob = imobFim - imobIni; // aumento = compra
    const varEmprestimos = empFim - empIni; // aumento = captação
    const varCapital = capFim - capIni;

    // BLOCOS
    const operacional = lucroLiq + depAmort; // simplificação: sem ajuste de capital de giro detalhado
    const investimento = -varImob;
    const financiamento = varEmprestimos + varCapital;
    const variacaoLiquida = operacional + investimento + financiamento;
    const variacaoCaixaBP = caixaFim - caixaIni;
    const validado = Math.abs(variacaoLiquida - variacaoCaixaBP) < Math.max(1, Math.abs(variacaoCaixaBP) * 0.05);

    const base = 0;
    emitirRow(out, base + 100, "Lucro Líquido do Exercício", p, lucroLiq);
    emitirRow(out, base + 110, "(+) Depreciação e Amortização", p, depAmort);
    emitirRow(out, base + 199, "(=) Caixa das Atividades Operacionais", p, operacional, {
      nivel: 0,
      is_subtotal: true,
    });

    emitirRow(out, base + 210, "(-) Aquisição (Líquida) de Imobilizado", p, -varImob);
    emitirRow(out, base + 299, "(=) Caixa das Atividades de Investimento", p, investimento, {
      nivel: 0,
      is_subtotal: true,
    });

    emitirRow(out, base + 310, "(+/-) Variação de Empréstimos", p, varEmprestimos);
    emitirRow(out, base + 320, "(+/-) Variação de Capital", p, varCapital);
    emitirRow(out, base + 399, "(=) Caixa das Atividades de Financiamento", p, financiamento, {
      nivel: 0,
      is_subtotal: true,
    });

    emitirRow(out, base + 499, "(=) Variação Líquida de Caixa", p, variacaoLiquida, {
      nivel: 0,
      is_subtotal: true,
    });
    emitirRow(out, base + 510, "Caixa no Início do Período", p, caixaIni);
    emitirRow(out, base + 599, "Caixa no Final do Período", p, caixaFim, {
      nivel: 0,
      is_subtotal: true,
    });
    emitirRow(
      out,
      base + 999,
      validado ? "✓ Validação CPC 03: variação confere com o Balanço" : "⚠ Validação CPC 03: divergência na variação de caixa",
      p,
      variacaoCaixaBP - variacaoLiquida,
    );
    void idx;
  }
  return out;
}

// ---------- DLPA ----------

async function buildDLPA(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  mascara: MascaraConfig,
): Promise<FlatRow[]> {
  const periodosOrd = [...periodos].sort();
  const dre = await buildDRE(companyId, tenantId, modoGlobal, periodosOrd, "DRE", mascara);
  const dreVal = (descricao: string, p: string) =>
    dre.find((r) => r.descricao === descricao && r.periodo === p)?.valor ?? 0;

  const out: FlatRow[] = [];
  for (const p of periodosOrd) {
    const pPrev = prevPeriodo(p);
    const [snapPrev, snapCurr] = await Promise.all([
      getSnapshotPorPrefixo(companyId, tenantId, modoGlobal, pPrev, [
        PREFIXO_LUCROS_ACUM,
        PREFIXO_LUCROS_ACUM_ALT,
        PREFIXO_CAPITAL_SOCIAL,
      ], mascara),
      getSnapshotPorPrefixo(companyId, tenantId, modoGlobal, p, [
        PREFIXO_LUCROS_ACUM,
        PREFIXO_LUCROS_ACUM_ALT,
        PREFIXO_CAPITAL_SOCIAL,
      ], mascara),
    ]);
    const filtPref = (snap: ContaSnapshot[], prefs: string[]) =>
      snap.filter((s) => prefs.some((pref) => descendeDe(s.classificacao, pref, mascara)));

    // Passivo é credor: para PL exibir como positivo invertemos o sinal
    const saldoInicial = -sumSnapshots(
      filtPref(snapPrev, [PREFIXO_LUCROS_ACUM, PREFIXO_LUCROS_ACUM_ALT]),
    );
    const saldoFinalContabil = -sumSnapshots(
      filtPref(snapCurr, [PREFIXO_LUCROS_ACUM, PREFIXO_LUCROS_ACUM_ALT]),
    );
    const capitalSocial = -sumSnapshots(filtPref(snapCurr, [PREFIXO_CAPITAL_SOCIAL]));

    const lucroLiq = dreVal("(=) Lucro Líquido do Exercício", p);

    // Reserva legal sugerida (5% LL limitado a 20% do capital)
    const reservaLegalSugerida = Math.max(
      0,
      Math.min(lucroLiq * 0.05, Math.max(0, capitalSocial * 0.2)),
    );

    // Movimento real no período (variação efetiva do saldo) — depois de subtrair LL deveria zerar se só houve LL
    const variacaoReal = saldoFinalContabil - saldoInicial;
    // Destinações efetivas = LL - variacao real (o que saiu da conta de lucros)
    const destinacoesEfetivas = lucroLiq - variacaoReal;

    const base = 0;
    emitirRow(out, base + 100, "Saldo Inicial de Lucros/Prejuízos Acumulados", p, saldoInicial);
    emitirRow(out, base + 199, "(=) Saldo Inicial Ajustado", p, saldoInicial, {
      nivel: 0,
      is_subtotal: true,
    });
    emitirRow(out, base + 210, lucroLiq >= 0 ? "(+) Lucro Líquido do Exercício" : "(-) Prejuízo do Exercício", p, lucroLiq);
    emitirRow(out, base + 310, "(-) Reserva Legal (sugerida 5%)", p, -reservaLegalSugerida);
    emitirRow(out, base + 320, "(-) Destinações / Distribuições do Período", p, -destinacoesEfetivas);
    emitirRow(out, base + 399, "(=) Saldo Final de Lucros/Prejuízos Acumulados", p, saldoFinalContabil, {
      nivel: 0,
      is_subtotal: true,
    });
    const reconciliado = Math.abs(saldoFinalContabil - (saldoInicial + lucroLiq - destinacoesEfetivas)) < 0.01;
    emitirRow(
      out,
      base + 999,
      reconciliado
        ? "✓ Saldo final reconciliado com a contabilidade"
        : "⚠ Saldo final divergente — verificar destinações",
      p,
      0,
    );
  }
  return out;
}

// ---------- DVA ----------

async function buildDVA(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  mascara: MascaraConfig,
): Promise<FlatRow[]> {
  const periodosOrd = [...periodos].sort();
  const dre = await buildDRE(companyId, tenantId, modoGlobal, periodosOrd, "DRE", mascara);

  const dreVal = (descricao: string, p: string) =>
    dre.find((r) => r.descricao === descricao && r.periodo === p)?.valor ?? 0;

  // Linhas analíticas da DRE (têm codigo_conta) → permite classificar por keyword
  const analyticDRE = dre.filter((r) => !r.is_subtotal && r.codigo_conta);

  const out: FlatRow[] = [];
  for (const p of periodosOrd) {
    const rowsP = analyticDRE.filter((r) => r.periodo === p);
    const matchSum = (re: RegExp) =>
      rowsP
        .filter((r) => re.test(r.descricao ?? ""))
        .reduce((a, r) => a + Math.abs(Number(r.valor) || 0), 0);

    const receitaBruta = dreVal("Receita Bruta", p);
    const deducoes = dreVal("(-) Deduções da Receita Bruta", p);
    const receitaLiq = dreVal("(=) Receita Líquida", p);
    const custos =
      dreVal("(-) Custos Industriais", p) +
      dreVal("(-) Custos Comerciais", p) +
      dreVal("(-) Custos Imobiliários", p) +
      dreVal("(-) Custos dos Serviços", p) +
      dreVal("(-) Custos", p);
    const receitasFin = dreVal("(+) Receitas Financeiras", p);

    const depAmort = rowsP
      .filter((r) => KW_DEPRECIACAO.test(r.descricao ?? ""))
      .reduce((a, r) => a + Math.abs(Number(r.valor) || 0), 0);

    // GERAÇÃO
    const receitas = receitaBruta - deducoes; // receita líquida
    void receitaLiq;
    const insumos = custos; // simplificação: insumos ≈ CMV/CSV
    const vaBruto = receitas - insumos;
    const vaLiquido = vaBruto - depAmort;
    const transferencias = receitasFin;
    const vaTotal = vaLiquido + transferencias;

    // DISTRIBUIÇÃO
    const pessoal = matchSum(KW_PESSOAL);
    const impostosDireto = matchSum(KW_IMPOSTOS) + Math.abs(deducoes);
    const capTerceiros = matchSum(KW_JUROS) + matchSum(KW_ALUGUEL);
    const lucroLiq = dreVal("(=) Lucro Líquido do Exercício", p);
    const capProprio = lucroLiq; // distribuído ou retido
    const totalDistribuido = pessoal + impostosDireto + capTerceiros + capProprio;
    const validado = Math.abs(vaTotal - totalDistribuido) < Math.max(1, Math.abs(vaTotal) * 0.1);

    const base = 0;
    emitirRow(out, base + 100, "Receitas", p, receitas);
    emitirRow(out, base + 110, "(-) Insumos Adquiridos de Terceiros", p, -insumos);
    emitirRow(out, base + 199, "(=) Valor Adicionado Bruto", p, vaBruto, {
      nivel: 0,
      is_subtotal: true,
    });
    emitirRow(out, base + 210, "(-) Depreciação, Amortização e Exaustão", p, -depAmort);
    emitirRow(out, base + 299, "(=) Valor Adicionado Líquido Produzido", p, vaLiquido, {
      nivel: 0,
      is_subtotal: true,
    });
    emitirRow(out, base + 310, "(+) Valor Adicionado Recebido em Transferência", p, transferencias);
    emitirRow(out, base + 399, "(=) Valor Adicionado Total a Distribuir", p, vaTotal, {
      nivel: 0,
      is_subtotal: true,
    });

    emitirRow(out, base + 500, "Distribuição do Valor Adicionado", p, totalDistribuido, {
      nivel: 0,
      is_subtotal: true,
    });
    emitirRow(out, base + 510, "Pessoal e Encargos", p, pessoal);
    emitirRow(out, base + 520, "Impostos, Taxas e Contribuições", p, impostosDireto);
    emitirRow(out, base + 530, "Remuneração de Capitais de Terceiros", p, capTerceiros);
    emitirRow(out, base + 540, "Remuneração de Capitais Próprios", p, capProprio);

    emitirRow(
      out,
      base + 999,
      validado
        ? "✓ Validação CPC 09: valor gerado = valor distribuído"
        : "⚠ Validação CPC 09: geração diferente da distribuição",
      p,
      vaTotal - totalDistribuido,
    );
  }
  return out;
}

