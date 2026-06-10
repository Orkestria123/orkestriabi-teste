import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export interface Company {
  id: string;
  name: string;
  cnpj: string | null;
  razao_social: string | null;
  regime_tributario: string | null;
  ativo: boolean;
}

export function useMyCompanies() {
  const { userId, loading } = useAuth();
  return useQuery({
    queryKey: ["my-companies", userId],
    enabled: !loading && !!userId,
    queryFn: async (): Promise<Company[]> => {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data as Company[]) ?? [];
    },
  });
}

export function useFinancialStatement(
  companyId: string | null,
  tipo: string,
  periodos: string[],
) {
  return useQuery({
    queryKey: ["fs", companyId, tipo, periodos],
    enabled: !!companyId && periodos.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_statements")
        .select("*")
        .eq("company_id", companyId!)
        .eq("tipo_demonstracao", tipo)
        .in("periodo", periodos)
        .order("linha_ordem");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAvailablePeriods(companyId: string | null) {
  return useQuery({
    queryKey: ["available-periods", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_statements")
        .select("periodo")
        .eq("company_id", companyId!);
      if (error) throw error;
      const set = new Set<string>();
      (data ?? []).forEach((r: any) => set.add(r.periodo));
      return Array.from(set).sort();
    },
  });
}
