-- tipo_custo no snapshot dos indicadores; indicador Ponto de Equilíbrio.

CREATE OR REPLACE FUNCTION public.indicador_snapshot(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant_id uuid; _plano jsonb; _saldos jsonb; _aberturas jsonb;
  _my_tenant uuid; _my_company uuid; _esc jsonb; _scope uuid; _usa_depara boolean;
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

  _esc := public.escopo_plano_empresa(_company_id);
  _usa_depara := COALESCE((_esc->>'usa_depara')::boolean, false);
  _scope := CASE WHEN COALESCE((_esc->>'usa_plano_padrao')::boolean, false)
                 THEN NULL ELSE _company_id END;

  WITH trad AS (
    SELECT t.conta_codigo, t.conta_padrao_codigo
      FROM public.depara_traducao(_company_id) t
     WHERE _usa_depara AND NOT t.ignorada AND t.conta_padrao_codigo IS NOT NULL
  )
  SELECT jsonb_agg(jsonb_build_object(
           'conta_codigo', x.cod,
           'competencia', to_char(x.competencia, 'YYYY-MM-DD'),
           'total_debitos', x.total_debitos,
           'total_creditos', x.total_creditos))
    INTO _saldos
    FROM (
      SELECT COALESCE(tr.conta_padrao_codigo, sm.conta_codigo) AS cod,
             sm.competencia, sm.total_debitos, sm.total_creditos
        FROM public.saldos_mensais sm
        LEFT JOIN trad tr ON tr.conta_codigo = sm.conta_codigo
       WHERE sm.company_id = _company_id
    ) x;

  WITH trad AS (
    SELECT t.conta_codigo, t.conta_padrao_codigo
      FROM public.depara_traducao(_company_id) t
     WHERE _usa_depara AND NOT t.ignorada AND t.conta_padrao_codigo IS NOT NULL
  )
  SELECT jsonb_agg(jsonb_build_object(
           'conta_codigo', x.cod,
           'data_referencia', to_char(x.data_referencia, 'YYYY-MM-DD'),
           'saldo', x.saldo))
    INTO _aberturas
    FROM (
      SELECT COALESCE(tr.conta_padrao_codigo, sa.conta_codigo) AS cod,
             sa.data_referencia, sa.saldo
        FROM public.saldos_abertura sa
        LEFT JOIN trad tr ON tr.conta_codigo = sa.conta_codigo
       WHERE sa.company_id = _company_id
    ) x;

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

REVOKE EXECUTE ON FUNCTION public.indicador_snapshot(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.indicador_snapshot(uuid) TO authenticated, service_role;

INSERT INTO public.indicadores_empresa
  (tenant_id, company_id, nome, categoria, formula, modo_analise, faixas,
   descricao, visibilidade, is_padrao, ordem)
SELECT t.id, NULL,
       'Ponto de Equilíbrio', 'Rentabilidade',
       jsonb_build_object('expressao', jsonb_build_array(public._termo('PONTO_EQUILIBRIO'))),
       'reais',
       NULL,
       'Receita mínima para cobrir custos fixos: Fixos / (1 − Variáveis/Receita Líquida). Marque Fixo/Variável no Plano de Contas.',
       'indicadores', true, 200
  FROM public.tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM public.indicadores_empresa e
    WHERE e.tenant_id = t.id AND e.company_id IS NULL
      AND lower(e.nome) IN ('ponto de equilíbrio', 'ponto de equilibrio')
 );

