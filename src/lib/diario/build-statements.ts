// Montagem de DRE / BP a partir do novo modelo (saldos_mensais + plano_contas + mapeamento).
// Retorna no MESMO shape de linhas usado pelas páginas atuais
// ({ linha_ordem, descricao, codigo_conta, nivel, is_subtotal, periodo, valor }).

import { supabase } from "@/integrations/supabase/client";

type Tipo = "DRE" | "BP_ATIVO" | "BP_PASSIVO" | "DFC";

interface FlatRow {
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
  total_debitos: number;
  total_creditos: number;
  movimento: number;
}
interface Abertura {
  conta_codigo: string;
  data_referencia: string;
  saldo: number;
}

const SKIP_APURACAO = /\.(98|99)(\.|$)/;

function buildMatcher(mapas: Mapa[]) {
  // Ordena por prefixo mais específico (mais longo) primeiro
  const sorted = [...mapas].sort(
    (a, b) => b.classificacao_prefixo.length - a.classificacao_prefixo.length,
  );
  return (classificacao: string): Mapa | null => {
    for (const m of sorted) {
      if (classificacao.startsWith(m.classificacao_prefixo)) return m;
    }
    return null;
  };
}

// Helper: pagina queries do PostgREST (limite padrão de 1000 linhas por página).
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

// Busca apenas as contas do plano que aparecem nos saldos — evita carregar
// dezenas de milhares de participantes (clientes/fornecedores) inúteis aqui.
async function getPlanoPorCodigos(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  codigos: string[],
): Promise<Plano[]> {
  if (codigos.length === 0) return [];
  const out: Plano[] = [];
  const CHUNK = 300;
  for (let i = 0; i < codigos.length; i += CHUNK) {
    const slice = codigos.slice(i, i + CHUNK);
    const rows = await fetchAllPaginated<Plano>((from, to) => {
      const q = supabase
        .from("plano_contas")
        .select("codigo, classificacao, is_participante")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .in("codigo", slice)
        .range(from, to);
      return modoGlobal ? q.is("company_id", null) : q.eq("company_id", companyId);
    });
    out.push(...rows);
  }
  return out;
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
    total_debitos: Number(r.total_debitos) || 0,
    total_creditos: Number(r.total_creditos) || 0,
    movimento: Number(r.movimento) || 0,
  }));
}

async function getSaldosAcumulado(
  companyId: string,
  ateData: string,
): Promise<Map<string, number>> {
  const rows = await fetchAllPaginated<any>((from, to) =>
    supabase
      .from("saldos_mensais")
      .select("conta_codigo, movimento")
      .eq("company_id", companyId)
      .lte("competencia", ateData)
      .range(from, to),
  );
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.conta_codigo, (m.get(r.conta_codigo) ?? 0) + (Number(r.movimento) || 0));
  }
  return m;
}

async function getAberturaMaisRecente(companyId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("saldos_abertura")
    .select("conta_codigo, data_referencia, saldo")
    .eq("company_id", companyId)
    .order("data_referencia", { ascending: false });
  if (error) throw error;
  const m = new Map<string, number>();
  const seenData = new Map<string, string>(); // conta → data mais recente
  for (const r of (data ?? []) as Abertura[]) {
    if (!seenData.has(r.conta_codigo)) {
      seenData.set(r.conta_codigo, r.data_referencia);
      m.set(r.conta_codigo, Number(r.saldo) || 0);
    }
  }
  return m;
}

