// Cálculo do realizado por item de orçamento, dentro de um intervalo de
// competências. Usado tanto para "puxar do histórico" (Etapa 3 — pré-preencher
// os valores orçados) quanto para "sazonalidade" (padrão mês-a-mês do
// histórico). NÃO substitui o motor das demonstrações — é um cálculo enxuto
// que soma o movimento das contas pertencentes a cada item, mês a mês.

import { supabase } from "@/integrations/supabase/client";
import {
  descendeDe,
  getMascaraConfig,
  MASCARA_DEFAULT,
  type MascaraConfig,
} from "@/lib/mascara/interpretar";
import { getAjustesGerenciais } from "@/lib/gerencial/ajustes";

export type Visao = "contabil" | "gerencial";

interface PlanoRow {
  codigo: string;
  classificacao: string;
  descricao?: string | null;
}

/**
 * Busca em `plano_contas` apenas as linhas cujos códigos aparecem em `codigos`.
 * Necessário porque o PostgREST cabe em 1000 linhas por resposta e algumas
 * empresas têm dezenas de milhares de contas — carregar o plano inteiro
 * perde as contas que precisamos (bug do "realizado sempre zero" na tela
 * de análise de variação do orçamento).
 */
async function fetchPlanoPorCodigos(
  companyId: string,
  codigos: string[],
): Promise<PlanoRow[]> {
  const uniq = Array.from(new Set(codigos.filter(Boolean)));
  if (uniq.length === 0) return [];
  const out: PlanoRow[] = [];
  const CHUNK = 500;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const slice = uniq.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("plano_contas")
      .select("codigo, classificacao, descricao")
      .eq("company_id", companyId)
      .in("codigo", slice);
    if (error) throw error;
    out.push(...((data ?? []) as PlanoRow[]));
  }
  return out;
}


interface SaldoRow {
  conta_codigo: string;
  competencia: string; // YYYY-MM-DD
  total_debitos: number;
  total_creditos: number;
}

export interface RealizadoItem {
  /** map competencia YYYY-MM → valor absoluto do movimento */
  porMes: Record<string, number>;
  /** soma de todos os meses */
  total: number;
}

export interface RealizadoResult {
  /** map item_id → RealizadoItem */
  porItem: Record<string, RealizadoItem>;
  /** meses cobertos (YYYY-MM, ordenados) */
  meses: string[];
  mascara: MascaraConfig;
}

interface ItemInput {
  id: string;
  /** lista de códigos OU classificações do plano */
  contas: string[];
  /** natureza contábil do item (para aplicar sinal) — se omitido, usa D-C */
  tipo_conta?: string | null;
}

/**
 * Devolve o sinal a aplicar sobre (debitos - creditos) para deixar o valor
 * "positivo do ponto de vista do item". Ex.: item de despesa/custo é
 * positivo quando débito > crédito (D-C, sinal +1); item de receita é
 * positivo quando crédito > débito (C-D, sinal -1 sobre D-C).
 */
function sinalPorTipo(tipo?: string | null): 1 | -1 {
  const t = (tipo ?? "").toLowerCase();
  if (t === "receita" || t === "resultado") return -1;
  // despesa, custo, ativo, passivo, pl → mantém D-C
  return 1;
}


/**
 * Resolve as classificações-alvo de um item.
 * Um valor em `item.contas` pode ser:
 *  - um `codigo` do plano — resolve para a `classificacao` daquela conta;
 *  - uma `classificacao` (com pontos) — usada diretamente.
 */
function resolverClassificacoes(
  contas: string[],
  porCodigo: Map<string, string>,
  porClassificacao: Set<string>,
): string[] {
  const out: string[] = [];
  for (const c of contas) {
    if (!c) continue;
    if (porCodigo.has(c)) out.push(porCodigo.get(c)!);
    else if (porClassificacao.has(c)) out.push(c);
    else out.push(c); // último recurso — tenta como prefixo mesmo assim
  }
  return Array.from(new Set(out));
}

