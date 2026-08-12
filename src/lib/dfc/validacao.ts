// Etapa 4 da DFC — VALIDAÇÃO DE FECHAMENTO.
//
// Roda os dois métodos (o motor direto já devolve o indireto embutido) e
// verifica as três igualdades que uma DFC correta precisa satisfazer:
//   1. Caixa Final calculado = Disponível do Balanço no fim do recorte;
//   2. Caixa Operacional pelo DIRETO = pelo INDIRETO;
//   3. Variação Líquida de Caixa = Operacional + Investimento + Financiamento
//      = (Caixa Final − Caixa Inicial).
//
// Também mede a COBERTURA da configuração: contas patrimoniais (ativo,
// passivo e PL) com movimento no período que não estão vinculadas a nenhuma
// linha da DFC nem às contas de caixa — candidatas naturais à divergência.

import { supabase } from "@/integrations/supabase/client";
import {
  descendeDe,
  dividir,
  getMascaraConfig,
  grupoDe,
  MASCARA_DEFAULT,
  type MascaraConfig,
} from "@/lib/mascara/interpretar";
import {
  calcularDfcDireto,
  type DfcResultadoDireto,
} from "@/lib/dfc/calcular-direto";
import type { Agrupador, VisaoDfc } from "@/lib/dfc/calcular-indireto";

export const TOL = 0.01;

export interface DfcCheck {
  key: "caixa" | "metodos" | "variacao";
  titulo: string;
  ok: boolean;
  esquerdaLabel: string;
  esquerda: number;
  direitaLabel: string;
  direita: number;
  diferenca: number;
  /** dica de diagnóstico quando não fecha */
  diagnostico?: string;
}

export interface ContaNaoMapeada {
  codigo: string;
  classificacao: string;
  descricao: string;
  grupo: string;
  movimento: number;
}

export interface DfcCobertura {
  totalContas: number;
  mapeadas: number;
  percentual: number;
  naoMapeadas: ContaNaoMapeada[];
  /** soma absoluta do movimento das contas não mapeadas */
  movimentoNaoMapeado: number;
}

export interface DfcValidacaoResultado {
  checks: DfcCheck[];
  tudoOk: boolean;
  cobertura: DfcCobertura;
  resultado: DfcResultadoDireto;
}

interface PlanoRow {
  codigo: string;
  classificacao: string;
  descricao: string | null;
  is_sintetica: boolean | null;
}

async function paginate<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; from < 500_000; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchPlanoPorCodigos(companyId: string, codigos: string[]): Promise<PlanoRow[]> {
  const uniq = Array.from(new Set(codigos.filter(Boolean)));
  const out: PlanoRow[] = [];
  const CHUNK = 400;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("plano_contas")
      .select("codigo, classificacao, descricao, is_sintetica")
      .eq("company_id", companyId)
      .in("codigo", uniq.slice(i, i + CHUNK));
    if (error) throw error;
    out.push(...((data ?? []) as PlanoRow[]));
  }
  return out;
}

function isApuracao(classificacao: string, m: MascaraConfig): boolean {
  return dividir(classificacao, m)
    .slice(1)
    .some((p) => p === "98" || p === "99");
}

const GRUPO_LABEL: Record<string, string> = {
  ativo: "Ativo",
  passivo: "Passivo",
  pl: "Patrimônio Líquido",
};