// ============================================================
// DRE / DFC: fluxo — soma dos movimentos do período
// ============================================================
async function buildDRE(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  tipo: "DRE" | "DFC",
): Promise<FlatRow[]> {
  const [mapas, saldos] = await Promise.all([
    getMapa(companyId, tenantId, modoGlobal, tipo),
    getSaldos(companyId, periodos),
  ]);
  const codigos = Array.from(new Set(saldos.map((s) => s.conta_codigo)));
  const plano = await getPlanoPorCodigos(companyId, tenantId, modoGlobal, codigos);

  const planoMap = new Map<string, Plano>();
  for (const p of plano) planoMap.set(p.codigo, p);

  const matcher = buildMatcher(mapas);

  // linha → { ordem, inverter } e linha → periodo → valor
  const linhaMeta = new Map<string, { ordem: number; inverter: boolean }>();
  for (const m of mapas) {
    if (!linhaMeta.has(m.linha_demonstracao)) {
      linhaMeta.set(m.linha_demonstracao, { ordem: m.ordem, inverter: m.inverter_sinal });
    }
  }

  const acc = new Map<string, Map<string, number>>();
  const ensure = (linha: string) => {
    let v = acc.get(linha);
    if (!v) { v = new Map(); acc.set(linha, v); }
    return v;
  };

  for (const s of saldos) {
    const conta = planoMap.get(s.conta_codigo);
    if (!conta) continue;
    if (conta.is_participante) continue;
    if (SKIP_APURACAO.test(conta.classificacao)) continue;
    const m = matcher(conta.classificacao);
    if (!m) continue;
    const valor = m.inverter_sinal ? -s.movimento : s.movimento;
    const v = ensure(m.linha_demonstracao);
    v.set(s.competencia, (v.get(s.competencia) ?? 0) + valor);
  }

  // garantir todas as linhas mesmo com valor zero
  for (const m of mapas) ensure(m.linha_demonstracao);

  const linhasOrdenadas = Array.from(acc.keys()).sort((a, b) => {
    const oa = linhaMeta.get(a)?.ordem ?? 0;
    const ob = linhaMeta.get(b)?.ordem ?? 0;
    return oa - ob;
  });

  const out: FlatRow[] = [];
  linhasOrdenadas.forEach((linha, idx) => {
    const meta = linhaMeta.get(linha)!;
    const isSub = /^\(=\)/.test(linha) || /líquid[oa]|bruto|lucro|prejuiz|resultado/i.test(linha);
    for (const p of periodos) {
      out.push({
        linha_ordem: meta.ordem || (idx + 1) * 10,
        descricao: linha,
        codigo_conta: null,
        nivel: 1,
        is_subtotal: isSub,
        periodo: p,
        valor: acc.get(linha)?.get(p) ?? 0,
      });
    }
  });

  // subtotais calculados (DRE)
  if (tipo === "DRE") {
    addDRECalculatedTotals(out, periodos);
  }
  return out;
}

function addDRECalculatedTotals(rows: FlatRow[], periodos: string[]) {
  // pega valor por (descricao, periodo)
  const idx = new Map<string, number>();
  rows.forEach((r, i) => idx.set(`${r.descricao}|${r.periodo}`, i));
  const v = (desc: string, p: string) => rows[idx.get(`${desc}|${p}`) ?? -1]?.valor ?? 0;

  const targets = [
    { linha: "Receita Líquida (calc)", ordem: 199, calc: (p: string) => v("Receita Bruta", p) + v("(-) Deduções da Receita Bruta", p) },
    {
      linha: "Lucro Bruto",
      ordem: 299,
      calc: (p: string) =>
        v("Receita Líquida (calc)", p) +
        v("(-) Custos Industriais", p) + v("(-) Custos Comerciais", p) +
        v("(-) Custos Imobiliários", p) + v("(-) Custos dos Serviços", p) + v("(-) Custos", p),
    },
    {
      linha: "Resultado Operacional (EBIT)",
      ordem: 499,
      calc: (p: string) =>
        v("Lucro Bruto", p) +
        v("(-) Despesas Operacionais", p) + v("(-) Despesas Administrativas", p) + v("(-) Despesas Comerciais", p) +
        v("(+) Outras Receitas Operacionais", p) + v("(-) Outras Despesas Operacionais", p),
    },
    {
      linha: "Lucro Antes do IR/CSLL",
      ordem: 599,
      calc: (p: string) =>
        v("Resultado Operacional (EBIT)", p) +
        v("(+) Receitas Financeiras", p) + v("(-) Despesas Financeiras", p),
    },
    {
      linha: "Lucro Líquido do Exercício",
      ordem: 699,
      calc: (p: string) => v("Lucro Antes do IR/CSLL", p) + v("(-) IR/CSLL", p),
    },
  ];
  for (const t of targets) {
    for (const p of periodos) {
      rows.push({
        linha_ordem: t.ordem,
        descricao: t.linha === "Receita Líquida (calc)" ? "(=) Receita Líquida" : `(=) ${t.linha}`,
        codigo_conta: null,
        nivel: 0,
        is_subtotal: true,
        periodo: p,
        valor: t.calc(p),
      });
    }
  }
  rows.sort((a, b) => a.linha_ordem - b.linha_ordem || a.periodo.localeCompare(b.periodo));
}

