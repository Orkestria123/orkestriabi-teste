// Fetch consolidado de plano_contas + saldos_mensais + saldos_abertura
// para alimentar o engine de indicadores por empresa.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMascaraConfig } from "@/lib/mascara/interpretar";
import {
  buildContext,
  type EngineContext,
  type PlanoRowEng,
  type SaldoRow,
} from "@/lib/indicadores/engine";

async function fetchAll<T>(
  q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const step = 1000;
  let from = 0;
  const out: T[] = [];
  for (;;) {
    const { data, error } = await q(from, from + step - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < step) break;
    from += step;
  }
  return out;
}

export function useIndicadorData(
  tenantId: string | undefined,
  companyId: string | undefined,
) {
  return useQuery({
    queryKey: ["indic-engine-data", tenantId, companyId],
    enabled: !!tenantId && !!companyId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<EngineContext> => {
      const mascara = await getMascaraConfig({ tenantId: tenantId!, companyId: companyId! });

      const plano = await fetchAll<any>((from, to) =>
        supabase
          .from("plano_contas")
          .select("codigo, classificacao, descricao, natureza, is_sintetica, is_participante")
          .eq("tenant_id", tenantId!)
          .or(`company_id.eq.${companyId},company_id.is.null`)
          .range(from, to),
      );

      const codigoToClass = new Map<string, string>();
      const planoEng: PlanoRowEng[] = plano.map((p: any) => {
        codigoToClass.set(p.codigo, p.classificacao);
        return {
          classificacao: p.classificacao,
          descricao: p.descricao,
          natureza: p.natureza,
          is_sintetica: p.is_sintetica,
          is_participante: p.is_participante,
        };
      });

      const saldosRaw = await fetchAll<any>((from, to) =>
        supabase
          .from("saldos_mensais")
          .select("conta_codigo, competencia, total_debitos, total_creditos")
          .eq("company_id", companyId!)
          .range(from, to),
      );
      // Mapear conta_codigo → classificacao (a engine indexa por classificacao)
      const saldos: SaldoRow[] = [];
      for (const s of saldosRaw) {
        const cls = codigoToClass.get(s.conta_codigo);
        if (!cls) continue;
        saldos.push({
          conta_codigo: cls,
          competencia: s.competencia,
          total_debitos: Number(s.total_debitos) || 0,
          total_creditos: Number(s.total_creditos) || 0,
        });
      }

      const abertRaw = await fetchAll<any>((from, to) =>
        supabase
          .from("saldos_abertura")
          .select("conta_codigo, data_referencia, saldo")
          .eq("company_id", companyId!)
          .order("data_referencia", { ascending: false })
          .range(from, to),
      );
      const aberturas = new Map<string, number>();
      const seen = new Set<string>();
      for (const r of abertRaw) {
        const cls = codigoToClass.get(r.conta_codigo);
        if (!cls || seen.has(cls)) continue;
        seen.add(cls);
        aberturas.set(cls, Number(r.saldo) || 0);
      }

      return buildContext({ plano: planoEng, saldos, aberturas, mascara });
    },
  });
}
