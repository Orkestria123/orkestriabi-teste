// Motor de Análise de Receita × Despesa.
// Lê saldos_mensais + plano_contas e devolve a árvore hierárquica desagregada
// (grupo → centro → conta analítica), com totais acumulados em cada nível.
//
// Regras:
//  - Receita: classificações começando com 3.01 ou 3.10  (sinal invertido)
//  - Despesa: classificações começando com 3.06 ou 3.15
//  - movimento na saldos_mensais = total_debitos - total_creditos
//     → receita aparece como negativa; invertemos para positivo.
//  - O somatório se acumula em TODOS os níveis pais da classificação.

import { supabase } from "@/integrations/supabase/client";

const RECEITA_PREFIX = ["3.01", "3.10"];
const DESPESA_PREFIX = ["3.06", "3.15"];

export interface NoArvore {
  classificacao: string; // ex: "3.06.01.01"
  descricao: string;
  nivel: number; // 1..n
  valor: number; // acumulado em todo o subgrupo
  filhos: NoArvore[];
  // calculados posteriormente
  pct_receita?: number;
  pct_pai?: number;
}

export interface ReceitaDespesaDetalhado {
  competencias: string[];
  receita_total: number;
  despesa_total: number;
  raiz_receita: NoArvore; // pseudo-raiz com filhos = grupos de receita (nivel 2: 3.01, 3.10)
  raiz_despesa: NoArvore; // idem para despesa
}

interface PlanoRow {
  codigo: string;
  classificacao: string;
  descricao: string;
  nivel: number;
}

interface SaldoRow {
  conta_codigo: string;
  competencia: string;
  movimento: number;
}

function isReceitaCls(c: string) {
  return RECEITA_PREFIX.some((p) => c === p || c.startsWith(p + "."));
}
function isDespesaCls(c: string) {
  return DESPESA_PREFIX.some((p) => c === p || c.startsWith(p + "."));
}

// Devolve os prefixos cumulativos: "3.06.01.01" → ["3","3.06","3.06.01","3.06.01.01"]
function prefixosDe(classificacao: string): string[] {
  const parts = classificacao.split(".");
  const out: string[] = [];
  for (let i = 1; i <= parts.length; i++) {
    out.push(parts.slice(0, i).join("."));
  }
  return out;
}

async function fetchAllPaginated<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  for (let i = 0; i < 200; i++) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export async function montarReceitaDespesaDetalhado(
  companyId: string,
  competencias: string[],
): Promise<ReceitaDespesaDetalhado> {
  if (!companyId || competencias.length === 0) {
    return emptyDetalhado(competencias);
  }
  // Plano de contas — todas as linhas (analíticas e sintéticas).
  const { data: company } = await supabase
    .from("companies")
    .select("tenant_id")
    .eq("id", companyId)
    .maybeSingle();
  const tenantId = (company as any)?.tenant_id as string | undefined;

  // Plano: empresa + tenant (modo global)
  const plano = await fetchAllPaginated<PlanoRow>((from, to) =>
    supabase
      .from("plano_contas")
      .select("codigo,classificacao,descricao,nivel")
      .or(`company_id.eq.${companyId}${tenantId ? `,company_id.is.null` : ""}`)
      .eq("ativo", true)
      .range(from, to),
  );

  // Saldos do período
  const saldos = await fetchAllPaginated<SaldoRow>((from, to) =>
    supabase
      .from("saldos_mensais")
      .select("conta_codigo,competencia,movimento")
      .eq("company_id", companyId)
      .in("competencia", competencias)
      .range(from, to),
  );

  // index por codigo
  const planoPorCodigo = new Map<string, PlanoRow>();
  for (const p of plano) planoPorCodigo.set(p.codigo, p);
  // index por classificação (para descrição dos níveis intermediários)
  const planoPorClassif = new Map<string, PlanoRow>();
  for (const p of plano) {
    // se já existe, mantém o mais raso (nivel menor)
    const prev = planoPorClassif.get(p.classificacao);
    if (!prev || (p.nivel ?? 99) < (prev.nivel ?? 99)) {
      planoPorClassif.set(p.classificacao, p);
    }
  }

  // mapa acumulado: classificacao → valor
  const acumReceita = new Map<string, number>();
  const acumDespesa = new Map<string, number>();

  for (const s of saldos) {
    const p = planoPorCodigo.get(s.conta_codigo);
    if (!p) continue;
    const cls = p.classificacao;
    if (!cls) continue;
    const isRec = isReceitaCls(cls);
    const isDes = isDespesaCls(cls);
    if (!isRec && !isDes) continue;
    const valor = isRec ? -Number(s.movimento) : Number(s.movimento);
    const target = isRec ? acumReceita : acumDespesa;
    for (const pref of prefixosDe(cls)) {
      target.set(pref, (target.get(pref) ?? 0) + valor);
    }
  }

  const raiz_receita = construirArvore(acumReceita, planoPorClassif, RECEITA_PREFIX, "Receita");
  const raiz_despesa = construirArvore(acumDespesa, planoPorClassif, DESPESA_PREFIX, "Despesa");

  const receita_total = raiz_receita.valor;
  const despesa_total = raiz_despesa.valor;

  // Calcular pct_receita e pct_pai recursivamente
  calcularPercentuais(raiz_receita, receita_total, raiz_receita.valor);
  calcularPercentuais(raiz_despesa, receita_total, raiz_despesa.valor);

  return { competencias, receita_total, despesa_total, raiz_receita, raiz_despesa };
}

