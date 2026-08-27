-- diario_uploads
DROP POLICY IF EXISTS "diario_uploads tenant access" ON public.diario_uploads;
CREATE POLICY "diario_uploads tenant read" ON public.diario_uploads FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());
CREATE POLICY "diario_uploads admin write" ON public.diario_uploads FOR ALL TO authenticated
  USING (public.pode_gerenciar_tenant(tenant_id))
  WITH CHECK (public.pode_gerenciar_tenant(tenant_id));

-- lancamentos_diario
DROP POLICY IF EXISTS "lancamentos tenant access" ON public.lancamentos_diario;
CREATE POLICY "lancamentos tenant read" ON public.lancamentos_diario FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());
CREATE POLICY "lancamentos admin write" ON public.lancamentos_diario FOR ALL TO authenticated
  USING (public.pode_gerenciar_tenant(tenant_id))
  WITH CHECK (public.pode_gerenciar_tenant(tenant_id));

-- plano_contas
DROP POLICY IF EXISTS "plano_contas tenant write" ON public.plano_contas;
CREATE POLICY "plano_contas admin write" ON public.plano_contas FOR ALL TO authenticated
  USING (public.pode_gerenciar_tenant(tenant_id))
  WITH CHECK (public.pode_gerenciar_tenant(tenant_id));

-- saldo_inicial_uploads
DROP POLICY IF EXISTS "tenant members write saldo_inicial_uploads" ON public.saldo_inicial_uploads;
CREATE POLICY "admins write saldo_inicial_uploads" ON public.saldo_inicial_uploads FOR ALL TO authenticated
  USING (public.pode_gerenciar_tenant(tenant_id))
  WITH CHECK (public.pode_gerenciar_tenant(tenant_id));

-- saldos_abertura
DROP POLICY IF EXISTS "saldos_abertura tenant access" ON public.saldos_abertura;
CREATE POLICY "saldos_abertura tenant read" ON public.saldos_abertura FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());
CREATE POLICY "saldos_abertura admin write" ON public.saldos_abertura FOR ALL TO authenticated
  USING (public.pode_gerenciar_tenant(tenant_id))
  WITH CHECK (public.pode_gerenciar_tenant(tenant_id));

-- saldos_mensais
DROP POLICY IF EXISTS "saldos_mensais tenant access" ON public.saldos_mensais;
CREATE POLICY "saldos_mensais tenant read" ON public.saldos_mensais FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());
CREATE POLICY "saldos_mensais admin write" ON public.saldos_mensais FOR ALL TO authenticated
  USING (public.pode_gerenciar_tenant(tenant_id))
  WITH CHECK (public.pode_gerenciar_tenant(tenant_id));