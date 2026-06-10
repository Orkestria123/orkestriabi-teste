import { createServerFn } from "@tanstack/react-start";

/**
 * PÁGINA DE TESTE — retorna os dados financeiros da primeira empresa
 * sem exigir autenticação nem vínculo de usuário. Remover após validação.
 */
export const getTesteData = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: company, error: cErr } = await supabaseAdmin
    .from("companies")
    .select("id,name,razao_social,cnpj")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (cErr) throw cErr;
  if (!company) return { company: null, statements: [] as any[] };

  const { data: statements, error: sErr } = await supabaseAdmin
    .from("financial_statements")
    .select(
      "tipo_demonstracao,periodo,descricao,codigo_conta,nivel,is_subtotal,valor,linha_ordem",
    )
    .eq("company_id", company.id)
    .order("linha_ordem")
    .limit(5000);
  if (sErr) throw sErr;

  return { company, statements: statements ?? [] };
});
