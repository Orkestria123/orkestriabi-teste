DROP POLICY IF EXISTS "saldos_mensais tenant access" ON public.saldos_mensais;
DROP POLICY IF EXISTS "saldos_mensais_select" ON public.saldos_mensais;
DROP POLICY IF EXISTS "saldos_mensais_write" ON public.saldos_mensais;
CREATE POLICY "saldos_mensais_select" ON public.saldos_mensais
FOR SELECT TO authenticated
USING (public.is_orkestria_admin() OR (tenant_id = public.get_my_tenant_id() AND (public.pode_gerenciar_tenant(tenant_id) OR company_id = public.get_my_company_id())));
CREATE POLICY "saldos_mensais_write" ON public.saldos_mensais
FOR ALL TO authenticated
USING (public.is_orkestria_admin() OR public.pode_gerenciar_tenant(tenant_id))
WITH CHECK (public.is_orkestria_admin() OR public.pode_gerenciar_tenant(tenant_id));