function emptyDetalhado(competencias: string[]): ReceitaDespesaDetalhado {
  const r: NoArvore = { classificacao: "", descricao: "Receita", nivel: 0, valor: 0, filhos: [] };
  const d: NoArvore = { classificacao: "", descricao: "Despesa", nivel: 0, valor: 0, filhos: [] };
  return { competencias, receita_total: 0, despesa_total: 0, raiz_receita: r, raiz_despesa: d };
}

function construirArvore(
  acum: Map<string, number>,
  planoPorClassif: Map<string, PlanoRow>,
  raizes: string[],
  rootLabel: string,
): NoArvore {
  const raiz: NoArvore = { classificacao: "", descricao: rootLabel, nivel: 0, valor: 0, filhos: [] };
  // todas as chaves que aparecem
  const chaves = Array.from(acum.keys()).sort();
  // criar nós
  const nos = new Map<string, NoArvore>();
  for (const cls of chaves) {
    const planoRow = planoPorClassif.get(cls);
    const partes = cls.split(".");
    nos.set(cls, {
      classificacao: cls,
      descricao: planoRow?.descricao ?? cls,
      nivel: partes.length,
      valor: acum.get(cls) ?? 0,
      filhos: [],
    });
  }
  // ligar pais e filhos
  for (const cls of chaves) {
    const partes = cls.split(".");
    if (partes.length === 1) {
      // nível 1 (ex: "3") — só agrega na raiz se for um dos prefixos
      // ignorado para raiz: penduramos a partir do nível 2 (3.01, 3.06, etc.)
      continue;
    }
    if (partes.length === 2 && raizes.includes(cls)) {
      raiz.filhos.push(nos.get(cls)!);
      raiz.valor += nos.get(cls)!.valor;
      continue;
    }
    const paiCls = partes.slice(0, -1).join(".");
    const paiNo = nos.get(paiCls);
    if (paiNo) paiNo.filhos.push(nos.get(cls)!);
    else {
      // pai não tem saldo direto — penduramos no nível 2 mais próximo
      const nivel2 = partes.slice(0, 2).join(".");
      if (raizes.includes(nivel2) && nos.has(nivel2)) {
        nos.get(nivel2)!.filhos.push(nos.get(cls)!);
      }
    }
  }
  // ordenar filhos por valor desc
  ordenarRecursivo(raiz);
  return raiz;
}

function ordenarRecursivo(no: NoArvore) {
  no.filhos.sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  for (const f of no.filhos) ordenarRecursivo(f);
}

function calcularPercentuais(no: NoArvore, receita_total: number, pai_valor: number) {
  no.pct_receita = receita_total > 0 ? (Math.abs(no.valor) / receita_total) * 100 : 0;
  no.pct_pai = pai_valor !== 0 ? (Math.abs(no.valor) / Math.abs(pai_valor)) * 100 : 0;
  for (const f of no.filhos) calcularPercentuais(f, receita_total, no.valor);
}

// ---------- helpers ----------

/**
 * Devolve a lista plana de filhos de um nó, com profundidade alvo.
 * profundidade 1 = filhos diretos; 2 = netos; etc.
 */
export function descer(no: NoArvore, profundidade: number): NoArvore[] {
  if (profundidade <= 0) return [no];
  if (no.filhos.length === 0) return [no];
  if (profundidade === 1) return no.filhos;
  return no.filhos.flatMap((f) => descer(f, profundidade - 1));
}

export interface RankingItem {
  classificacao: string;
  descricao: string;
  valor: number;
  pct_receita: number;
  pct_total: number;
  filhos?: RankingItem[];
}

