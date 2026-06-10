import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DrilldownAccount {
  codigo_conta: string;
  nome_conta: string | null;
  nivel: number | null;
  tipo_conta: string | null;
  natureza: string | null;
  values: Record<string, number>; // period -> saldo_final
  total: number;
}

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
    queryKey: ["drilldown", companyId, codigoConta, minYear, maxYear],
    enabled: enabled && !!companyId && !!codigoConta,
    queryFn: async (): Promise<DrilldownAccount[]> => {
      // Fetch all chart accounts whose codigo starts with the requested codigo (descendants + itself)
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
      // Filter out accounts with no movement, sort by absolute total desc
      return Array.from(map.values())
        .filter((a) => Object.keys(a.values).length > 0)
        .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    },
  });
}
