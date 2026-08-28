CREATE INDEX IF NOT EXISTS idx_dfc_vinculo_tenant_empresa_classificacao
  ON public.dfc_vinculo (tenant_id, company_id, classificacao);
ANALYZE public.dfc_vinculo;