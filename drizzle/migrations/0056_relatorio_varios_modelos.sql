ALTER TABLE public.relatorio_modelos DROP CONSTRAINT IF EXISTS relatorio_modelos_tenant_id_key;
ALTER TABLE public.relatorio_modelos ADD COLUMN IF NOT EXISTS nome text NOT NULL DEFAULT 'Modelo padrão';
ALTER TABLE public.relatorio_modelos ADD COLUMN IF NOT EXISTS is_padrao boolean NOT NULL DEFAULT false;
UPDATE public.relatorio_modelos SET is_padrao = true;
CREATE UNIQUE INDEX IF NOT EXISTS relatorio_modelos_um_padrao ON public.relatorio_modelos(tenant_id) WHERE is_padrao;
ALTER TABLE public.relatorios_executivos ADD COLUMN IF NOT EXISTS modelo_id uuid REFERENCES public.relatorio_modelos(id) ON DELETE SET NULL;