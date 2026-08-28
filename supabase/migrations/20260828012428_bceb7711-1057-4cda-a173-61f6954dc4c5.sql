DROP POLICY IF EXISTS "depara tenant write" ON public.depara_contas;
DROP POLICY IF EXISTS "depara_contas_write" ON public.depara_contas;
CREATE POLICY "depara_contas_write" ON public.depara_contas
FOR ALL TO authenticated
USING (public.is_orkestria_admin() OR public.pode_gerenciar_tenant(tenant_id))
WITH CHECK (public.is_orkestria_admin() OR public.pode_gerenciar_tenant(tenant_id));