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
  _my_tenant uuid;
  _my_company uuid;
BEGIN
  SELECT tenant_id INTO _tenant_id FROM public.companies WHERE id = _company_id;
  IF _tenant_id IS NULL THEN
    RETURN jsonb_build_object('plano','[]'::jsonb,'saldos','[]'::jsonb,'aberturas','[]'::jsonb);
  END IF;

  IF NOT public.is_orkestria_admin() THEN
    _my_tenant := public.get_my_tenant_id();
    _my_company := public.get_my_company_id();
    IF _my_tenant IS DISTINCT FROM _tenant_id
       OR (_my_company IS NOT NULL AND _my_company IS DISTINCT FROM _company_id) THEN
      RETURN jsonb_build_object('plano','[]'::jsonb,'saldos','[]'::jsonb,'aberturas','[]'::jsonb);
    END IF;
  END IF;

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
REVOKE EXECUTE ON FUNCTION public.indicador_snapshot(uuid) FROM anon, public;

ALTER TABLE public.diario_uploads
  ADD COLUMN IF NOT EXISTS agregado boolean NOT NULL DEFAULT false;

UPDATE public.diario_uploads SET agregado = true WHERE status = 'done' AND agregado = false;

CREATE OR REPLACE FUNCTION public.agregar_saldos_mensais(_upload_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _agregado boolean;
BEGIN
  SELECT agregado INTO _agregado
  FROM public.diario_uploads
  WHERE id = _upload_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'diario_uploads % não encontrado', _upload_id;
  END IF;

  IF _agregado THEN
    RETURN;
  END IF;

  INSERT INTO public.saldos_mensais (tenant_id, company_id, conta_codigo, competencia, total_debitos, total_creditos)
  SELECT tenant_id, company_id, conta_codigo, competencia,
         SUM(debito), SUM(credito)
  FROM public.lancamentos_diario
  WHERE upload_id = _upload_id
  GROUP BY tenant_id, company_id, conta_codigo, competencia
  ON CONFLICT (company_id, conta_codigo, competencia) DO UPDATE
    SET total_debitos = public.saldos_mensais.total_debitos + EXCLUDED.total_debitos,
        total_creditos = public.saldos_mensais.total_creditos + EXCLUDED.total_creditos,
        updated_at = now();

  UPDATE public.diario_uploads SET agregado = true WHERE id = _upload_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.agregar_saldos_mensais(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.agregar_saldos_mensais(uuid) FROM anon, public;

CREATE OR REPLACE FUNCTION public.reverter_upload_diario(_upload_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company uuid;
BEGIN
  SELECT company_id INTO _company FROM public.diario_uploads WHERE id = _upload_id;
  IF _company IS NULL THEN RETURN; END IF;

  WITH agg AS (
    SELECT conta_codigo, competencia, SUM(debito) d, SUM(credito) c
    FROM public.lancamentos_diario
    WHERE upload_id = _upload_id
    GROUP BY conta_codigo, competencia
  )
  UPDATE public.saldos_mensais s
     SET total_debitos = s.total_debitos - agg.d,
         total_creditos = s.total_creditos - agg.c,
         updated_at = now()
    FROM agg
   WHERE s.company_id = _company
     AND s.conta_codigo = agg.conta_codigo
     AND s.competencia = agg.competencia;

  DELETE FROM public.saldos_mensais
   WHERE company_id = _company
     AND total_debitos = 0 AND total_creditos = 0;

  DELETE FROM public.lancamentos_diario WHERE upload_id = _upload_id;

  UPDATE public.diario_uploads SET agregado = false WHERE id = _upload_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reverter_upload_diario(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.reverter_upload_diario(uuid) FROM anon, public;

DROP INDEX IF EXISTS public.idx_user_roles_user;