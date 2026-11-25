import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calcularMonthlyStatement, useCarimboEmpresa } from "@/hooks/use-financial-data";
import { carimboToken } from "@/lib/cache-demonstracoes";
import { conferirTotaisBalanco, type ConsistenciaMes } from "@/lib/diario/consistencia-balanco";
import { ConsistenciaBalanco } from "./consistencia-balanco";

interface Props {
  tenantId: string;
  companyId: string;
}

/** Mesma fonte e mesmo motor da consulta; nunca lê só as primeiras mil contas. */
export async function conferirFechamento(tenantId: string, companyId: string): Promise<ConsistenciaMes[]> {
  const { data, error } = await supabase.rpc("periodos_da_empresa", { _company_id: companyId });
  if (error) throw error;
  const periodos = Array.from(new Set((data ?? []).map((r) => String(r.competencia)))).sort();
  if (periodos.length === 0) return [];
  const [ativo, passivo, ativoGerencial, passivoGerencial] = await Promise.all([
    calcularMonthlyStatement(companyId, "BP_ATIVO", periodos, "contabil"),
    calcularMonthlyStatement(companyId, "BP_PASSIVO", periodos, "contabil"),
    calcularMonthlyStatement(companyId, "BP_ATIVO", periodos, "gerencial"),
    calcularMonthlyStatement(companyId, "BP_PASSIVO", periodos, "gerencial"),
  ]);
  return [
    ...conferirTotaisBalanco(ativo, passivo, periodos, "contabil"),
    ...conferirTotaisBalanco(ativoGerencial, passivoGerencial, periodos, "gerencial"),
  ];
}

export function BalancoFechaBadge({ tenantId, companyId }: Props) {
  const { data: carimbo } = useCarimboEmpresa(companyId);
  const { data, isPending, isError } = useQuery({
    queryKey: ["balanco-fecha", companyId, tenantId, carimboToken(carimbo)],
    queryFn: () => conferirFechamento(tenantId, companyId),
    enabled: !!carimbo,
  });
  return <div className="mb-4"><ConsistenciaBalanco resultados={data ?? []} carregando={isPending} erro={isError} /></div>;
}