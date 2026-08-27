-- EBIT/EBITDA: formula igual indicador.
-- Dashboard: config global do escritorio (company_id nulo).

ALTER TABLE public.dre_linhas_config
  ADD COLUMN IF NOT EXISTS ebit_expressao jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ebitda_expressao jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.dre_linhas_config
   SET ebit_expressao = jsonb_build_array(
         jsonb_build_object(
           'tipo','termo','origem','conta',
           'contas', ebit_classificacoes,
           'sinais', (
             SELECT COALESCE(jsonb_agg('+'::text), '[]'::jsonb)
               FROM unnest(ebit_classificacoes)
           )
         )
       )
 WHERE cardinality(ebit_classificacoes) > 0
   AND (ebit_expressao = '[]'::jsonb OR ebit_expressao IS NULL);

UPDATE public.dre_linhas_config
   SET ebitda_expressao = jsonb_build_array(
         jsonb_build_object(
           'tipo','termo','origem','conta',
           'contas', ebitda_classificacoes,
           'sinais', (
             SELECT COALESCE(jsonb_agg('+'::text), '[]'::jsonb)
               FROM unnest(ebitda_classificacoes)
           )
         )
       )
 WHERE cardinality(ebitda_classificacoes) > 0
   AND (ebitda_expressao = '[]'::jsonb OR ebitda_expressao IS NULL);

ALTER TABLE public.dashboard_config
  ALTER COLUMN company_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_config_global_uq
  ON public.dashboard_config (tenant_id, bloco)
  WHERE company_id IS NULL;

INSERT INTO public.dashboard_config (tenant_id, company_id, bloco, visivel, ordem, config)
SELECT DISTINCT ON (tenant_id, bloco)
       tenant_id, NULL, bloco, visivel, ordem, config
  FROM public.dashboard_config
 WHERE company_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.dashboard_config g
      WHERE g.tenant_id = dashboard_config.tenant_id
        AND g.bloco = dashboard_config.bloco
        AND g.company_id IS NULL
   )
 ORDER BY tenant_id, bloco, updated_at DESC;