export async function validarDfc(params: {
  companyId: string;
  periodos: string[];
  agrupador: Agrupador;
  visao: VisaoDfc;
}): Promise<DfcValidacaoResultado> {
  const { companyId, periodos } = params;
  const resultado = await calcularDfcDireto(params);

  // ---------------------------------------------------------- as 3 checagens
  const t = resultado.totais;
  const opDireto = t["op_dir_total"] ?? 0;
  const opIndireto = resultado.opIndiretoTotal;
  const inv = t["inv_total"] ?? 0;
  const fin = t["fin_total"] ?? 0;
  const caixaInicial = resultado.validacaoTotal.caixaInicial;
  const caixaFinal = resultado.validacaoTotal.caixaFinalCalculado;
  const caixaBP = resultado.validacaoTotal.caixaFinalBP;

  const somaBlocos = opDireto + inv + fin;
  const variacaoPorSaldo = caixaFinal - caixaInicial;

  const checks: DfcCheck[] = [
    {
      key: "caixa",
      titulo: "Caixa final reconcilia com o Balanço",
      ok: Math.abs(caixaBP - caixaFinal) < TOL,
      esquerdaLabel: "Caixa Final DFC",
      esquerda: caixaFinal,
      direitaLabel: "Disponível BP",
      direita: caixaBP,
      diferenca: caixaBP - caixaFinal,
      diagnostico:
        "Há contas patrimoniais com movimento no período que não estão vinculadas a nenhuma linha da DFC. Veja a cobertura da configuração abaixo.",
    },
    {
      key: "metodos",
      titulo: "Direto = Indireto (caixa operacional)",
      ok: Math.abs(opDireto - opIndireto) < TOL,
      esquerdaLabel: "Operacional Direto",
      esquerda: opDireto,
      direitaLabel: "Operacional Indireto",
      direita: opIndireto,
      diferenca: opDireto - opIndireto,
      diagnostico:
        "As contas vinculadas nos dois métodos não são equivalentes: alguma conta está no operacional de um método e ausente (ou em outro bloco) no outro. Revise as linhas de ambos os métodos na configuração da DFC.",
    },
    {
      key: "variacao",
      titulo: "Variação = soma dos blocos",
      ok: Math.abs(somaBlocos - variacaoPorSaldo) < TOL,
      esquerdaLabel: "Operacional + Investimento + Financiamento",
      esquerda: somaBlocos,
      direitaLabel: "Caixa Final − Caixa Inicial",
      direita: variacaoPorSaldo,
      diferenca: somaBlocos - variacaoPorSaldo,
      diagnostico:
        "Inconsistência interna no fechamento: revise se alguma linha calculada está sendo somada duas vezes.",
    },
  ];

  // ------------------------------------------------------------- cobertura
  const meses = Array.from(new Set(periodos)).sort();
  const mascara: MascaraConfig =
    (await getMascaraConfig({ companyId })) ?? MASCARA_DEFAULT;

  const [cfgRes, linhasRes] = await Promise.all([
    supabase.from("dfc_config" as any).select("conta_caixa").eq("company_id", companyId).maybeSingle(),
    supabase.from("dfc_linha_contas" as any).select("contas").eq("company_id", companyId),
  ]);
  const vinculadas: string[] = [
    ...((((cfgRes.data as any)?.conta_caixa as string[]) ?? []) || []),
    ...(((linhasRes.data as any[]) ?? []).flatMap((l) => (l.contas as string[]) ?? [])),
  ].filter(Boolean);

  const saldos = await paginate<{
    conta_codigo: string;
    total_debitos: number;
    total_creditos: number;
  }>((from, to) =>
    supabase
      .from("saldos_mensais")
      .select("conta_codigo, total_debitos, total_creditos")
      .eq("company_id", companyId)
      .gte("competencia", meses[0] ?? "1900-01-01")
      .lte("competencia", meses[meses.length - 1] ?? "2999-12-01")
      .order("conta_codigo")
      .range(from, to),
  );

  const movPorConta = new Map<string, number>();
  for (const s of saldos) {
    const v = (Number(s.total_debitos) || 0) - (Number(s.total_creditos) || 0);
    movPorConta.set(s.conta_codigo, (movPorConta.get(s.conta_codigo) ?? 0) + v);
  }

  const plano = await fetchPlanoPorCodigos(companyId, Array.from(movPorConta.keys()));

  const naoMapeadas: ContaNaoMapeada[] = [];
  let totalContas = 0;
  let mapeadas = 0;

  for (const p of plano) {
    const grupo = grupoDe(p.classificacao, mascara);
    if (grupo !== "ativo" && grupo !== "passivo" && grupo !== "pl") continue;
    if (isApuracao(p.classificacao, mascara)) continue;
    const mov = movPorConta.get(p.codigo) ?? 0;
    if (Math.abs(mov) < TOL) continue;
    totalContas += 1;
    const coberta = vinculadas.some((c) => descendeDe(p.classificacao, c, mascara));
    if (coberta) mapeadas += 1;
    else
      naoMapeadas.push({
        codigo: p.codigo,
        classificacao: p.classificacao,
        descricao: p.descricao ?? "",
        grupo: GRUPO_LABEL[grupo] ?? grupo,
        movimento: mov,
      });
  }

  naoMapeadas.sort((a, b) => Math.abs(b.movimento) - Math.abs(a.movimento));

  const cobertura: DfcCobertura = {
    totalContas,
    mapeadas,
    percentual: totalContas === 0 ? 100 : (mapeadas / totalContas) * 100,
    naoMapeadas,
    movimentoNaoMapeado: naoMapeadas.reduce((a, c) => a + Math.abs(c.movimento), 0),
  };

  return {
    checks,
    tudoOk: checks.every((c) => c.ok),
    cobertura,
    resultado,
  };
}
