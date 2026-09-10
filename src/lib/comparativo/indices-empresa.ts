/**
 * Cálculo dos índices comparáveis entre empresas.
 *
 * Reutiliza o MESMO motor dos Índices Financeiros do dashboard
 * (snapshot → EngineContext → resolver de linhas → INDICES_DASHBOARD),
 * apenas rodando para várias empresas e devolvendo um período por vez.
 */
import { supabase } from "@/integrations/supabase/client";
import { getMascaraConfig } from "@/lib/mascara/interpretar";
import { getModoGlobal } from "@/lib/plano/escopo";
import { getEstruturaPadrao } from "@/lib/plano/estrutura";
import { buildStatementFromDiario } from "@/lib/diario/build-statements";
import { indexarDemoDre } from "@/lib/indicadores/linhas";
import {
  buildCtxForVisao,
  criarResolverLinha,
  fetchSnapshot,
} from "@/hooks/use-indicador-data";
import { INDICES_DASHBOARD, type BasesIndice } from "@/lib/dashboard/indices-financeiros";
import type { ResolverLinha } from "@/lib/indicadores/engine";

export type SentidoIndice = "high" | "low";

export interface DefComparavel {
  key: string;
  label: string;
  formato: "percent" | "ratio";
  melhor: SentidoIndice;
  grupo: "Margens" | "Liquidez" | "Endividamento" | "Rentabilidade" | "Crescimento";
}

/** Índices relativos — únicos que fazem sentido comparar entre empresas. */
export const INDICES_COMPARAVEIS: DefComparavel[] = [
  { key: "margBruta", label: "Margem Bruta", formato: "percent", melhor: "high", grupo: "Margens" },
  { key: "margEbitda", label: "Margem EBITDA", formato: "percent", melhor: "high", grupo: "Margens" },
  { key: "margLiq", label: "Margem Líquida", formato: "percent", melhor: "high", grupo: "Margens" },
  { key: "lc", label: "Liquidez Corrente", formato: "ratio", melhor: "high", grupo: "Liquidez" },
  { key: "ls", label: "Liquidez Seca", formato: "ratio", melhor: "high", grupo: "Liquidez" },
  { key: "li", label: "Liquidez Imediata", formato: "ratio", melhor: "high", grupo: "Liquidez" },
  { key: "endivPL", label: "Endividamento (Dív. Bruta / PL)", formato: "percent", melhor: "low", grupo: "Endividamento" },
  { key: "caixaDiv", label: "Caixa Líq. / Dívida Líq.", formato: "ratio", melhor: "high", grupo: "Endividamento" },
  { key: "cobCaixa", label: "Cobertura Caixa / Passivo Circ.", formato: "ratio", melhor: "high", grupo: "Endividamento" },
  { key: "roe", label: "ROE (Lucro / PL)", formato: "percent", melhor: "high", grupo: "Rentabilidade" },
  { key: "roa", label: "ROA (Lucro / Ativo Total)", formato: "percent", melhor: "high", grupo: "Rentabilidade" },
  { key: "giroAtivo", label: "Giro do Ativo", formato: "ratio", melhor: "high", grupo: "Rentabilidade" },
  { key: "crescReceita", label: "Crescimento da Receita", formato: "percent", melhor: "high", grupo: "Crescimento" },
  { key: "crescEbitda", label: "Crescimento do EBITDA", formato: "percent", melhor: "high", grupo: "Crescimento" },
  { key: "crescLucro", label: "Crescimento do Lucro Líquido", formato: "percent", melhor: "high", grupo: "Crescimento" },
];

export const ORDEM_GRUPOS: DefComparavel["grupo"][] = [
  "Margens",
  "Rentabilidade",
  "Liquidez",
  "Endividamento",
  "Crescimento",
];

export interface EmpresaComparada {
  id: string;
  nome: string;
  periodo: string | null;
  periodoAnterior: string | null;
  valores: Record<string, number | null>;
  erro?: string;
}

function n(v: number | null | undefined): number {
  return Number(v) || 0;
}

function basesDe(resolver: ResolverLinha, p: string): BasesIndice {
  return {
    ac: n(resolver("ATIVO_CIRCULANTE", p)),
    pc: n(resolver("PASSIVO_CIRCULANTE", p)),
    estoques: n(resolver("ESTOQUES", p)),
    disponivel: n(resolver("DISPONIVEL", p)),
    emprestimos: n(resolver("EMPRESTIMOS", p)),
    pl: n(resolver("PATRIMONIO_LIQUIDO", p)),
    lucroBruto: n(resolver("LUCRO_BRUTO", p)),
    ebitda: n(resolver("EBITDA", p)),
    lucroLiquido: n(resolver("LUCRO_LIQUIDO", p)),
    receitaLiquida: n(resolver("RECEITA_LIQUIDA", p)),
  };
}

