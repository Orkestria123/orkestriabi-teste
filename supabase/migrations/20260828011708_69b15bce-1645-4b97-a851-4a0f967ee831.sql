CREATE INDEX IF NOT EXISTS idx_companies_tenant_plano_tipo
  ON public.companies (tenant_id, plano_tipo);