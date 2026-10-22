ALTER TABLE public.indicadores_empresa ADD COLUMN linha_calculada_key text;
ALTER TABLE public.indicadores_empresa ADD COLUMN exibir_demonstracao boolean NOT NULL DEFAULT true;
ALTER TABLE public.indicadores_empresa ADD CONSTRAINT indicadores_linha_calculada_key_check CHECK (linha_calculada_key IS NULL OR linha_calculada_key IN ('CUSTO_PRODUTOS', 'CUSTO_MERCADORIA'));
CREATE UNIQUE INDEX indicadores_linha_global_key ON public.indicadores_empresa (tenant_id, linha_calculada_key) WHERE company_id IS NULL AND linha_calculada_key IS NOT NULL;
CREATE UNIQUE INDEX indicadores_linha_empresa_key ON public.indicadores_empresa (tenant_id, company_id, linha_calculada_key) WHERE company_id IS NOT NULL AND linha_calculada_key IS NOT NULL;
COMMENT ON COLUMN public.indicadores_empresa.linha_calculada_key IS 'Semantic DRE calculated line; company definition overrides tenant default without altering ledger totals.';
COMMENT ON COLUMN public.indicadores_empresa.exibir_demonstracao IS 'Presentation only: hidden calculated lines remain available to formulas.';