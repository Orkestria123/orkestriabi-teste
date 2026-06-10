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

  // Pagina em blocos de 1000 (limite do servidor) para trazer todas as linhas
  const statements: any[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 20000; from += PAGE) {
    const { data: page, error: sErr } = await supabaseAdmin
      .from("financial_statements")
      .select(
        "tipo_demonstracao,periodo,descricao,codigo_conta,nivel,is_subtotal,valor,linha_ordem",
      )
      .eq("company_id", company.id)
      .order("tipo_demonstracao")
      .order("periodo")
      .order("linha_ordem")
      .range(from, from + PAGE - 1);
    if (sErr) throw sErr;
    statements.push(...(page ?? []));
    if (!page || page.length < PAGE) break;
  }

  return { company, statements };
});
