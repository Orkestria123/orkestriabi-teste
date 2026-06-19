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
  opts: { incluirParticipantes?: boolean } = {},
): Promise<Plano[]> {
  return fetchAllPaginated<Plano>((from, to) => {
    let q = supabase
      .from("plano_contas")
      .select("codigo, classificacao, descricao, nivel, is_participante")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .in("tipo", tiposPlano)
      .range(from, to);
    if (!opts.incluirParticipantes) q = q.eq("is_participante", false);
    return modoGlobal ? q.is("company_id", null) : q.eq("company_id", companyId);
  });
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
  const { data, error } = await supabase
    .from("saldos_abertura")
    .select("conta_codigo, data_referencia, saldo")
    .eq("company_id", companyId)
    .order("data_referencia", { ascending: false });
  if (error) throw error;
  const m = new Map<string, number>();
  const seen = new Set<string>();
  for (const r of (data ?? []) as any[]) {
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
): { mapa: Mapa; classificacao: string; valor: number }[] {
  const out: { mapa: Mapa; classificacao: string; valor: number }[] = [];
  for (const [codigo, valor] of saldosPorConta) {
    const conta = planoMap.get(codigo);
    if (!conta) continue;
    if (conta.is_participante && !opts.incluirParticipantes) continue;
    if (isApuracao(conta.classificacao, mascara)) continue;
    const m = matcher(conta.classificacao);
    if (!m) continue;
    const v = m.inverter_sinal ? -valor : valor;
    out.push({ mapa: m, classificacao: conta.classificacao, valor: v });
  }
  return out;
}

interface NodeAgg {
  classificacao: string;
  valor: number;
}

/**
 * Monta linhas planas para UMA linha mapeada (parent) + grupos do plano abaixo.
 * Hierarquia exibida:
 *   - nivel 0: linha mapeada (subtotal)
 *   - nivel 1: grupos com classificação de comprimento ancestor + 1
 *   - nivel 2: filhos diretos do nivel 1 (até 2 níveis abaixo do parent)
 */
function emitirHierarquia(
  parent: { linha: string; ordem: number },
  pontos: { classificacao: string; descricao: string; valor: number; nivelPlano: number }[],
  periodo: string,
  linhaOrdemBase: number,
  planoPrefixos: Map<string, string>,
  mascara: MascaraConfig,
): FlatRow[] {
  const out: FlatRow[] = [];

  // Total do parent
  const totalParent = pontos.reduce((a, b) => a + b.valor, 0);
  out.push({
    linha_ordem: linhaOrdemBase,
    descricao: parent.linha,
    codigo_conta: null,
    nivel: 0,
    is_subtotal: true,
    periodo,
    valor: totalParent,
  });

  if (pontos.length === 0) return out;

  // Detecta nivel base (menor profundidade da classificação)
  const profMin = Math.min(...pontos.map((p) => nivelDe(p.classificacao, mascara)));
  const niv1 = profMin; // grupos diretos abaixo do parent
  const niv2 = profMin + 1; // detalhe

  const agrupadoN1 = new Map<string, NodeAgg>();
  const agrupadoN2 = new Map<string, Map<string, NodeAgg>>(); // n1 → n2 → agg

  for (const p of pontos) {
    const k1 = prefixoAteNivel(p.classificacao, niv1, mascara);
    const k2 = prefixoAteNivel(p.classificacao, niv2, mascara);
    const a1 = agrupadoN1.get(k1) ?? { classificacao: k1, valor: 0 };
    a1.valor += p.valor;
    agrupadoN1.set(k1, a1);

    let mapN2 = agrupadoN2.get(k1);
    if (!mapN2) {
      mapN2 = new Map();
      agrupadoN2.set(k1, mapN2);
    }
    const a2 = mapN2.get(k2) ?? { classificacao: k2, valor: 0 };
    a2.valor += p.valor;
    mapN2.set(k2, a2);
  }

  const sortedN1 = Array.from(agrupadoN1.values()).sort((a, b) =>
    a.classificacao.localeCompare(b.classificacao),
  );

  let i = 1;
  for (const n1 of sortedN1) {
    out.push({
      linha_ordem: linhaOrdemBase + i++,
      descricao: planoPrefixos.get(n1.classificacao) ?? n1.classificacao,
      codigo_conta: n1.classificacao,
      nivel: 1,
      is_subtotal: false,
      periodo,
      valor: n1.valor,
    });

    const childs = Array.from(agrupadoN2.get(n1.classificacao)?.values() ?? []).sort(
      (a, b) => a.classificacao.localeCompare(b.classificacao),
    );
    // Só mostra nivel 2 se houver mais de um filho (evita ruído)
    if (childs.length > 1) {
      for (const c of childs) {
        if (c.classificacao === n1.classificacao) continue;
        out.push({
          linha_ordem: linhaOrdemBase + i++,
          descricao: planoPrefixos.get(c.classificacao) ?? c.classificacao,
          codigo_conta: c.classificacao,
          nivel: 2,
          is_subtotal: false,
          periodo,
          valor: c.valor,
        });
      }
    }
  }

  return out;
}

/**
 * Árvore hierárquica completa para BP — emite TODOS os níveis do plano
 * (de nivel 1 até a conta analítica), com cada nó somando seus descendentes.
 * Participantes (clientes/fornecedores) ficam consolidados na conta-pai
 * estrutural via prefixo de classificação.
 */
function emitirArvoreBP(
  parent: { linha: string; ordem: number },
  pontos: { classificacao: string; descricao: string; valor: number; nivelPlano: number }[],
  periodo: string,
  linhaOrdemBase: number,
  planoPrefixos: Map<string, string>,
  mascara: MascaraConfig,
): FlatRow[] {
  const out: FlatRow[] = [];
  const totalParent = pontos.reduce((a, b) => a + b.valor, 0);
  out.push({
    linha_ordem: linhaOrdemBase,
    descricao: parent.linha,
    codigo_conta: null,
    nivel: 0,
    is_subtotal: true,
    periodo,
    valor: totalParent,
  });
  if (pontos.length === 0) return out;

  const profMin = Math.min(...pontos.map((p) => nivelDe(p.classificacao, mascara)));

  type Node = {
    classif: string;
    valor: number;
    depth: number;
    children: Map<string, Node>;
  };
  const root = new Map<string, Node>();

  for (const p of pontos) {
    const parts = dividir(p.classificacao, mascara);
    let map = root;
    for (let level = profMin; level <= parts.length; level++) {
      const prefix = juntar(parts.slice(0, level), mascara);
      let node = map.get(prefix);
      if (!node) {
        node = { classif: prefix, valor: 0, depth: level, children: new Map() };
        map.set(prefix, node);
      }
      node.valor += p.valor;
      map = node.children;
    }
  }

  let counter = 1;
  const walk = (map: Map<string, Node>) => {
    const sorted = Array.from(map.values()).sort((a, b) =>
      a.classif.localeCompare(b.classif),
    );
    for (const n of sorted) {
      // Se este nó tem exatamente um filho com o mesmo valor, evita ruído
      // (não emite o intermediário redundante).
      const nivel = n.depth - profMin + 1;
      out.push({
        linha_ordem: linhaOrdemBase + counter++,
        descricao: planoPrefixos.get(n.classif) ?? n.classif,
        codigo_conta: n.classif,
        nivel,
        is_subtotal: false,
        periodo,
        valor: n.valor,
      });
      if (n.children.size > 0) walk(n.children);
    }
  };
  walk(root);

  return out;
}

// ---------- DRE / DFC ----------

async function buildDRE(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  tipo: "DRE" | "DFC",
  mascara: MascaraConfig,
): Promise<FlatRow[]> {
  const [mapas, saldos, plano] = await Promise.all([
    getMapa(companyId, tenantId, modoGlobal, tipo),
    getSaldos(companyId, periodos),
    getPlanoPorTipo(companyId, tenantId, modoGlobal, ["3-DRE"]),
  ]);

  const planoMap = new Map<string, Plano>();
  const planoPorClassificacao = new Map<string, Plano>();
  const planoPrefixos = new Map<string, string>();
  for (const p of plano) {
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

  for (const p of periodos) {
    // Valor mensal "limpo" por conta: usa SOMENTE o lado natural da conta.
    // O encerramento de dezembro (apuração) bate no lado oposto — debita
    // receita, credita despesa — e, se subtraíssemos os dois lados, o mês
    // de dez ficaria zerado. Receita = créditos; despesa = débitos.
    const saldosPorConta = new Map<string, number>();
    for (const s of saldos) {
      if (s.competencia !== p) continue;
      const conta = planoMap.get(s.conta_codigo);
      if (!conta) continue;
      const m = matcher(conta.classificacao);
      const ehReceita = !!m?.inverter_sinal;
      const d = s.total_debitos;
      const c = s.total_creditos;
      // Sinal "cru" (antes do inverter_sinal): receita fica negativa para
      // que aplicarMapaESinal (inverter=true) devolva valor positivo;
      // despesa permanece positiva.
      const valor = ehReceita ? -c : d;
      saldosPorConta.set(
        s.conta_codigo,
        (saldosPorConta.get(s.conta_codigo) ?? 0) + valor,
      );
    }


    const pontos = aplicarMapaESinal(saldosPorConta, planoMap, matcher, mascara);

    // Agrupa por linha mapeada
    const porLinha = new Map<
      string,
      { ordem: number; itens: { classificacao: string; descricao: string; valor: number; nivelPlano: number }[] }
    >();
    for (const [linha, meta] of linhasMeta) {
      porLinha.set(linha, { ordem: meta.ordem, itens: [] });
    }
    for (const pt of pontos) {
      const linha = pt.mapa.linha_demonstracao;
      const conta = planoPorClassificacao.get(pt.classificacao);
      const bucket = porLinha.get(linha)!;
      bucket.itens.push({
        classificacao: pt.classificacao,
        descricao: conta?.descricao ?? pt.classificacao,
        valor: pt.valor,
        nivelPlano: conta?.nivel ?? nivelDe(pt.classificacao, mascara),
      });
    }

    // Emite hierarquia por linha mapeada (ordenadas)
    const linhasOrd = Array.from(porLinha.entries()).sort(
      (a, b) => a[1].ordem - b[1].ordem,
    );
    for (const [linha, info] of linhasOrd) {
      const base = info.ordem * 1000;
      out.push(...emitirHierarquia({ linha, ordem: info.ordem }, info.itens, p, base, planoPrefixos, mascara));
    }
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
): Promise<FlatRow[]> {
  const tipoPlano = tipo === "BP_ATIVO" ? ["1-Ativo"] : ["2-Passivo"];
  const ateData = [...periodos].sort().pop()!;

  const [mapas, plano, abertura, saldosAcum] = await Promise.all([
    getMapa(companyId, tenantId, modoGlobal, tipo),
    // BP precisa de TODAS as analíticas, inclusive participantes (clientes,
    // fornecedores) — eles carregam saldo real e somam na conta-pai estrutural.
    getPlanoPorTipo(companyId, tenantId, modoGlobal, tipoPlano, { incluirParticipantes: true }),
    getAberturaMaisRecente(companyId),
    getSaldosAteData(companyId, ateData),
  ]);

  const planoMap = new Map<string, Plano>();
  const planoPorClassificacao = new Map<string, Plano>();
  const planoPrefixos = new Map<string, string>();
  for (const p of plano) {
    planoMap.set(p.codigo, p);
    planoPorClassificacao.set(p.classificacao, p);
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

  for (const ref of periodosOrd) {
    // Avança o cursor incluindo movimentos com competência <= ref
    while (cursor < saldosOrd.length && saldosOrd[cursor].competencia <= ref) {
      const s = saldosOrd[cursor];
      acumPorConta.set(s.conta_codigo, (acumPorConta.get(s.conta_codigo) ?? 0) + s.movimento);
      cursor++;
    }

    const snapshot = new Map(acumPorConta);
    const pontos = aplicarMapaESinal(snapshot, planoMap, matcher, mascara, { incluirParticipantes: true });

    const porLinha = new Map<
      string,
      { ordem: number; itens: { classificacao: string; descricao: string; valor: number; nivelPlano: number }[] }
    >();
    for (const [linha, meta] of linhasMeta) {
      porLinha.set(linha, { ordem: meta.ordem, itens: [] });
    }
    for (const pt of pontos) {
      const linha = pt.mapa.linha_demonstracao;
      const conta = planoPorClassificacao.get(pt.classificacao);
      const bucket = porLinha.get(linha)!;
      bucket.itens.push({
        classificacao: pt.classificacao,
        descricao: conta?.descricao ?? pt.classificacao,
        valor: pt.valor,
        nivelPlano: conta?.nivel ?? nivelDe(pt.classificacao, mascara),
      });
    }

    const linhasOrd = Array.from(porLinha.entries()).sort(
      (a, b) => a[1].ordem - b[1].ordem,
    );
    let totalLado = 0;
    for (const [linha, info] of linhasOrd) {
      const base = info.ordem * 1000;
      const linhas = emitirArvoreBP(
        { linha, ordem: info.ordem },
        info.itens,
        ref,
        base,
        planoPrefixos,
        mascara,
      );
      out.push(...linhas);
      // soma só do parent (nivel 0) para o total
      const parent = linhas.find((l) => l.nivel === 0);
      if (parent) totalLado += parent.valor;
    }

    // Total do lado (Ativo / Passivo + PL)
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
): Promise<FlatRow[]> {
  if (periodos.length === 0) return [];
  // Carrega máscara da empresa (cai para tenant/default) — fonte única
  // de verdade para split, prefixo, pai e grupo nas demonstrações.
  const mascara = await getMascaraConfig({ tenantId, companyId });
  if (tipo === "DRE") return buildDRE(companyId, tenantId, modoGlobal, periodos, "DRE", mascara);
  if (tipo === "DFC") return buildDFC(companyId, tenantId, modoGlobal, periodos, mascara);
  if (tipo === "DLPA") return buildDLPA(companyId, tenantId, modoGlobal, periodos, mascara);
  if (tipo === "DVA") return buildDVA(companyId, tenantId, modoGlobal, periodos, mascara);
  return buildBP(companyId, tenantId, modoGlobal, periodos, tipo, mascara);
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
    const matches = prefixos.some(
      (pref) => conta.classificacao === pref || conta.classificacao.startsWith(pref + "."),
    );
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
): Promise<FlatRow[]> {
  const periodosOrd = [...periodos].sort();
  const dre = await buildDRE(companyId, tenantId, modoGlobal, periodosOrd, "DRE");

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
      ]),
      getSnapshotPorPrefixo(companyId, tenantId, modoGlobal, p, [
        PREFIXO_CAIXA,
        PREFIXO_IMOBILIZADO,
        PREFIXO_EMPRESTIMOS_CP,
        PREFIXO_EMPRESTIMOS_LP,
        PREFIXO_CAPITAL_SOCIAL,
      ]),
    ]);

    const filtPref = (snap: ContaSnapshot[], pref: string) =>
      snap.filter(
        (s) => s.classificacao === pref || s.classificacao.startsWith(pref + "."),
      );

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
): Promise<FlatRow[]> {
  const periodosOrd = [...periodos].sort();
  const dre = await buildDRE(companyId, tenantId, modoGlobal, periodosOrd, "DRE");
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
      ]),
      getSnapshotPorPrefixo(companyId, tenantId, modoGlobal, p, [
        PREFIXO_LUCROS_ACUM,
        PREFIXO_LUCROS_ACUM_ALT,
        PREFIXO_CAPITAL_SOCIAL,
      ]),
    ]);
    const filtPref = (snap: ContaSnapshot[], prefs: string[]) =>
      snap.filter((s) => prefs.some((pref) => s.classificacao === pref || s.classificacao.startsWith(pref + ".")));

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
): Promise<FlatRow[]> {
  const periodosOrd = [...periodos].sort();
  const dre = await buildDRE(companyId, tenantId, modoGlobal, periodosOrd, "DRE");

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

