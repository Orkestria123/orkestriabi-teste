CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_lancamentos_historico_trgm
  ON public.lancamentos_diario USING gin (historico gin_trgm_ops)
  WHERE historico IS NOT NULL AND historico <> '';

CREATE OR REPLACE FUNCTION public.correcoes_encerramento(
  _company_id uuid,
  _periodos date[]
)
RETURNS TABLE (conta_codigo text, competencia date, debitos numeric, creditos numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT l.conta_codigo,
         l.competencia,
         SUM(COALESCE(l.debito, 0))::numeric,
         SUM(COALESCE(l.credito, 0))::numeric
  FROM public.lancamentos_diario l
  WHERE l.company_id = _company_id
    AND l.competencia = ANY (_periodos)
    AND l.historico IS NOT NULL
    AND l.historico <> ''
    AND (
      l.historico ILIKE '%Transferido Para Conta%Resultado%'
      OR l.historico ILIKE '%transfer%resultado%'
      OR l.historico ILIKE '%encerramento%resultado%'
      OR l.historico ILIKE '%apura%resultado%'
      OR l.historico ILIKE '%resultado do exercicio%'
      OR l.historico ILIKE '%resultado do exercício%'
    )
  GROUP BY l.conta_codigo, l.competencia
$$;

GRANT EXECUTE ON FUNCTION public.correcoes_encerramento(uuid, date[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.carimbo_dados_empresa(_company_id uuid)
RETURNS TABLE (linhas bigint, atualizado_em timestamptz)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COUNT(*)::bigint, MAX(s.updated_at)
  FROM public.saldos_mensais s
  WHERE s.company_id = _company_id
$$;

GRANT EXECUTE ON FUNCTION public.carimbo_dados_empresa(uuid) TO authenticated, service_role;