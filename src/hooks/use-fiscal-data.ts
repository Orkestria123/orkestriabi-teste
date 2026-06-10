import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useFiscalParticipants(companyId: string | null) {
  return useQuery({
    queryKey: ["fiscal-participants", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fiscal_participants")
        .select("id, cnpj_cpf, nome, uf, municipio, ie")
        .eq("company_id", companyId!);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface InvoiceRow {
  id: string;
  tipo: "E" | "S";
  modelo: string | null;
  serie: string | null;
  numero: string | null;
  chave_nfe: string | null;
  data_emissao: string | null;
  cancelada: boolean;
  valor_total: number | null;
  valor_produtos: number | null;
  valor_icms: number | null;
  valor_ipi: number | null;
  participant_id: string | null;
  participant_nome?: string | null;
  participant_cnpj?: string | null;
}

export function useFiscalInvoices(
  companyId: string | null,
  periodos: string[],
  opts: { tipo?: "E" | "S" | "ALL"; limit?: number } = {},
) {
  const years = periodos.map((p) => Number(p.slice(0, 4))).filter((n) => !isNaN(n));
  const minYear = years.length ? Math.min(...years) : 1900;
  const maxYear = years.length ? Math.max(...years) : 2999;
  const tipo = opts.tipo ?? "ALL";
  const limit = opts.limit ?? 5000;
  return useQuery({
    queryKey: ["fiscal-invoices", companyId, minYear, maxYear, tipo, limit],
    enabled: !!companyId,
    queryFn: async (): Promise<InvoiceRow[]> => {
      let q = supabase
        .from("fiscal_invoices")
        .select(
          "id, tipo, modelo, serie, numero, chave_nfe, data_emissao, cancelada, valor_total, valor_produtos, valor_icms, valor_ipi, participant_id, fiscal_participants(nome, cnpj_cpf)",
        )
        .eq("company_id", companyId!)
        .gte("data_emissao", `${minYear}-01-01`)
        .lte("data_emissao", `${maxYear}-12-31`)
        .order("data_emissao", { ascending: false })
        .limit(limit);
      if (tipo !== "ALL") q = q.eq("tipo", tipo);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        tipo: r.tipo,
        modelo: r.modelo,
        serie: r.serie,
        numero: r.numero,
        chave_nfe: r.chave_nfe,
        data_emissao: r.data_emissao,
        cancelada: r.cancelada,
        valor_total: r.valor_total,
        valor_produtos: r.valor_produtos,
        valor_icms: r.valor_icms,
        valor_ipi: r.valor_ipi,
        participant_id: r.participant_id,
        participant_nome: r.fiscal_participants?.nome ?? null,
        participant_cnpj: r.fiscal_participants?.cnpj_cpf ?? null,
      }));
    },
  });
}