// ============================================================
// BP: posição acumulada (abertura + Σ movimento até a competência)
// ============================================================
async function buildBP(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  tipo: "BP_ATIVO" | "BP_PASSIVO",
): Promise<FlatRow[]> {
  const [mapas, abertura, saldosTodos] = await Promise.all([
    getMapa(companyId, tenantId, modoGlobal, tipo),
    getAberturaMaisRecente(companyId),
    // Carrega todos os saldos até o período mais recente para deduzir códigos usados
    getSaldosAcumulado(companyId, [...periodos].sort().pop() ?? periodos[0]),
  ]);
  const codigosUsados = Array.from(new Set([
    ...abertura.keys(),
    ...saldosTodos.keys(),
  ]));
  const plano = await getPlanoPorCodigos(companyId, tenantId, modoGlobal, codigosUsados);

  const planoMap = new Map<string, Plano>();
  for (const p of plano) planoMap.set(p.codigo, p);
  const matcher = buildMatcher(mapas);
  const linhaMeta = new Map<string, { ordem: number; inverter: boolean }>();
  for (const m of mapas) {
    if (!linhaMeta.has(m.linha_demonstracao)) {
      linhaMeta.set(m.linha_demonstracao, { ordem: m.ordem, inverter: m.inverter_sinal });
    }
  }

  // Para cada período de referência, calcular saldo acumulado por conta
  const periodosOrd = [...periodos].sort();
  const out: FlatRow[] = [];

  // Pré-busca: saldo acumulado até cada período de referência
  for (const ref of periodosOrd) {
    const acumulado = await getSaldosAcumulado(companyId, ref);
    const valoresPorLinha = new Map<string, number>();
    for (const [codigo, mov] of acumulado) {
      const conta = planoMap.get(codigo);
      if (!conta || conta.is_participante) continue;
      if (SKIP_APURACAO.test(conta.classificacao)) continue;
      const m = matcher(conta.classificacao);
      if (!m) continue;
      const saldoAbert = abertura.get(codigo) ?? 0;
      // saldo = abertura + movimento acumulado (movimento = débito - crédito)
      const saldoBruto = saldoAbert + mov;
      // Ativo: positivo se devedor. Passivo: inverter para exibir credor positivo.
      const valor = m.inverter_sinal ? -saldoBruto : saldoBruto;
      valoresPorLinha.set(m.linha_demonstracao, (valoresPorLinha.get(m.linha_demonstracao) ?? 0) + valor);
    }
    for (const m of mapas) {
      if (!valoresPorLinha.has(m.linha_demonstracao)) {
        valoresPorLinha.set(m.linha_demonstracao, 0);
      }
    }
    const linhasOrd = Array.from(valoresPorLinha.keys()).sort(
      (a, b) => (linhaMeta.get(a)?.ordem ?? 0) - (linhaMeta.get(b)?.ordem ?? 0),
    );
    linhasOrd.forEach((linha, idx) => {
      out.push({
        linha_ordem: linhaMeta.get(linha)?.ordem ?? (idx + 1) * 10,
        descricao: linha,
        codigo_conta: null,
        nivel: 1,
        is_subtotal: false,
        periodo: ref,
        valor: valoresPorLinha.get(linha) ?? 0,
      });
    });
    // Total
    const total = Array.from(valoresPorLinha.values()).reduce((a, b) => a + b, 0);
    out.push({
      linha_ordem: 9999,
      descricao: tipo === "BP_ATIVO" ? "Total do Ativo" : "Total do Passivo + PL",
      codigo_conta: null,
      nivel: 0,
      is_subtotal: true,
      periodo: ref,
      valor: total,
    });
  }

  return out;
}

// ============================================================
// Entry point: roteia conforme tipo
// ============================================================
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
