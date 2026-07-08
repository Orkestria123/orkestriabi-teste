import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { descendeDe, getMascaraConfig } from "@/lib/mascara/interpretar";
import { useVisaoGerencial } from "@/hooks/use-visao-gerencial";

export interface DrilldownAccount {
  codigo_conta: string;
  nome_conta: string | null;
  nivel: number | null;
  tipo_conta: string | null;
  natureza: string | null;
  values: Record<string, number>;
  total: number;
}

/**
 * @deprecated Substituído por `useLancamentosDrilldown`. Mantido apenas
 * para o `account-drilldown-sheet.tsx` legado. As demonstrações são
 * construídas a partir de `plano_contas` + `lancamentos_diario`,
 * não de `chart_of_accounts` + `account_balances`.
 */
export function useAccountDrilldown(
  companyId: string | null,
  codigoConta: string | null,
  periodos: string[],
  enabled: boolean,
) {
  const years = periodos.map((p) => Number(p.slice(0, 4))).filter((n) => !isNaN(n));
  const minYear = years.length > 0 ? Math.min(...years) : 1900;
  const maxYear = years.length > 0 ? Math.max(...years) : 2999;

  return useQuery({
    queryKey: ["drilldown-legacy", companyId, codigoConta, minYear, maxYear],
    enabled: enabled && !!companyId && !!codigoConta,
    queryFn: async (): Promise<DrilldownAccount[]> => {
      const { data: accounts, error: aErr } = await supabase
        .from("chart_of_accounts")
        .select("codigo_conta, nome_conta, nivel, tipo_conta, natureza")
        .eq("company_id", companyId!)
        .ilike("codigo_conta", `${codigoConta}%`)
        .order("codigo_conta");
      if (aErr) throw aErr;

      const codes = (accounts ?? []).map((a) => a.codigo_conta);
      if (codes.length === 0) return [];

      const { data: balances, error: bErr } = await supabase
        .from("account_balances")
        .select("codigo_conta, periodo, saldo_final")
        .eq("company_id", companyId!)
        .in("codigo_conta", codes)
        .gte("periodo", `${minYear}-01-01`)
        .lte("periodo", `${maxYear}-12-31`);
      if (bErr) throw bErr;

      const map = new Map<string, DrilldownAccount>();
      for (const a of accounts ?? []) {
        map.set(a.codigo_conta, {
          codigo_conta: a.codigo_conta,
          nome_conta: a.nome_conta,
          nivel: a.nivel,
          tipo_conta: a.tipo_conta,
          natureza: a.natureza,
          values: {},
          total: 0,
        });
      }
      for (const b of balances ?? []) {
        const acc = map.get(b.codigo_conta);
        if (!acc) continue;
        const v = Number(b.saldo_final) || 0;
        acc.values[b.periodo] = (acc.values[b.periodo] ?? 0) + v;
        acc.total += v;
      }
      return Array.from(map.values())
        .filter((a) => Object.keys(a.values).length > 0)
        .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    },
  });
}

// ---------------------------------------------------------------------------
// Novo drill-down: lançamentos do diário
// ---------------------------------------------------------------------------

export interface LancamentoRow {
  id: string;
  data: string; // yyyy-mm-dd
  historico: string | null;
  debito: number;
  credito: number;
  conta_codigo: string;
}

export interface SaldoInicialRow {
  conta_codigo: string;
  data_referencia: string;
  saldo: number;
}

export interface LancamentosDrilldownResult {
  entries: LancamentoRow[];
  saldoInicial: SaldoInicialRow[]; // por conta
  contasMap: Record<string, { codigo: string; descricao: string }>;
  contasEncontradas: number;
  minCompetencia: string;
  maxCompetencia: string;
}

function competenciaRange(periodos: string[]): { min: string; max: string } {
  // periodos: YYYY-MM ou YYYY-MM-01 (aceita ambos)
  const norm = periodos
    .map((p) => p.slice(0, 7)) // YYYY-MM
    .filter((p) => /^\d{4}-\d{2}$/.test(p))
    .sort();
  if (norm.length === 0) {
    return { min: "1900-01-01", max: "2999-12-01" };
  }
  return { min: `${norm[0]}-01`, max: `${norm[norm.length - 1]}-01` };
}

