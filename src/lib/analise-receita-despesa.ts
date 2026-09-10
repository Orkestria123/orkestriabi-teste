// Motor de Análise de Receita × Despesa.
// Lê saldos_mensais + plano_contas + mapeamento_demonstracao e devolve a
// árvore hierárquica desagregada (grupo → centro → conta analítica), com
// totais acumulados em cada nível.
//
// Regras:
//  - Os prefixos de Receita e Despesa são obtidos do mapeamento_demonstracao
//    da DRE. Uma linha é "receita" quando o rótulo NÃO começa com "(-)" e
//    "despesa" quando começa com "(-)". O inverter_sinal aplica o ajuste
//    de sinal vindo da contabilidade (receitas têm natureza credora).
//  - Se não houver mapeamento, cai para o padrão histórico
//    (3.01/3.10 receita; 3.06/3.15 despesa).
//  - O somatório se acumula em TODOS os níveis pais da classificação.

import { supabase } from "@/integrations/supabase/client";
import { getMapaDeLinhas } from "@/lib/plano/mapa-linhas";

const DEFAULT_RECEITA_PREFIX = ["3.01", "3.10"];
const DEFAULT_DESPESA_PREFIX = ["3.06", "3.15"];

export interface NoArvore {
  classificacao: string;
  descricao: string;
  nivel: number;
  valor: number;
  filhos: NoArvore[];
  pct_receita?: number;
  pct_pai?: number;
}

export interface ReceitaDespesaDetalhado {
  competencias: string[];
  receita_total: number;
  despesa_total: number;
  raiz_receita: NoArvore;
  raiz_despesa: NoArvore;
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
  total_debitos: number;
  total_creditos: number;
}


interface MapeamentoRow {
  classificacao_prefixo: string;
  linha_demonstracao: string;
  inverter_sinal: boolean;
}

type Lado = "receita" | "despesa";

interface PrefixoMapeado {
  prefixo: string;
  lado: Lado;
  inverter: boolean;
  linha: string;
}

function ladoDaLinha(linha: string, inverter: boolean): Lado {
  const s = (linha ?? "").trim();
  if (s.startsWith("(-)")) return "despesa";
  if (s.startsWith("(+)")) return "receita";
  // Sem marcador: receita se inverter (natureza credora), senão despesa.
  return inverter ? "receita" : "despesa";
}