function div(a: number, b: number): number | null {
  if (!isFinite(a) || !isFinite(b) || Math.abs(b) < 0.005) return null;
  const v = a / b;
  return isFinite(v) ? v : null;
}

function variacao(atual: number, anterior: number): number | null {
  if (!isFinite(atual) || !isFinite(anterior) || Math.abs(anterior) < 0.005) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

/**
 * Fila global: o cálculo de uma empresa puxa plano de contas + saldos
 * inteiros. Rodar várias empresas ao mesmo tempo estourava o tempo
 * limite do banco ("statement timeout"), então roda uma de cada vez.
 */
let fila: Promise<unknown> = Promise.resolve();
function naFila<T>(fn: () => Promise<T>): Promise<T> {
  const proxima = fila.then(fn, fn);
  fila = proxima.catch(() => {});
  return proxima;
}

function ehTimeout(e: any): boolean {
  const m = String(e?.message ?? e ?? "");
  return m.includes("statement timeout") || m.includes("57014");
}

async function comRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!ehTimeout(e)) throw e;
    await new Promise((r) => setTimeout(r, 1200));
    return fn();
  }
}

export async function periodosDaEmpresa(companyId: string): Promise<string[]> {
  const { data, error } = await (supabase as any).rpc("periodos_da_empresa", {
    _company_id: companyId,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => String(r.competencia)).sort();
}

/**
 * Calcula os índices comparáveis de uma empresa no período pedido
 * (ou no último período disponível quando `periodo` for nulo).
 */
export async function calcularIndicesEmpresa(opts: {
  companyId: string;
  tenantId: string;
  nome: string;
  periodo: string | null;
  visao: "contabil" | "gerencial";
}): Promise<EmpresaComparada> {
  const { companyId, tenantId, nome, visao } = opts;
  const vazio: EmpresaComparada = {
    id: companyId,
    nome,
    periodo: null,
    periodoAnterior: null,
    valores: {},
  };

  return naFila(async () => {
  try {
    const disponiveis = await comRetry(() => periodosDaEmpresa(companyId));
    if (disponiveis.length === 0) return { ...vazio, erro: "Sem dados" };

    const periodo = opts.periodo && disponiveis.includes(opts.periodo)
      ? opts.periodo
      : opts.periodo
        ? null
        : disponiveis[disponiveis.length - 1]!;
    if (!periodo) return { ...vazio, erro: "Sem dados no período" };

    const anterior = disponiveis[disponiveis.indexOf(periodo) - 1] ?? null;
    const periodos = anterior ? [anterior, periodo] : [periodo];

    const mascara = await getMascaraConfig({ tenantId, companyId });
    const snap = await comRetry(() => fetchSnapshot(companyId));
    const estrutura = await getEstruturaPadrao();
    const modo = await getModoGlobal(companyId);
    const ctx = await buildCtxForVisao(companyId, tenantId, snap, mascara, visao);

    let demo;
    try {
      const rows = await buildStatementFromDiario(
        companyId,
        tenantId,
        modo.modoGlobal,
        "DRE",
        periodos,
        visao,
      );
      demo = indexarDemoDre(rows, estrutura);
    } catch {
      demo = undefined;
    }

    const resolver = criarResolverLinha(ctx, demo, estrutura);
    const bases = basesDe(resolver, periodo);
    const basesPrev = anterior ? basesDe(resolver, anterior) : null;

    const valores: Record<string, number | null> = {};
    for (const def of INDICES_DASHBOARD) valores[def.key] = def.compute(bases);

    const ativoTotal = n(resolver("ATIVO_TOTAL", periodo));
    const roe = div(bases.lucroLiquido, bases.pl);
    const roa = div(bases.lucroLiquido, ativoTotal);
    valores.roe = roe == null ? null : roe * 100;
    valores.roa = roa == null ? null : roa * 100;
    valores.giroAtivo = div(bases.receitaLiquida, ativoTotal);

    valores.crescReceita = basesPrev ? variacao(bases.receitaLiquida, basesPrev.receitaLiquida) : null;
    valores.crescEbitda = basesPrev ? variacao(bases.ebitda, basesPrev.ebitda) : null;
    valores.crescLucro = basesPrev ? variacao(bases.lucroLiquido, basesPrev.lucroLiquido) : null;

    return { id: companyId, nome, periodo, periodoAnterior: anterior, valores };
  } catch (e: any) {
    const msg = ehTimeout(e)
      ? "Cálculo demorou demais — tente de novo ou compare menos empresas."
      : (e?.message ?? "Falha ao calcular");
    return { ...vazio, erro: msg };
  }
  });
}

export function formatarComparavel(v: number | null, formato: DefComparavel["formato"]): string {
  if (v == null || !isFinite(v)) return "—";
  if (formato === "percent") {
    return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