async function fetchTenantId(companyId: string): Promise<string | null> {
  const { data } = await supabase
    .from("companies")
    .select("tenant_id")
    .eq("id", companyId)
    .maybeSingle();
  return (data?.tenant_id as string | undefined) ?? null;
}

async function fetchInBatches<T>(
  codes: string[],
  runner: (batch: string[]) => Promise<T[]>,
): Promise<T[]> {
  const batchSize = 400;
  const out: T[] = [];
  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize);
    const rows = await runner(batch);
    out.push(...rows);
  }
  return out;
}

export function useLancamentosDrilldown(
  companyId: string | null,
  classificacao: string | null,
  periodos: string[],
  opts: { incluirSaldoInicial: boolean },
  enabled: boolean,
) {
  const { min, max } = competenciaRange(periodos);

  return useQuery({
    queryKey: [
      "drilldown-lanc",
      companyId,
      classificacao,
      min,
      max,
      opts.incluirSaldoInicial,
    ],
    enabled: enabled && !!companyId && !!classificacao,
    queryFn: async (): Promise<LancamentosDrilldownResult> => {
      const tenantId = await fetchTenantId(companyId!);
      const mascara = tenantId
        ? await getMascaraConfig({ tenantId, companyId })
        : undefined;

      // 1) Contas analíticas descendentes (inclui a própria)
      const { data: planoRows, error: pErr } = await supabase
        .from("plano_contas")
        .select("codigo, descricao, classificacao, is_sintetica")
        .eq("company_id", companyId!)
        .ilike("classificacao", `${classificacao}%`);
      if (pErr) throw pErr;

      const contas = (planoRows ?? []).filter(
        (r: any) =>
          !r.is_sintetica &&
          (r.classificacao === classificacao ||
            descendeDe(r.classificacao, classificacao!, mascara)),
      );

      const contasMap: Record<string, { codigo: string; descricao: string }> = {};
      for (const r of contas) {
        contasMap[r.codigo] = { codigo: r.codigo, descricao: r.descricao };
      }
      const codes = contas.map((r: any) => r.codigo);

      if (codes.length === 0) {
        return {
          entries: [],
          saldoInicial: [],
          contasMap,
          contasEncontradas: 0,
          minCompetencia: min,
          maxCompetencia: max,
        };
      }

      // 2) Lançamentos
      const entries = await fetchInBatches(codes, async (batch) => {
        const { data, error } = await supabase
          .from("lancamentos_diario")
          .select("id, data, historico, debito, credito, conta_codigo")
          .eq("company_id", companyId!)
          .in("conta_codigo", batch)
          .gte("competencia", min)
          .lte("competencia", max)
          .order("data", { ascending: true });
        if (error) throw error;
        return (data ?? []).map((r: any) => ({
          id: r.id,
          data: r.data,
          historico: r.historico,
          debito: Number(r.debito) || 0,
          credito: Number(r.credito) || 0,
          conta_codigo: r.conta_codigo,
        })) as LancamentoRow[];
      });

      entries.sort((a, b) => {
        if (a.data === b.data) return a.id.localeCompare(b.id);
        return a.data.localeCompare(b.data);
      });

      // 3) Saldo inicial (Balanço)
      let saldoInicial: SaldoInicialRow[] = [];
      if (opts.incluirSaldoInicial) {
        saldoInicial = await fetchInBatches(codes, async (batch) => {
          const { data, error } = await supabase
            .from("saldos_abertura")
            .select("conta_codigo, data_referencia, saldo")
            .eq("company_id", companyId!)
            .in("conta_codigo", batch)
            .lte("data_referencia", min);
          if (error) throw error;
          return (data ?? []).map((r: any) => ({
            conta_codigo: r.conta_codigo,
            data_referencia: r.data_referencia,
            saldo: Number(r.saldo) || 0,
          })) as SaldoInicialRow[];
        });
      }

      return {
        entries,
        saldoInicial,
        contasMap,
        contasEncontradas: codes.length,
        minCompetencia: min,
        maxCompetencia: max,
      };
    },
  });
}
