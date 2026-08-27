CREATE OR REPLACE FUNCTION public.migrar_mapeamento_para_plano()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _exatas int := 0;
  _descendentes int := 0;
  _sem_match int := 0;
  _sep text;
  _pref text;
  _n int;
  _map record;
BEGIN
  WITH upd AS (
    UPDATE public.plano_contas p
       SET tipo_demonstracao = md.tipo_demonstracao,
           linha_demonstracao = md.linha_demonstracao,
           ordem_linha        = md.ordem,
           inverter_sinal     = md.inverter_sinal,
           tipo_custo         = md.tipo_custo
      FROM public.mapeamento_demonstracao md
     WHERE p.tenant_id = md.tenant_id
       AND p.company_id IS NOT DISTINCT FROM md.company_id
       AND p.classificacao = md.classificacao_prefixo
       AND p.is_participante = false
       AND md.tipo_demonstracao IN ('DRE','BP_ATIVO','BP_PASSIVO')
    RETURNING 1
  )
  SELECT count(*) INTO _exatas FROM upd;

  FOR _map IN
    SELECT md.*
      FROM public.mapeamento_demonstracao md
     WHERE md.tipo_demonstracao IN ('DRE','BP_ATIVO','BP_PASSIVO')
       AND NOT EXISTS (
         SELECT 1 FROM public.plano_contas p
          WHERE p.tenant_id = md.tenant_id
            AND p.company_id IS NOT DISTINCT FROM md.company_id
            AND p.classificacao = md.classificacao_prefixo
       )
     ORDER BY length(md.classificacao_prefixo) ASC
  LOOP
    SELECT COALESCE(mc.separador, '.') INTO _sep
      FROM public.mascara_classificacao mc
     WHERE mc.tenant_id = _map.tenant_id
       AND mc.company_id IS NOT DISTINCT FROM _map.company_id
     LIMIT 1;
    _sep := COALESCE(_sep, '.');
    _pref := _map.classificacao_prefixo || _sep;

    UPDATE public.plano_contas p
       SET tipo_demonstracao = _map.tipo_demonstracao,
           linha_demonstracao = _map.linha_demonstracao,
           ordem_linha        = _map.ordem,
           inverter_sinal     = _map.inverter_sinal,
           tipo_custo         = _map.tipo_custo
     WHERE p.tenant_id = _map.tenant_id
       AND p.company_id IS NOT DISTINCT FROM _map.company_id
       AND p.is_participante = false
       AND left(p.classificacao, length(_pref)) = _pref
       AND p.nivel = (
         SELECT min(p2.nivel)
           FROM public.plano_contas p2
          WHERE p2.tenant_id = _map.tenant_id
            AND p2.company_id IS NOT DISTINCT FROM _map.company_id
            AND p2.is_participante = false
            AND left(p2.classificacao, length(_pref)) = _pref
       );
    GET DIAGNOSTICS _n = ROW_COUNT;
    _descendentes := _descendentes + _n;
    IF _n = 0 THEN
      _sem_match := _sem_match + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'alocacoes_exatas', _exatas,
    'alocacoes_por_descendencia', _descendentes,
    'prefixos_sem_conta_no_plano', _sem_match
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.migrar_mapeamento_para_plano() FROM anon, public;

DO $$
DECLARE _r jsonb;
BEGIN
  _r := public.migrar_mapeamento_para_plano();
  RAISE NOTICE 'Conversão mapeamento -> plano_contas: %', _r;
END $$;

CREATE OR REPLACE FUNCTION public.semear_dfc_padrao(_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caixa int := 0; _inv int := 0; _fin int := 0; _oper int := 0; _naocaixa int := 0;
BEGIN
  WITH u AS (
    UPDATE public.plano_contas p SET dfc_atividade = 'caixa'
     WHERE p.is_sintetica = false AND p.dfc_atividade IS NULL
       AND p.tipo = '1-Ativo'
       AND (_tenant_id IS NULL OR p.tenant_id = _tenant_id)
       AND left(p.classificacao, 7) = '1.01.01'
    RETURNING 1
  ) SELECT count(*) INTO _caixa FROM u;

  WITH u AS (
    UPDATE public.plano_contas p SET dfc_atividade = 'investimento'
     WHERE p.is_sintetica = false AND p.dfc_atividade IS NULL
       AND p.tipo = '1-Ativo'
       AND (_tenant_id IS NULL OR p.tenant_id = _tenant_id)
       AND left(p.classificacao, 4) IN ('1.03','1.04')
    RETURNING 1
  ) SELECT count(*) INTO _inv FROM u;

  WITH u AS (
    UPDATE public.plano_contas p SET dfc_atividade = 'financiamento'
     WHERE p.is_sintetica = false AND p.dfc_atividade IS NULL
       AND p.tipo = '2-Passivo'
       AND (_tenant_id IS NULL OR p.tenant_id = _tenant_id)
       AND (
         left(p.classificacao, 7) IN ('2.01.04','2.02.01')
         OR left(p.classificacao, 10) = '2.05.01.01'
       )
    RETURNING 1
  ) SELECT count(*) INTO _fin FROM u;

  UPDATE public.plano_contas p
     SET dfc_nao_caixa = true, dfc_atividade = NULL
   WHERE p.is_sintetica = false
     AND p.tipo IN ('1-Ativo','2-Passivo')
     AND (_tenant_id IS NULL OR p.tenant_id = _tenant_id)
     AND p.descricao ~* '(deprec|amortiz|exaust).*(acum)|(acum).*(deprec|amortiz|exaust)';

  WITH u AS (
    UPDATE public.plano_contas p SET dfc_atividade = 'operacional'
     WHERE p.is_sintetica = false AND p.dfc_atividade IS NULL
       AND p.dfc_nao_caixa = false
       AND p.tipo IN ('1-Ativo','2-Passivo','4-Cli. Nac.','5-For. Nac.','6-Cli. Ex.','7-For. Ex.')
       AND (_tenant_id IS NULL OR p.tenant_id = _tenant_id)
       AND left(p.classificacao, 10) NOT IN ('2.05.01.08','2.05.01.09')
    RETURNING 1
  ) SELECT count(*) INTO _oper FROM u;

  WITH u AS (
    UPDATE public.plano_contas p SET dfc_nao_caixa = true
     WHERE p.is_sintetica = false AND p.dfc_nao_caixa = false
       AND p.tipo = '3-DRE'
       AND (_tenant_id IS NULL OR p.tenant_id = _tenant_id)
       AND p.descricao ~* 'deprec|amortiz|exaust'
    RETURNING 1
  ) SELECT count(*) INTO _naocaixa FROM u;

  RETURN jsonb_build_object(
    'caixa', _caixa, 'investimento', _inv, 'financiamento', _fin,
    'operacional', _oper, 'dre_nao_caixa', _naocaixa
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.semear_dfc_padrao(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.semear_dfc_padrao(uuid) TO authenticated, service_role;

DO $$
DECLARE _r jsonb;
BEGIN
  _r := public.semear_dfc_padrao(NULL);
  RAISE NOTICE 'Semente DFC: %', _r;
END $$;