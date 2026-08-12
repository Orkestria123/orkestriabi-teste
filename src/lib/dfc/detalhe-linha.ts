// Drill-down de uma linha da DFC (Etapa 5).
// Dada a lista de classificações configuradas para a linha e a operação
// (soma / subtrai / variação), devolve as contas analíticas que a compõem
// com o valor de cada uma por coluna do recorte.

import { supabase } from "@/integrations/supabase/client";
import {
  descendeDe,
  dividir,
  getMascaraConfig,
  MASCARA_DEFAULT,
  type MascaraConfig,
} from "@/lib/mascara/interpretar";
import type { DfcOperacao } from "@/lib/dfc/estrutura";
import { buildColunasDfc, type Agrupador } from "@/lib/dfc/calcular-indireto";

export interface DfcContaDetalhe {
  codigo: string;
  classificacao: string;
  descricao: string;
  valores: Record<string, number>;
  total: number;
}

interface PlanoRow {
  codigo: string;
  classificacao: string;
  descricao: string | null;
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
      .select("codigo, classificacao, descricao")
      .eq("company_id", companyId)
      .in("codigo", uniq.slice(i, i + CHUNK));
    if (error) throw error;
    out.push(...((data ?? []) as PlanoRow[]));
  }
  return out;
}

function isApuracao(classificacao: string, mascara: MascaraConfig): boolean {
  return dividir(classificacao, mascara)
    .slice(1)
    .some((p) => p === "98" || p === "99");
}

function fimDoMesAnterior(p: string): string {
  const d = new Date(p + "T00:00:00Z");
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export async function detalharLinhaDfc(params: {
  companyId: string;
  periodos: string[];
  agrupador: Agrupador;
  contas: string[];
  operacao: DfcOperacao;
}): Promise<DfcContaDetalhe[]> {
  const { companyId, periodos, agrupador, contas, operacao } = params;
  const colunas = buildColunasDfc(periodos, agrupador);
  if (colunas.length === 0 || contas.length === 0) return [];

  const { data: comp } = await supabase
    .from("companies")
    .select("id, tenant_id")
    .eq("id", companyId)
    .maybeSingle();
  if (!comp) return [];
  const mascara =
    (await getMascaraConfig({ tenantId: (comp as any).tenant_id, companyId })) ?? MASCARA_DEFAULT;

  const fimRecorte = colunas[colunas.length - 1].fim;
  const [saldos, aberturas] = await Promise.all([
    paginate<any>((from, to) =>
      supabase
        .from("saldos_mensais")
        .select("conta_codigo, competencia, total_debitos, total_creditos")
        .eq("company_id", companyId)
        .lte("competencia", fimRecorte)
        .order("competencia")
        .order("conta_codigo")
        .range(from, to),
    ),
    operacao === "variacao"
      ? paginate<any>((from, to) =>
          supabase
            .from("saldos_abertura")
            .select("conta_codigo, data_referencia, saldo")
            .eq("company_id", companyId)
            .order("data_referencia", { ascending: false })
            .range(from, to),
        )
      : Promise.resolve([] as any[]),
  ]);

  const codigos = new Set<string>();
  saldos.forEach((s: any) => codigos.add(s.conta_codigo));
  aberturas.forEach((a: any) => codigos.add(a.conta_codigo));
  const plano = await fetchPlanoPorCodigos(companyId, Array.from(codigos));

  const relevantes = plano.filter(
    (p) =>
      !isApuracao(p.classificacao, mascara) &&
      contas.some((c) => descendeDe(p.classificacao, c, mascara)),
  );
  if (relevantes.length === 0) return [];
  const alvo = new Map(relevantes.map((p) => [p.codigo, p]));

  const aberturaPorCodigo = new Map<string, number>();
  for (const a of aberturas as any[]) {
    if (!alvo.has(a.conta_codigo)) continue;
    if (!aberturaPorCodigo.has(a.conta_codigo)) {
      aberturaPorCodigo.set(a.conta_codigo, Number(a.saldo) || 0);
    }
  }

  const movPorConta = new Map<string, Map<string, number>>();
  for (const s of saldos as any[]) {
    if (!alvo.has(s.conta_codigo)) continue;
    const m = movPorConta.get(s.conta_codigo) ?? new Map<string, number>();
    m.set(
      s.competencia,
      (m.get(s.competencia) ?? 0) + (Number(s.total_debitos) || 0) - (Number(s.total_creditos) || 0),
    );
    movPorConta.set(s.conta_codigo, m);
  }

  const saldoAte = (codigo: string, ate: string) => {
    let total = aberturaPorCodigo.get(codigo) ?? 0;
    const m = movPorConta.get(codigo);
    if (m) for (const [comp, v] of m) if (comp <= ate) total += v;
    return total;
  };

  const out: DfcContaDetalhe[] = [];
  for (const p of relevantes) {
    const valores: Record<string, number> = {};
    let total = 0;
    for (const col of colunas) {
      let v = 0;
      if (operacao === "variacao") {
        v = -(saldoAte(p.codigo, col.fim) - saldoAte(p.codigo, fimDoMesAnterior(col.inicio)));
      } else {
        const m = movPorConta.get(p.codigo);
        let mov = 0;
        if (m) for (const mes of col.meses) mov += m.get(mes) ?? 0;
        v = operacao === "subtrai" ? -mov : mov;
      }
      valores[col.key] = v;
      total += v;
    }
    if (Math.abs(total) < 0.005 && Object.values(valores).every((v) => Math.abs(v) < 0.005)) continue;
    out.push({
      codigo: p.codigo,
      classificacao: p.classificacao,
      descricao: p.descricao ?? "",
      valores,
      total,
    });
  }

  out.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  return out.slice(0, 200);
}
