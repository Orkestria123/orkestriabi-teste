ALTER TABLE public.mapeamento_demonstracao 
  ADD COLUMN IF NOT EXISTS tipo_custo text 
  CHECK (tipo_custo IN ('fixo','variavel'));

COMMENT ON COLUMN public.mapeamento_demonstracao.tipo_custo IS 'Classificação Fixo/Variável para análise de Ponto de Equilíbrio (apenas linhas de despesa).';