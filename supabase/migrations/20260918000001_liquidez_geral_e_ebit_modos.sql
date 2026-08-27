-- Liquidez Geral: (AC + Realizavel LP) / (PC + PNC), sem imobilizado.
-- EBIT/EBITDA: modos explicitos na config da DRE.

ALTER TABLE public.dre_linhas_config
  ADD COLUMN IF NOT EXISTS ebit_modo text NOT NULL DEFAULT 'estrutura',
  ADD COLUMN IF NOT EXISTS ebitda_modo text NOT NULL DEFAULT 'estrutura';

ALTER TABLE public.dre_linhas_config DROP CONSTRAINT IF EXISTS dre_linhas_ebit_modo_chk;
ALTER TABLE public.dre_linhas_config
  ADD CONSTRAINT dre_linhas_ebit_modo_chk
  CHECK (ebit_modo IN ('estrutura', 'soma'));

ALTER TABLE public.dre_linhas_config DROP CONSTRAINT IF EXISTS dre_linhas_ebitda_modo_chk;
ALTER TABLE public.dre_linhas_config
  ADD CONSTRAINT dre_linhas_ebitda_modo_chk
  CHECK (ebitda_modo IN ('estrutura', 'ebit_mais', 'soma'));

UPDATE public.dre_linhas_config
   SET ebit_modo = 'soma'
 WHERE ebit_modo = 'estrutura'
   AND cardinality(ebit_classificacoes) > 0;

UPDATE public.dre_linhas_config
   SET ebitda_modo = CASE
         WHEN cardinality(ebitda_classificacoes) > 0 AND ebitda_sobre_ebit = false THEN 'soma'
         WHEN cardinality(ebitda_classificacoes) > 0 THEN 'ebit_mais'
         ELSE ebitda_modo
       END
 WHERE cardinality(ebitda_classificacoes) > 0;

INSERT INTO public.estrutura_padrao
  (classificacao, papel, demonstracao, tipo_linha, rotulo, ordem)
VALUES
  ('1.03.00', 'REALIZAVEL_LP', 'BP_ATIVO', 'tag', NULL, 55)
ON CONFLICT (classificacao, papel) DO UPDATE
  SET demonstracao = EXCLUDED.demonstracao,
      tipo_linha   = EXCLUDED.tipo_linha,
      ordem        = EXCLUDED.ordem;

UPDATE public.indicadores_empresa
   SET descricao = '(AC + Realizavel LP) / (PC + PNC)',
       formula = jsonb_build_object(
         'expressao', jsonb_build_array(
           public._par('('), public._termo('ATIVO_CIRCULANTE'), public._op('+'),
           public._termo('REALIZAVEL_LP'), public._par(')'),
           public._op('/'),
           public._par('('), public._termo('PASSIVO_CIRCULANTE'), public._op('+'),
           public._termo('PASSIVO_NAO_CIRCULANTE'), public._par(')')
         )
       )
 WHERE company_id IS NULL
   AND nome LIKE 'Liquidez Geral';
