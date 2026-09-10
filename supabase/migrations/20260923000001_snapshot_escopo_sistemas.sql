-- Indicadores zerados depois da troca "Plano Padrão / Outro sistema":
-- 1) indicador_snapshot lia o escopo via escopo_plano_empresa, que
--    devolve só {autorizado:false} se pode_acessar_empresa falha
--    (admin do escritório sem membership). Sem usa_plano_padrao o
--    snapshot assume plano da empresa — vazio — e descarta todos os
--    saldos no JS (codigoToClass miss).
-- 2) Empresa marcada "proprio" sem de-para e sem plano próprio
--    (clique em Outro sistema sem importar nada) também caía no
--    plano da empresa vazio. Saldos já estão no código do Padrão.
-- 3) De-para N→1 não somava movimento no mesmo (código, competência).

CREATE OR REPLACE FUNCTION public.escopo_plano_empresa(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _scope uuid; _sep text; _tipo text;
  _tem_padrao boolean; _tem_depara boolean; _tem_plano_empresa boolean;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RETURN jsonb_build_object('autorizado', false);
  END IF;
  SELECT e.tenant_id, e.company_scope, e.separador
    INTO _tenant, _scope, _sep
    FROM public.plano_escopo(_company_id) e;
  IF _tenant IS NULL THEN
    RETURN jsonb_build_object('autorizado', true, 'encontrado', false);
  END IF;
  SELECT COALESCE(plano_tipo,'padrao') INTO _tipo FROM public.companies WHERE id = _company_id;
  SELECT EXISTS (
    SELECT 1 FROM public.plano_contas pc WHERE pc.tenant_id = _tenant AND pc.company_id IS NULL
  ) INTO _tem_padrao;
  SELECT EXISTS (
    SELECT 1 FROM public.depara_contas d
     WHERE d.company_id = _company_id AND d.conta_padrao_codigo IS NOT NULL
    UNION ALL
    SELECT 1 FROM public.depara_regras r WHERE r.company_id = _company_id
  ) INTO _tem_depara;
  SELECT EXISTS (
    SELECT 1 FROM public.plano_contas pc WHERE pc.company_id = _company_id
  ) INTO _tem_plano_empresa;

  RETURN jsonb_build_object(
    'autorizado', true,
    'encontrado', true,
    'tenant_id', _tenant,
    'usa_plano_padrao',
      (_scope IS NULL)
      OR (_tipo = 'proprio' AND _tem_padrao AND _tem_depara)
      OR (_tipo = 'proprio' AND _tem_padrao AND NOT _tem_depara AND NOT _tem_plano_empresa),
    'usa_depara', (_tipo = 'proprio' AND _tem_padrao AND _tem_depara),
    'plano_tipo', _tipo,
    'plano_padrao_existe', _tem_padrao,
    'fallback_plano_proprio', (_tipo = 'padrao' AND NOT _tem_padrao),
    'separador', _sep
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.indicador_snapshot(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant_id uuid; _plano jsonb; _saldos jsonb; _aberturas jsonb;
  _my_tenant uuid; _my_company uuid;
  _tipo text; _scope uuid; _usa_depara boolean;
  _tem_padrao boolean; _tem_depara boolean; _tem_plano_empresa boolean;
BEGIN
  SELECT tenant_id, COALESCE(plano_tipo, 'padrao')
    INTO _tenant_id, _tipo
    FROM public.companies WHERE id = _company_id;
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

  SELECT EXISTS (
    SELECT 1 FROM public.plano_contas pc
     WHERE pc.tenant_id = _tenant_id AND pc.company_id IS NULL
  ) INTO _tem_padrao;
  SELECT EXISTS (
    SELECT 1 FROM public.depara_contas d
     WHERE d.company_id = _company_id AND d.conta_padrao_codigo IS NOT NULL
    UNION ALL
    SELECT 1 FROM public.depara_regras r WHERE r.company_id = _company_id
  ) INTO _tem_depara;
  SELECT EXISTS (
    SELECT 1 FROM public.plano_contas pc WHERE pc.company_id = _company_id
  ) INTO _tem_plano_empresa;

  _usa_depara := (_tipo = 'proprio' AND _tem_padrao AND _tem_depara);
  IF _usa_depara
     OR _tipo = 'padrao'
     OR (_tipo = 'proprio' AND _tem_padrao AND NOT _tem_plano_empresa) THEN
    _scope := NULL;
  ELSE
    _scope := _company_id;
  END IF;

  IF _usa_depara THEN
    WITH trad AS (
      SELECT t.conta_codigo, t.conta_padrao_codigo
        FROM public.depara_traducao(_company_id) t
       WHERE NOT t.ignorada AND t.conta_padrao_codigo IS NOT NULL
    )
    SELECT jsonb_agg(jsonb_build_object(
             'conta_codigo', x.cod,
             'competencia', to_char(x.competencia, 'YYYY-MM-DD'),
             'total_debitos', x.total_debitos,
             'total_creditos', x.total_creditos))
      INTO _saldos
      FROM (
        SELECT COALESCE(tr.conta_padrao_codigo, sm.conta_codigo) AS cod,
               sm.competencia,
               SUM(sm.total_debitos) AS total_debitos,
               SUM(sm.total_creditos) AS total_creditos
          FROM public.saldos_mensais sm
          LEFT JOIN trad tr ON tr.conta_codigo = sm.conta_codigo
         WHERE sm.company_id = _company_id
         GROUP BY 1, 2
      ) x;

    WITH trad AS (
      SELECT t.conta_codigo, t.conta_padrao_codigo
        FROM public.depara_traducao(_company_id) t
       WHERE NOT t.ignorada AND t.conta_padrao_codigo IS NOT NULL
    )
    SELECT jsonb_agg(jsonb_build_object(
             'conta_codigo', x.cod,
             'data_referencia', to_char(x.data_referencia, 'YYYY-MM-DD'),
             'saldo', x.saldo))
      INTO _aberturas
      FROM (
        SELECT COALESCE(tr.conta_padrao_codigo, sa.conta_codigo) AS cod,
               sa.data_referencia,
               SUM(sa.saldo) AS saldo
          FROM public.saldos_abertura sa
          LEFT JOIN trad tr ON tr.conta_codigo = sa.conta_codigo
         WHERE sa.company_id = _company_id
         GROUP BY 1, 2
      ) x;
  ELSE
    SELECT jsonb_agg(jsonb_build_object(
             'conta_codigo', sm.conta_codigo,
             'competencia', to_char(sm.competencia, 'YYYY-MM-DD'),
             'total_debitos', sm.total_debitos,
             'total_creditos', sm.total_creditos))
      INTO _saldos
      FROM public.saldos_mensais sm
     WHERE sm.company_id = _company_id;

    SELECT jsonb_agg(jsonb_build_object(
             'conta_codigo', sa.conta_codigo,
             'data_referencia', to_char(sa.data_referencia, 'YYYY-MM-DD'),
             'saldo', sa.saldo))
      INTO _aberturas
      FROM public.saldos_abertura sa
     WHERE sa.company_id = _company_id;
  END IF;

  WITH codigos_movimento AS (
    SELECT DISTINCT COALESCE(v->>'conta_codigo', '') AS cod
      FROM jsonb_array_elements(COALESCE(_saldos, '[]'::jsonb)) v
    UNION
    SELECT DISTINCT COALESCE(v->>'conta_codigo', '')
      FROM jsonb_array_elements(COALESCE(_aberturas, '[]'::jsonb)) v
  ),
  filtrado AS (
    SELECT p.codigo, p.classificacao, p.descricao, p.natureza,
           p.is_sintetica, p.is_participante, p.tipo_custo
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM _scope
       AND (p.is_participante = false
            OR p.codigo IN (SELECT cod FROM codigos_movimento))
  )
  SELECT jsonb_agg(row_to_json(filtrado)) INTO _plano FROM filtrado;

  RETURN jsonb_build_object(
    'plano', COALESCE(_plano, '[]'::jsonb),
    'saldos', COALESCE(_saldos, '[]'::jsonb),
    'aberturas', COALESCE(_aberturas, '[]'::jsonb));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.escopo_plano_empresa(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.escopo_plano_empresa(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.indicador_snapshot(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.indicador_snapshot(uuid) TO authenticated, service_role;
