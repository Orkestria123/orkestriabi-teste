DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['depara_contas','lancamentos_diario','saldos_mensais','plano_contas'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_leitura', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (
      (SELECT public.is_orkestria_admin()) OR (
        NOT ((SELECT public.get_my_tenant_id()) IS DISTINCT FROM tenant_id)
        AND (company_id IS NULL OR (SELECT public.sou_cliente()) OR (SELECT public.get_my_company_id()) IS NULL OR (SELECT public.get_my_company_id()) = company_id)
        AND (company_id IS NULL OR (SELECT public.sou_cliente()) = false OR EXISTS (
          SELECT 1 FROM public.usuario_empresas ue WHERE ue.user_id = auth.uid() AND ue.company_id = %I.company_id))
      ))$p$, t||'_leitura', t, t);
  END LOOP;
END $$;