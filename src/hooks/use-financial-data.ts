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
  const { userId, loading } = useAuth();
  // Derive year range from selected periodos; if empty, fetch a wide range so
  // the table never gets stuck "empty" while the filter context warms up.
  const years = periodos.map((p) => Number(p.slice(0, 4))).filter((n) => !isNaN(n));
  const minYear = years.length > 0 ? Math.min(...years) : 1900;
  const maxYear = years.length > 0 ? Math.max(...years) : 2999;
  return useQuery({
    queryKey: ["fs", userId, companyId, tipo, minYear, maxYear],
    enabled: !loading && !!userId && !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_statements")
        .select("*")
        .eq("company_id", companyId!)
        .eq("tipo_demonstracao", tipo)
        .gte("periodo", `${minYear}-01-01`)
        .lte("periodo", `${maxYear}-12-31`)
        .order("linha_ordem");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAvailablePeriods(companyId: string | null) {
  const { userId, loading } = useAuth();
  return useQuery({
    queryKey: ["available-periods", userId, companyId],
    enabled: !loading && !!userId && !!companyId,
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
