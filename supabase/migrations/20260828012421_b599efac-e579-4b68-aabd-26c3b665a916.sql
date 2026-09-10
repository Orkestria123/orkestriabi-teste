DROP POLICY IF EXISTS "plano_contas tenant write" ON public.plano_contas;
DROP POLICY IF EXISTS "plano_contas_write" ON public.plano_contas;
CREATE POLICY "plano_contas_write" ON public.plano_contas
FOR ALL TO authenticated
USING (public.is_orkestria_admin() OR public.pode_gerenciar_tenant(tenant_id))
WITH CHECK (public.is_orkestria_admin() OR public.pode_gerenciar_tenant(tenant_id));