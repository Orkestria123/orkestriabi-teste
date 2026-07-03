
-- RPC que retorna snapshot compacto para engine de indicadores.
-- Filtra plano_contas para apenas contas ESTRUTURAIS + as participantes
-- que possuem movimento (saldos_mensais), evitando trazer 134k participantes.
CREATE OR REPLACE FUNCTION public.indicador_snapshot(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid;
  _plano jsonb;
  _saldos jsonb;
  _aberturas jsonb;
BEGIN
  SELECT tenant_id INTO _tenant_id FROM public.companies WHERE id = _company_id;
  IF _tenant_id IS NULL THEN
    RETURN jsonb_build_object('plano','[]'::jsonb,'saldos','[]'::jsonb,'aberturas','[]'::jsonb);
  END IF;

  -- Plano: estruturais + participantes que aparecem em saldos_mensais
  WITH codigos_movimento AS (
    SELECT DISTINCT conta_codigo FROM public.saldos_mensais WHERE company_id = _company_id
  ),
  filtrado AS (
    SELECT p.codigo, p.classificacao, p.descricao, p.natureza, p.is_sintetica, p.is_participante
    FROM public.plano_contas p
    WHERE p.tenant_id = _tenant_id
      AND (p.company_id = _company_id OR p.company_id IS NULL)
      AND (p.is_participante = false OR p.codigo IN (SELECT conta_codigo FROM codigos_movimento))
  )
  SELECT jsonb_agg(row_to_json(filtrado)) INTO _plano FROM filtrado;

  SELECT jsonb_agg(jsonb_build_object(
    'conta_codigo', conta_codigo,
    'competencia', to_char(competencia, 'YYYY-MM-DD'),
    'total_debitos', total_debitos,
    'total_creditos', total_creditos
  )) INTO _saldos
  FROM public.saldos_mensais WHERE company_id = _company_id;

  SELECT jsonb_agg(jsonb_build_object(
    'conta_codigo', conta_codigo,
    'data_referencia', to_char(data_referencia, 'YYYY-MM-DD'),
    'saldo', saldo
  )) INTO _aberturas
  FROM public.saldos_abertura WHERE company_id = _company_id;

  RETURN jsonb_build_object(
    'plano', COALESCE(_plano, '[]'::jsonb),
    'saldos', COALESCE(_saldos, '[]'::jsonb),
    'aberturas', COALESCE(_aberturas, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.indicador_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.indicador_snapshot(uuid) TO service_role;
