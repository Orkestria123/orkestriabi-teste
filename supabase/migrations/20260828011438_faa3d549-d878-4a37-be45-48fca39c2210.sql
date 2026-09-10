CREATE OR REPLACE FUNCTION public.plano_padrao_resumo(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $fn$
DECLARE
  _total int := 0; _estruturais int := 0; _participantes int := 0;
  _acumuladores int := 0; _sem_dfc int := 0; _novas int := 0;
  _descartadas int := 0; _empresas int := 0; _ultima timestamptz;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RETURN jsonb_build_object('autorizado', false);
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE NOT COALESCE(is_participante, false)),
         count(*) FILTER (WHERE COALESCE(is_participante, false)),
         count(*) FILTER (WHERE is_sintetica AND classificacao ~ '[.](98|99)([.]|$)')
    INTO _total, _estruturais, _participantes, _acumuladores
    FROM public.plano_contas
   WHERE tenant_id = _tenant_id AND company_id IS NULL;

  SELECT count(*) INTO _sem_dfc
    FROM public.plano_contas p
   WHERE p.tenant_id = _tenant_id
     AND p.company_id IS NULL
     AND p.ativo
     AND NOT COALESCE(p.is_participante, false)
     AND NOT p.is_sintetica
     AND left(p.classificacao, 1) IN ('1', '2')
     AND p.dfc_codigo IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.dfc_vinculo v
        WHERE v.tenant_id = _tenant_id
          AND v.company_id IS NULL
          AND (p.classificacao = v.classificacao
               OR p.classificacao LIKE v.classificacao || '.%')
     );

  SELECT count(*) INTO _novas
    FROM (
      SELECT DISTINCT l.conta_codigo
        FROM public.lancamentos_diario l
        JOIN public.companies c
          ON c.id = l.company_id
         AND COALESCE(c.plano_tipo, 'padrao') = 'padrao'
       WHERE l.tenant_id = _tenant_id
    ) d
   WHERE NOT EXISTS (
     SELECT 1 FROM public.plano_contas p
      WHERE p.tenant_id = _tenant_id AND p.company_id IS NULL AND p.codigo = d.conta_codigo
   )
     AND NOT EXISTS (
     SELECT 1 FROM public.plano_contas_descartadas x
      WHERE x.tenant_id = _tenant_id AND x.codigo = d.conta_codigo
   );

  SELECT count(*) INTO _descartadas
    FROM public.plano_contas_descartadas WHERE tenant_id = _tenant_id;
  SELECT count(*) INTO _empresas
    FROM public.companies
   WHERE tenant_id = _tenant_id AND COALESCE(plano_tipo, 'padrao') = 'padrao';
  SELECT max(created_at) INTO _ultima
    FROM public.plano_atualizacoes
   WHERE tenant_id = _tenant_id AND company_id IS NULL;

  RETURN jsonb_build_object(
    'autorizado', true, 'total', _total, 'estruturais', _estruturais,
    'participantes', _participantes, 'acumuladores', _acumuladores,
    'marcos', _acumuladores, 'sem_dfc', _sem_dfc,
    'contas_novas', _novas, 'descartadas', _descartadas,
    'empresas_usando', _empresas, 'ultima_atualizacao', _ultima
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.plano_padrao_resumo(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.plano_padrao_resumo(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._garantir_sinteticas_interno(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _separador text DEFAULT '.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $fn$
DECLARE _criadas int := 0;
BEGIN
  WITH grupos AS MATERIALIZED (
    SELECT p.classificacao,
           min(p.descricao) AS descricao,
           min(p.tipo) AS tipo,
           min(p.descricao) FILTER (
             WHERE right(p.classificacao, length(_separador) + 2)
                   IN (_separador || '98', _separador || '99')
           ) AS descricao_acumulador
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM _company_id
     GROUP BY p.classificacao
  ),
  ancestrais AS MATERIALIZED (
    SELECT DISTINCT array_to_string(
             (string_to_array(g.classificacao, _separador))[1:i], _separador
           ) AS cls
      FROM grupos g
      CROSS JOIN LATERAL generate_series(
        1, array_length(string_to_array(g.classificacao, _separador), 1) - 1
      ) AS i
  ),
  faltando AS MATERIALIZED (
    SELECT a.cls FROM ancestrais a
     WHERE a.cls <> ''
       AND NOT EXISTS (SELECT 1 FROM grupos g WHERE g.classificacao = a.cls)
  ),
  filhos AS MATERIALIZED (
    SELECT f.cls,
           min(g.descricao_acumulador) AS descricao_acumulador,
           min(g.descricao) AS descricao,
           min(g.tipo) AS tipo,
           count(DISTINCT g.descricao) AS nomes
      FROM faltando f
      LEFT JOIN grupos g ON g.classificacao LIKE f.cls || _separador || '%'
     GROUP BY f.cls
  ),
  ins AS (
    INSERT INTO public.plano_contas
      (tenant_id, company_id, codigo, classificacao, descricao, tipo, natureza,
       nivel, is_sintetica, is_participante, conta_pai_classificacao, ativo)
    SELECT _tenant_id, _company_id, 'S-' || f.cls, f.cls,
           COALESCE(f.descricao_acumulador,
                    CASE WHEN f.nomes = 1 THEN f.descricao END,
                    'GRUPO ' || f.cls),
           COALESCE(f.tipo, '1-Ativo'), 'S',
           array_length(string_to_array(f.cls, _separador), 1),
           true, false,
           CASE WHEN position(_separador in f.cls) > 0
                THEN left(f.cls, length(f.cls) - position(_separador in reverse(f.cls)))
                ELSE NULL END,
           true
      FROM filhos f
    ON CONFLICT (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo)
      DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _criadas FROM ins;

  RETURN jsonb_build_object('sinteticas_criadas', _criadas, 'rodadas', 1);
END;
$fn$;

ALTER FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text)
  SET statement_timeout = '300s';
REVOKE EXECUTE ON FUNCTION public._garantir_sinteticas_interno(uuid, uuid, text) FROM anon, public;

CREATE OR REPLACE FUNCTION public.dfc_cobertura(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $fn$
DECLARE _r jsonb;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  WITH conta AS (
    SELECT p.is_sintetica,
           left(p.classificacao, 1) AS grupo,
           p.dfc_codigo IS NOT NULL OR EXISTS (
             SELECT 1 FROM public.dfc_vinculo v
              WHERE v.tenant_id = _tenant_id
                AND v.company_id IS NOT DISTINCT FROM _company_id
                AND (p.classificacao = v.classificacao
                     OR p.classificacao LIKE v.classificacao || '.%')
           ) AS tem_codigo
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM _company_id
       AND p.ativo
       AND NOT COALESCE(p.is_participante, false)
  )
  SELECT jsonb_build_object(
           'analiticas_balanco', count(*) FILTER (WHERE NOT is_sintetica AND grupo IN ('1','2')),
           'sem_codigo', count(*) FILTER (WHERE NOT is_sintetica AND grupo IN ('1','2') AND NOT tem_codigo),
           'sinteticas_balanco', count(*) FILTER (WHERE is_sintetica AND grupo IN ('1','2')),
           'sinteticas_sem_codigo', count(*) FILTER (WHERE is_sintetica AND grupo IN ('1','2') AND NOT tem_codigo),
           'vinculos', (SELECT count(*) FROM public.dfc_vinculo v
                        WHERE v.tenant_id = _tenant_id
                          AND v.company_id IS NOT DISTINCT FROM _company_id),
           'total_plano', count(*)
         )
    INTO _r FROM conta;
  RETURN _r;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_cobertura(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_cobertura(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';