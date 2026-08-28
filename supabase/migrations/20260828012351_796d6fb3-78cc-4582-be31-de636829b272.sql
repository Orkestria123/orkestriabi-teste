DROP POLICY IF EXISTS "lancamentos tenant access" ON public.lancamentos_diario;
DROP POLICY IF EXISTS "lancamentos_diario_select" ON public.lancamentos_diario;
DROP POLICY IF EXISTS "lancamentos_diario_write" ON public.lancamentos_diario;
CREATE POLICY "lancamentos_diario_select" ON public.lancamentos_diario
FOR SELECT TO authenticated
USING (public.is_orkestria_admin() OR (tenant_id = public.get_my_tenant_id() AND (public.pode_gerenciar_tenant(tenant_id) OR company_id = public.get_my_company_id())));
CREATE POLICY "lancamentos_diario_write" ON public.lancamentos_diario
FOR ALL TO authenticated
USING (public.is_orkestria_admin() OR public.pode_gerenciar_tenant(tenant_id))
WITH CHECK (public.is_orkestria_admin() OR public.pode_gerenciar_tenant(tenant_id));