function mesesEntre(inicio: string, fim: string): string[] {
  // inicio/fim = YYYY-MM
  const out: string[] = [];
  const [y1, m1] = inicio.split("-").map(Number);
  const [y2, m2] = fim.split("-").map(Number);
  let y = y1;
  let m = m1;
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * @param inicio "YYYY-MM"
 * @param fim    "YYYY-MM"
 */
export async function computeRealizadoPorItem(params: {
  tenantId: string;
  companyId: string;
  visao: Visao;
  inicio: string;
  fim: string;
  itens: ItemInput[];
}): Promise<RealizadoResult> {
  const { tenantId, companyId, visao, inicio, fim, itens } = params;

  const meses = mesesEntre(inicio, fim);
  const inicioD = `${inicio}-01`;
  // último dia via primeiro dia do mês seguinte -1 é overkill — usamos "≤ inicio do mes seguinte"
  const [yF, mF] = fim.split("-").map(Number);
  const proxMesY = mF === 12 ? yF + 1 : yF;
  const proxMesM = mF === 12 ? 1 : mF + 1;
  const fimExclusivoD = `${proxMesY}-${String(proxMesM).padStart(2, "0")}-01`;

  const mascara = await getMascaraConfig({ tenantId, companyId }).catch(
    () => MASCARA_DEFAULT,
  );

  // Saldos do período (primeiro, para descobrir quais contas precisamos do plano)
  const { data: saldosRaw, error: es } = await supabase
    .from("saldos_mensais")
    .select("conta_codigo, competencia, total_debitos, total_creditos")
    .eq("company_id", companyId)
    .gte("competencia", inicioD)
    .lt("competencia", fimExclusivoD)
    .range(0, 199999);
  if (es) throw es;
  const saldos = (saldosRaw ?? []) as SaldoRow[];

  // Plano apenas para os códigos com movimento (evita cap de 1000 do PostgREST)
  const codigosSaldos = saldos.map((s) => s.conta_codigo);
  const plano = await fetchPlanoPorCodigos(companyId, codigosSaldos);
  const porCodigo = new Map(plano.map((p) => [p.codigo, p.classificacao]));
  const porClassificacao = new Set(plano.map((p) => p.classificacao));
  const codigoToClass = new Map<string, string>(
    plano.map((p) => [p.codigo, p.classificacao]),
  );


  // Ajustes gerenciais (se visão gerencial) — somados ao movimento contábil
  let ajustesRows: SaldoRow[] = [];
  if (visao === "gerencial") {
    const ajData = await getAjustesGerenciais(tenantId, companyId);
    const naJanela = ajData.ajustes.filter(
      (a) => a.competencia >= inicioD && a.competencia < fimExclusivoD,
    );
    // Cada ajuste gera dois movimentos (débito e crédito no valor)
    for (const a of naJanela) {
      ajustesRows.push({
        conta_codigo: a.conta_debito,
        competencia: a.competencia,
        total_debitos: a.valor,
        total_creditos: 0,
      });
      ajustesRows.push({
        conta_codigo: a.conta_credito,
        competencia: a.competencia,
        total_debitos: 0,
        total_creditos: a.valor,
      });
    }
    // Contas gerenciais virtuais têm classificação própria — inclui no map
    for (const cg of ajData.contasGerenciais) {
      if (!codigoToClass.has(cg.codigo)) {
        codigoToClass.set(cg.codigo, cg.classificacao);
        porCodigo.set(cg.codigo, cg.classificacao);
      }
    }
  }
  const todosSaldos = [...saldos, ...ajustesRows];

  const porItem: Record<string, RealizadoItem> = {};

  for (const item of itens) {
    const alvos = resolverClassificacoes(item.contas, porCodigo, porClassificacao);
    const porMes: Record<string, number> = {};
    for (const m of meses) porMes[m] = 0;

    if (alvos.length === 0) {
      porItem[item.id] = { porMes, total: 0 };
      continue;
    }

    for (const s of todosSaldos) {
      const cls = codigoToClass.get(s.conta_codigo);
      if (!cls) continue;
      const bate = alvos.some((a) => descendeDe(cls, a, mascara));
      if (!bate) continue;
      const mov = Number(s.total_debitos ?? 0) - Number(s.total_creditos ?? 0);
      const mes = s.competencia.slice(0, 7);
      porMes[mes] = (porMes[mes] ?? 0) + mov;
    }

    // Valor absoluto — orçado é sempre positivo (o sinal fica implícito
    // pelo tipo do item). Simplifica a UX de preenchimento.
    let total = 0;
    for (const m of Object.keys(porMes)) {
      porMes[m] = Math.abs(Math.round(porMes[m] * 100) / 100);
      total += porMes[m];
    }
    porItem[item.id] = { porMes, total };
  }

  return { porItem, meses, mascara };
}

// =====================================================================
// ETAPA 4 — Realizado por item para análise Orçado vs Realizado
// =====================================================================
// Diferenças em relação a `computeRealizadoPorItem`:
//  - respeita o SINAL do tipo do item (receita → C-D positivo; despesa → D-C
//    positivo), em vez de aplicar Math.abs. Isso deixa o realizado na mesma
//    base do orçado (ambos positivos por natureza).
//  - devolve também o ACUMULADO (YTD, jan → competência).
//  - marca cada mês como `semDados` quando NÃO há nenhum lançamento no
//    período para a empresa (mês futuro/sem movimento algum), distinto de
//    "movimento existe mas soma zero".

export interface RealizadoMes {
  competencia: string; // YYYY-MM
  valor: number; // já com sinal aplicado (positivo por convenção)
  semDados: boolean; // true quando a empresa não tem nenhum lançamento no mês
}

export interface RealizadoItemDetalhado {
  itemId: string;
  tipoConta: string | null;
  porMes: RealizadoMes[];
  /** valor acumulado (YTD) por competência, seguindo a ordem de `porMes` */
  ytd: RealizadoMes[];
}

/**
 * Calcula realizado por item para um intervalo de meses. Reutiliza o mesmo
 * motor do resto do módulo (saldos_mensais + descendeDe + ajustes gerenciais)
 * — a diferença é a aplicação de sinal por tipo e o cálculo do YTD.
 */
export async function computeRealizadoDetalhado(params: {
  tenantId: string;
  companyId: string;
  visao: Visao;
  /** YYYY-MM (inclusive) */
  inicio: string;
  /** YYYY-MM (inclusive) */
  fim: string;
  itens: ItemInput[];
}): Promise<{ porItem: Record<string, RealizadoItemDetalhado>; meses: string[] }> {
  const { tenantId, companyId, visao, inicio, fim, itens } = params;
  const meses = mesesEntre(inicio, fim);
  const inicioD = `${inicio}-01`;
  const [yF, mF] = fim.split("-").map(Number);
  const proxMesY = mF === 12 ? yF + 1 : yF;
  const proxMesM = mF === 12 ? 1 : mF + 1;
  const fimExclusivoD = `${proxMesY}-${String(proxMesM).padStart(2, "0")}-01`;

  const mascara = await getMascaraConfig({ tenantId, companyId }).catch(
    () => MASCARA_DEFAULT,
  );

  const { data: saldosRaw, error: es } = await supabase
    .from("saldos_mensais")
    .select("conta_codigo, competencia, total_debitos, total_creditos")
    .eq("company_id", companyId)
    .gte("competencia", inicioD)
    .lt("competencia", fimExclusivoD)
    .range(0, 199999);
  if (es) throw es;
  const saldos = (saldosRaw ?? []) as SaldoRow[];

  // Plano apenas para os códigos com movimento (evita cap de 1000 do PostgREST)
  const codigosSaldos = saldos.map((s) => s.conta_codigo);
  const plano = await fetchPlanoPorCodigos(companyId, codigosSaldos);
  const porCodigo = new Map(plano.map((p) => [p.codigo, p.classificacao]));
  const porClassificacao = new Set(plano.map((p) => p.classificacao));
  const codigoToClass = new Map<string, string>(
    plano.map((p) => [p.codigo, p.classificacao]),
  );


  // "Sem dados": nenhum lançamento contábil naquela competência para a empresa.
  const mesesComMovimento = new Set(saldos.map((s) => s.competencia.slice(0, 7)));

  let ajustesRows: SaldoRow[] = [];
  if (visao === "gerencial") {
    const ajData = await getAjustesGerenciais(tenantId, companyId);
    const naJanela = ajData.ajustes.filter(
      (a) => a.competencia >= inicioD && a.competencia < fimExclusivoD,
    );
    for (const a of naJanela) {
      ajustesRows.push({
        conta_codigo: a.conta_debito,
        competencia: a.competencia,
        total_debitos: a.valor,
        total_creditos: 0,
      });
      ajustesRows.push({
        conta_codigo: a.conta_credito,
        competencia: a.competencia,
        total_debitos: 0,
        total_creditos: a.valor,
      });
      mesesComMovimento.add(a.competencia.slice(0, 7));
    }
    for (const cg of ajData.contasGerenciais) {
      if (!codigoToClass.has(cg.codigo)) {
        codigoToClass.set(cg.codigo, cg.classificacao);
        porCodigo.set(cg.codigo, cg.classificacao);
      }
    }
  }
  const todosSaldos = [...saldos, ...ajustesRows];

  const porItem: Record<string, RealizadoItemDetalhado> = {};

  for (const item of itens) {
    const alvos = resolverClassificacoes(item.contas, porCodigo, porClassificacao);
    const sinal = sinalPorTipo(item.tipo_conta);
    const bruto: Record<string, number> = {};
    for (const m of meses) bruto[m] = 0;

    if (alvos.length > 0) {
      for (const s of todosSaldos) {
        const cls = codigoToClass.get(s.conta_codigo);
        if (!cls) continue;
        if (!alvos.some((a) => descendeDe(cls, a, mascara))) continue;
        const mov = Number(s.total_debitos ?? 0) - Number(s.total_creditos ?? 0);
        const mes = s.competencia.slice(0, 7);
        bruto[mes] = (bruto[mes] ?? 0) + mov;
      }
    }

    const porMes: RealizadoMes[] = meses.map((m) => ({
      competencia: m,
      valor: Math.round(bruto[m] * sinal * 100) / 100,
      semDados: !mesesComMovimento.has(m),
    }));

    let acc = 0;
    const ytd: RealizadoMes[] = porMes.map((r) => {
      if (!r.semDados) acc = Math.round((acc + r.valor) * 100) / 100;
      return { competencia: r.competencia, valor: acc, semDados: r.semDados };
    });

    porItem[item.id] = {
      itemId: item.id,
      tipoConta: item.tipo_conta ?? null,
      porMes,
      ytd,
    };
  }

  return { porItem, meses };
}

/**
 * Atalho: realizado de um único item para uma única competência (YYYY-MM).
 * Retorna { valor, semDados, ytd } — ytd = acumulado do ano corrente até
 * essa competência.
 */
export async function computeRealizadoItem(params: {
  tenantId: string;
  companyId: string;
  visao: Visao;
  competencia: string; // YYYY-MM
  item: ItemInput;
}): Promise<{ valor: number; semDados: boolean; ytd: number }> {
  const ano = params.competencia.slice(0, 4);
  const res = await computeRealizadoDetalhado({
    tenantId: params.tenantId,
    companyId: params.companyId,
    visao: params.visao,
    inicio: `${ano}-01`,
    fim: params.competencia,
    itens: [params.item],
  });
  const d = res.porItem[params.item.id];
  const mes = d.porMes[d.porMes.length - 1];
  const ytd = d.ytd[d.ytd.length - 1];
  return { valor: mes.valor, semDados: mes.semDados, ytd: ytd.valor };
}
