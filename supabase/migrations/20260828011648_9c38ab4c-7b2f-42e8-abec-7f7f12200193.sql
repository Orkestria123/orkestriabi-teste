CREATE INDEX IF NOT EXISTS idx_plano_contas_tenant_empresa_codigo
  ON public.plano_contas (tenant_id, company_id, codigo);
ANALYZE public.plano_contas;