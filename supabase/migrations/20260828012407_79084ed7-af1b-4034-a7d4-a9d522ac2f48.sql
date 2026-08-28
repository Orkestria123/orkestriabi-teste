DROP POLICY IF EXISTS "diario_uploads tenant access" ON public.diario_uploads;
DROP POLICY IF EXISTS "diario_uploads_select" ON public.diario_uploads;
DROP POLICY IF EXISTS "diario_uploads_write" ON public.diario_uploads;
CREATE POLICY "diario_uploads_select" ON public.diario_uploads
FOR SELECT TO authenticated
USING (public.is_orkestria_admin() OR (tenant_id = public.get_my_tenant_id() AND (public.pode_gerenciar_tenant(tenant_id) OR company_id = public.get_my_company_id())));
CREATE POLICY "diario_uploads_write" ON public.diario_uploads
FOR ALL TO authenticated
USING (public.is_orkestria_admin() OR public.pode_gerenciar_tenant(tenant_id))
WITH CHECK (public.is_orkestria_admin() OR public.pode_gerenciar_tenant(tenant_id));