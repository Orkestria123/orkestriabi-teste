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

type Tipo = "DRE" | "BP_ATIVO" | "BP_PASSIVO" | "DFC";

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
}

const SKIP_APURACAO = /\.(98|99)(\.|$)/;

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

function buildMatcher(mapas: Mapa[]) {
  const sorted = [...mapas].sort(
    (a, b) => b.classificacao_prefixo.length - a.classificacao_prefixo.length,
  );
  return (classificacao: string): Mapa | null => {
    for (const m of sorted) {
      if (classificacao === m.classificacao_prefixo || classificacao.startsWith(m.classificacao_prefixo + ".")) {
        return m;
      }
    }
    return null;
  };
}

// Retorna o prefixo de uma classificação até `nivelMax` segmentos.
// Ex.: "3.01.01.02.21" com nivelMax=4 → "3.01.01.02"
function prefixoAteNivel(classificacao: string, nivelMax: number): string {
  const parts = classificacao.split(".");
  if (parts.length <= nivelMax) return classificacao;
  return parts.slice(0, nivelMax).join(".");
}

async function getPlanoPorTipo(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  tiposPlano: string[],
): Promise<Plano[]> {
  return fetchAllPaginated<Plano>((from, to) => {
    const q = supabase
      .from("plano_contas")
      .select("codigo, classificacao, descricao, nivel, is_participante")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .eq("is_participante", false)
      .in("tipo", tiposPlano)
      .range(from, to);
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
): { mapa: Mapa; classificacao: string; valor: number }[] {
  const out: { mapa: Mapa; classificacao: string; valor: number }[] = [];
  for (const [codigo, valor] of saldosPorConta) {
    const conta = planoMap.get(codigo);
    if (!conta) continue;
    if (conta.is_participante) continue;
    if (SKIP_APURACAO.test(conta.classificacao)) continue;
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
  const profMin = Math.min(...pontos.map((p) => p.classificacao.split(".").length));
  const niv1 = profMin; // grupos diretos abaixo do parent
  const niv2 = profMin + 1; // detalhe

  const agrupadoN1 = new Map<string, NodeAgg>();
  const agrupadoN2 = new Map<string, Map<string, NodeAgg>>(); // n1 → n2 → agg

  for (const p of pontos) {
    const k1 = prefixoAteNivel(p.classificacao, niv1);
    const k2 = prefixoAteNivel(p.classificacao, niv2);
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

// ---------- DRE / DFC ----------

async function buildDRE(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  tipo: "DRE" | "DFC",
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
  const matcher = buildMatcher(mapas);

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
    // saldos por conta no período
    const saldosPorConta = new Map<string, number>();
    for (const s of saldos) {
      if (s.competencia !== p) continue;
      saldosPorConta.set(
        s.conta_codigo,
        (saldosPorConta.get(s.conta_codigo) ?? 0) + s.movimento,
      );
    }

    const pontos = aplicarMapaESinal(saldosPorConta, planoMap, matcher);

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
        nivelPlano: conta?.nivel ?? pt.classificacao.split(".").length,
      });
    }

    // Emite hierarquia por linha mapeada (ordenadas)
    const linhasOrd = Array.from(porLinha.entries()).sort(
      (a, b) => a[1].ordem - b[1].ordem,
    );
    for (const [linha, info] of linhasOrd) {
      const base = info.ordem * 1000;
      out.push(...emitirHierarquia({ linha, ordem: info.ordem }, info.itens, p, base, planoPrefixos));
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
): Promise<FlatRow[]> {
  const tipoPlano = tipo === "BP_ATIVO" ? ["1-Ativo"] : ["2-Passivo"];
  const ateData = [...periodos].sort().pop()!;

  const [mapas, plano, abertura, saldosAcum] = await Promise.all([
    getMapa(companyId, tenantId, modoGlobal, tipo),
    getPlanoPorTipo(companyId, tenantId, modoGlobal, tipoPlano),
    getAberturaMaisRecente(companyId),
    getSaldosAteData(companyId, ateData),
  ]);

  const planoMap = new Map<string, Plano>();
  const planoPorClassificacao = new Map<string, Plano>();
  const planoPrefixos = new Map<string, string>();
  for (const p of plano) {
    planoMap.set(p.codigo, p);
    planoPorClassificacao.set(p.classificacao, p);
    planoPrefixos.set(p.classificacao, p.descricao);
  }
  const matcher = buildMatcher(mapas);

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
    const pontos = aplicarMapaESinal(snapshot, planoMap, matcher);

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
        nivelPlano: conta?.nivel ?? pt.classificacao.split(".").length,
      });
    }

    const linhasOrd = Array.from(porLinha.entries()).sort(
      (a, b) => a[1].ordem - b[1].ordem,
    );
    let totalLado = 0;
    for (const [linha, info] of linhasOrd) {
      const base = info.ordem * 1000;
      const linhas = emitirHierarquia(
        { linha, ordem: info.ordem },
        info.itens,
        ref,
        base,
        planoPrefixos,
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
  if (tipo === "DRE" || tipo === "DFC") {
    return buildDRE(companyId, tenantId, modoGlobal, periodos, tipo);
  }
  return buildBP(companyId, tenantId, modoGlobal, periodos, tipo);
}
