CREATE INDEX IF NOT EXISTS idx_lancamentos_diario_tenant_conta
  ON public.lancamentos_diario (tenant_id, conta_codigo);
ANALYZE public.lancamentos_diario;