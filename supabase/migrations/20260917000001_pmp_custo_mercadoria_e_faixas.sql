-- PMP: denominador = EI + compras − deduções − EF (sem MOD/GGF).
-- Faixas globais recalibradas para escritório (indústria/comércio mistos).

INSERT INTO public.estrutura_padrao
  (classificacao, papel, demonstracao, tipo_linha, rotulo, ordem) VALUES
  ('3.02.01.01', 'ESTOQUE_INICIAL',  'DRE', 'detalhe', NULL, 41),
  ('3.02.01.02', 'COMPRAS',          'DRE', 'detalhe', NULL, 42),
  ('3.02.01.05', 'DEDUCOES_COMPRAS', 'DRE', 'detalhe', NULL, 43),
  ('3.02.01.06', 'ESTOQUE_FINAL',    'DRE', 'detalhe', NULL, 44),
  ('3.03.01.01', 'ESTOQUE_INICIAL',  'DRE', 'detalhe', NULL, 61),
  ('3.03.01.02', 'COMPRAS',          'DRE', 'detalhe', NULL, 62),
  ('3.03.01.04', 'DEDUCOES_COMPRAS', 'DRE', 'detalhe', NULL, 63),
  ('3.03.01.05', 'ESTOQUE_FINAL',    'DRE', 'detalhe', NULL, 64)
ON CONFLICT (classificacao, papel) DO UPDATE
  SET demonstracao = EXCLUDED.demonstracao,
      tipo_linha   = EXCLUDED.tipo_linha,
      ordem        = EXCLUDED.ordem;

UPDATE public.indicadores_empresa
   SET descricao = '(Fornecedores / Custo da mercadoria) × 30 — EI + compras − deduções − EF, sem mão de obra/GGF',
       formula = jsonb_build_object(
         'expressao', jsonb_build_array(
           public._par('('), public._termo('FORNECEDORES'), public._op('/'),
           public._par('('), public._num(0), public._op('-'), public._termo('CUSTO_MERCADORIA'), public._par(')'),
           public._par(')'), public._op('*'), public._num(30)
         )
       )
 WHERE company_id IS NULL
   AND nome LIKE 'Prazo M% de Pagamento';

-- Faixas: referência de escritório, editáveis por indicador.
-- LIKE evita falha de encoding no pipe Windows (acentos).
UPDATE public.indicadores_empresa SET faixas = '{"otimo":1.2,"bom":0.8,"atencao":0.5,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Giro do Ativo';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":45,"bom":30,"atencao":15,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome LIKE 'Prazo M% de Pagamento';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":30,"bom":45,"atencao":60,"direcao":"menor_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome LIKE 'Prazo M% de Recebimento';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":50,"bom":65,"atencao":80,"direcao":"menor_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Endividamento Geral';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":50,"bom":65,"atencao":80,"direcao":"menor_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome LIKE 'Composi% do Endividamento';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":80,"bom":120,"atencao":160,"direcao":"menor_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome LIKE 'Imobiliza% do PL';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":2,"bom":3.5,"atencao":5,"direcao":"menor_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome LIKE 'D%vida L%quida / EBITDA';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":1.3,"bom":1.0,"atencao":0.8,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Liquidez Corrente';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":1.0,"bom":0.7,"atencao":0.5,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Liquidez Seca';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":0.25,"bom":0.10,"atencao":0.05,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Liquidez Imediata';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":1.1,"bom":0.9,"atencao":0.7,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Liquidez Geral';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":25,"bom":15,"atencao":8,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Margem Bruta';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":10,"bom":5,"atencao":2,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome LIKE 'Margem L%quida';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":18,"bom":10,"atencao":4,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Margem Ebitda';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":12,"bom":6,"atencao":2,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Margem Operacional';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":8,"bom":4,"atencao":1.5,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'ROA';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":15,"bom":8,"atencao":4,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'ROE';