function matchPrefixoMaisLongo(cls: string, prefixos: PrefixoMapeado[]): PrefixoMapeado | null {
  let best: PrefixoMapeado | null = null;
  for (const p of prefixos) {
    if (cls === p.prefixo || cls.startsWith(p.prefixo + ".")) {
      if (!best || p.prefixo.length > best.prefixo.length) best = p;
    }
  }
  return best;
}

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

  const { data: company } = await supabase
    .from("companies")
    .select("tenant_id")
    .eq("id", companyId)
    .maybeSingle();
  const tenantId = (company as any)?.tenant_id as string | undefined;

  // Plano: empresa + global (tenant). Só contas de resultado (classif. "3.*")
  // — o plano completo pode ter dezenas de milhares de contas analíticas
  // (clientes/fornecedores) que não interessam para Receita × Despesa.
  const plano = await fetchAllPaginated<PlanoRow>((from, to) =>
    supabase
      .from("plano_contas")
      .select("codigo,classificacao,descricao,nivel")
      .or(`company_id.eq.${companyId}${tenantId ? `,company_id.is.null` : ""}`)
      .eq("ativo", true)
      .like("classificacao", "3.%")
      .range(from, to),
  );

  // Mapeamento DRE — agora derivado dos MARCOS do plano
  // (mapeamento_demonstracao foi removida no ajuste 03).
  const mapeamento = await getMapaDeLinhas(companyId, tenantId ?? "", !!tenantId, "DRE");

  // Lista de prefixos mapeados, com lado e sinal.
  const prefixosMapeados: PrefixoMapeado[] = mapeamento.map((m) => ({
    prefixo: m.classificacao_prefixo,
    lado: ladoDaLinha(m.linha_demonstracao, !!m.inverter_sinal),
    inverter: !!m.inverter_sinal,
    linha: m.linha_demonstracao,
  }));

  // Saldos do período
  const saldos = await fetchAllPaginated<SaldoRow>((from, to) =>
    supabase
      .from("saldos_mensais")
      .select("conta_codigo,competencia,movimento,total_debitos,total_creditos")
      .eq("company_id", companyId)
      .in("competencia", competencias)
      .range(from, to),
  );


  const planoPorCodigo = new Map<string, PlanoRow>();
  for (const p of plano) planoPorCodigo.set(p.codigo, p);
  const planoPorClassif = new Map<string, PlanoRow>();
  for (const p of plano) {
    const prev = planoPorClassif.get(p.classificacao);
    if (!prev || (p.nivel ?? 99) < (prev.nivel ?? 99)) {
      planoPorClassif.set(p.classificacao, p);
    }
  }

  // Conjuntos de raízes (nivel-2 ou prefixo mapeado direto) para a árvore.
  const raizesReceita = new Set<string>();
  const raizesDespesa = new Set<string>();
  const usandoMapeamento = prefixosMapeados.length > 0;

  if (usandoMapeamento) {
    for (const p of prefixosMapeados) {
      (p.lado === "receita" ? raizesReceita : raizesDespesa).add(p.prefixo);
    }
  } else {
    for (const r of DEFAULT_RECEITA_PREFIX) raizesReceita.add(r);
    for (const r of DEFAULT_DESPESA_PREFIX) raizesDespesa.add(r);
  }

  const acumReceita = new Map<string, number>();
  const acumDespesa = new Map<string, number>();

  for (const s of saldos) {
    const p = planoPorCodigo.get(s.conta_codigo);
    if (!p) continue;
    const cls = p.classificacao;
    if (!cls) continue;

    let lado: Lado | null = null;
    let inverter = false;

    if (usandoMapeamento) {
      const m = matchPrefixoMaisLongo(cls, prefixosMapeados);
      if (!m) continue;
      lado = m.lado;
      inverter = m.inverter;
    } else {
      const isRec = DEFAULT_RECEITA_PREFIX.some((pr) => cls === pr || cls.startsWith(pr + "."));
      const isDes = DEFAULT_DESPESA_PREFIX.some((pr) => cls === pr || cls.startsWith(pr + "."));
      if (isRec) {
        lado = "receita";
        inverter = true;
      } else if (isDes) {
        lado = "despesa";
        inverter = false;
      } else continue;
    }

    // Valor mensal "limpo": usa SOMENTE o lado natural da conta. A
    // contrapartida da apuração (encerramento de dez) bate no lado oposto
    // (debita receita, credita despesa) e seria contabilizada como
    // movimento real se subtraíssemos os dois lados — em dezembro isso
    // zera o mês inteiro. Receita = créditos do mês; despesa = débitos.
    const d = Number(s.total_debitos) || 0;
    const c = Number(s.total_creditos) || 0;
    const valor = lado === "receita" ? c : d;
    const target = lado === "receita" ? acumReceita : acumDespesa;
    for (const pref of prefixosDe(cls)) {
      target.set(pref, (target.get(pref) ?? 0) + valor);
    }
  }

  const raiz_receita = construirArvore(acumReceita, planoPorClassif, raizesReceita, "Receita");
  const raiz_despesa = construirArvore(acumDespesa, planoPorClassif, raizesDespesa, "Despesa");

  const receita_total = raiz_receita.valor;
  const despesa_total = raiz_despesa.valor;

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
  raizes: Set<string>,
  rootLabel: string,
): NoArvore {
  const raiz: NoArvore = { classificacao: "", descricao: rootLabel, nivel: 0, valor: 0, filhos: [] };
  const chaves = Array.from(acum.keys()).sort();
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

  // Helper: dada uma classificação, devolve a raiz mapeada mais profunda
  // que é prefixo dela (ou a própria, se for raiz).
  const raizesOrdenadas = Array.from(raizes).sort((a, b) => b.length - a.length);
  const raizDe = (cls: string): string | null => {
    for (const r of raizesOrdenadas) {
      if (cls === r || cls.startsWith(r + ".")) return r;
    }
    return null;
  };

  for (const cls of chaves) {
    if (raizes.has(cls)) {
      raiz.filhos.push(nos.get(cls)!);
      raiz.valor += nos.get(cls)!.valor;
      continue;
    }
    // pai direto
    const partes = cls.split(".");
    const paiCls = partes.slice(0, -1).join(".");
    const paiNo = nos.get(paiCls);
    if (paiNo) {
      paiNo.filhos.push(nos.get(cls)!);
      continue;
    }
    // sem pai direto na árvore: pendura na raiz mapeada correspondente
    const r = raizDe(cls);
    if (r && nos.has(r)) {
      nos.get(r)!.filhos.push(nos.get(cls)!);
    }
  }
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
  const total = arv.despesa_total;
  // Tenta pegar netos (mais granular); cai para filhos diretos se vazio.
  const netos = arv.raiz_despesa.filhos.flatMap((g) => g.filhos);
  const candidatos = netos.length > 0 ? netos : arv.raiz_despesa.filhos;
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
  const centros = arv.raiz_despesa.filhos.flatMap((g) => g.filhos);
  const pool = centros.length > 0 ? centros : arv.raiz_despesa.filhos;
  return pool
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
    .replace(/^\(\+\)\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

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