export function rankingDespesas(arv: ReceitaDespesaDetalhado, top = 10): RankingItem[] {
  // pegamos os nivel 4 (centros de atividade) — mais granulares que grupos mas
  // ainda agrupados. Se não houver, pegamos os nivel 3.
  const total = arv.despesa_total;
  const nivel4 = arv.raiz_despesa.filhos.flatMap((g) => g.filhos);
  const candidatos = nivel4.length > 0 ? nivel4 : arv.raiz_despesa.filhos;
  return candidatos
    .filter((n) => Math.abs(n.valor) > 0.01)
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))
    .slice(0, top)
    .map((n) => ({
      classificacao: n.classificacao,
      descricao: n.descricao,
      valor: Math.abs(n.valor),
      pct_receita: n.pct_receita ?? 0,
      pct_total: total > 0 ? (Math.abs(n.valor) / total) * 100 : 0,
      filhos: n.filhos.map((f) => ({
        classificacao: f.classificacao,
        descricao: f.descricao,
        valor: Math.abs(f.valor),
        pct_receita: f.pct_receita ?? 0,
        pct_total: total > 0 ? (Math.abs(f.valor) / total) * 100 : 0,
      })),
    }));
}

export function paretoDespesas(arv: ReceitaDespesaDetalhado): RankingItem[] {
  // contas mais granulares (filhos de centros) — analíticas
  const total = arv.despesa_total;
  const todos: NoArvore[] = [];
  const walk = (n: NoArvore) => {
    if (n.filhos.length === 0 && n.nivel >= 3) todos.push(n);
    else n.filhos.forEach(walk);
  };
  walk(arv.raiz_despesa);
  const sorted = todos
    .filter((n) => Math.abs(n.valor) > 0.01)
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  let acum = 0;
  const out: (RankingItem & { acumuladoPct: number })[] = [];
  for (const n of sorted) {
    acum += Math.abs(n.valor);
    out.push({
      classificacao: n.classificacao,
      descricao: n.descricao,
      valor: Math.abs(n.valor),
      pct_receita: n.pct_receita ?? 0,
      pct_total: total > 0 ? (Math.abs(n.valor) / total) * 100 : 0,
      acumuladoPct: total > 0 ? (acum / total) * 100 : 0,
    });
    if (out.length >= 20) break;
  }
  return out;
}

export function despesaPorCentro(arv: ReceitaDespesaDetalhado): { nome: string; valor: number; pct: number }[] {
  const total = arv.despesa_total;
  // centros = nivel 4 (3.06.01.01, .02, .05, .06...)
  const centros = arv.raiz_despesa.filhos.flatMap((g) => g.filhos);
  return centros
    .filter((c) => Math.abs(c.valor) > 0.01)
    .map((c) => ({
      nome: limparDescricao(c.descricao),
      valor: Math.abs(c.valor),
      pct: total > 0 ? (Math.abs(c.valor) / total) * 100 : 0,
    }))
    .sort((a, b) => b.valor - a.valor);
}

export function composicaoReceita(arv: ReceitaDespesaDetalhado): { nome: string; valor: number; pct: number }[] {
  const total = arv.receita_total;
  // Pegar nivel 3 (descer 1 nível além dos prefixos 3.01/3.10)
  const candidatos = arv.raiz_receita.filhos.flatMap((g) => g.filhos);
  const pool = candidatos.length > 0 ? candidatos : arv.raiz_receita.filhos;
  return pool
    .filter((n) => Math.abs(n.valor) > 0.01 && !/dedu|liquid/i.test(n.descricao))
    .map((n) => ({
      nome: limparDescricao(n.descricao),
      valor: Math.abs(n.valor),
      pct: total > 0 ? (Math.abs(n.valor) / total) * 100 : 0,
    }))
    .sort((a, b) => b.valor - a.valor);
}

export function limparDescricao(s: string): string {
  return (s ?? "")
    .replace(/^\(\-\)\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

// Buscar valor agregado de uma classificação (ex.: receita líquida = 3.01.99)
export function valorClassif(arv: ReceitaDespesaDetalhado, cls: string, lado: "receita" | "despesa"): number {
  const raiz = lado === "receita" ? arv.raiz_receita : arv.raiz_despesa;
  const procurar = (n: NoArvore): number | null => {
    if (n.classificacao === cls) return n.valor;
    for (const f of n.filhos) {
      const v = procurar(f);
      if (v != null) return v;
    }
    return null;
  };
  return Math.abs(procurar(raiz) ?? 0);
}
