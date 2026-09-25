CREATE OR REPLACE FUNCTION public.criar_conta_empresa_sintetica(
  _company_id uuid, _sintetica text, _descricao text,
  _tipo_custo text DEFAULT NULL, _classe_gasto text DEFAULT NULL, _dfc_codigo text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _tenant uuid; _pd record; _pref text; _n int; _cod text;
BEGIN
  SELECT tenant_id INTO _tenant FROM public.companies WHERE id = _company_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF btrim(COALESCE(_descricao,'')) = '' THEN RAISE EXCEPTION 'Informe a descrição'; END IF;
  SELECT * INTO _pd FROM public.plano_contas
   WHERE tenant_id = _tenant AND company_id IS NULL AND is_sintetica = true
     AND (codigo = _sintetica OR classificacao = _sintetica)
   ORDER BY (codigo = _sintetica) DESC LIMIT 1;
  IF _pd.codigo IS NULL THEN RAISE EXCEPTION 'Conta sintética do Plano Padrão não encontrada'; END IF;
  _pref := public.prefixo_empresa(_company_id);
  PERFORM pg_advisory_xact_lock(hashtext('conta_empresa:' || _company_id::text));
  SELECT COALESCE(MAX(substring(codigo FROM length(_pref) + 2)::int), 0) + 1 INTO _n
    FROM public.plano_contas
   WHERE company_id = _company_id AND codigo ~ ('^' || _pref || '-[0-9]+$');
  _cod := _pref || '-' || lpad(_n::text, 4, '0');
  INSERT INTO public.plano_contas
    (tenant_id, company_id, codigo, classificacao, descricao, tipo, natureza, nivel,
     is_participante, is_sintetica, ativo, conta_pai_classificacao, dfc_nao_caixa,
     tipo_custo, classe_gasto, dfc_codigo, dfc_atividade)
  VALUES (_tenant, _company_id, _cod, _pd.classificacao || '.' || _pref || lpad(_n::text, 4, '0'),
     btrim(_descricao), _pd.tipo, _pd.natureza, COALESCE(_pd.nivel, 0) + 1,
     false, false, true, _pd.classificacao, COALESCE(_pd.dfc_nao_caixa, false),
     NULLIF(_tipo_custo,''), NULLIF(_classe_gasto,''),
     COALESCE(NULLIF(_dfc_codigo,''), _pd.dfc_codigo), _pd.dfc_atividade);
  RETURN _cod;
END; $$;
GRANT EXECUTE ON FUNCTION public.criar_conta_empresa_sintetica(uuid,text,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.atualizar_conta_empresa(
  _company_id uuid, _codigo text, _descricao text,
  _tipo_custo text, _classe_gasto text, _dfc_codigo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _tenant uuid;
BEGIN
  SELECT tenant_id INTO _tenant FROM public.companies WHERE id = _company_id;
  IF _tenant IS NULL OR NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  UPDATE public.plano_contas SET descricao = COALESCE(NULLIF(btrim(_descricao),''), descricao),
    tipo_custo = NULLIF(_tipo_custo,''), classe_gasto = NULLIF(_classe_gasto,''),
    dfc_codigo = NULLIF(_dfc_codigo,''), updated_at = now()
   WHERE company_id = _company_id AND codigo = _codigo
     AND codigo LIKE public.prefixo_empresa(_company_id) || '-%';
END; $$;
GRANT EXECUTE ON FUNCTION public.atualizar_conta_empresa(uuid,text,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.excluir_conta_empresa(_company_id uuid, _codigo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _tenant uuid; _desvinc int; _del int;
BEGIN
  SELECT tenant_id INTO _tenant FROM public.companies WHERE id = _company_id;
  IF _tenant IS NULL OR NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF _codigo NOT LIKE public.prefixo_empresa(_company_id) || '-%' THEN
    RAISE EXCEPTION 'Só contas criadas para a empresa podem ser excluídas';
  END IF;
  DELETE FROM public.depara_contas WHERE company_id = _company_id AND conta_padrao_codigo = _codigo;
  GET DIAGNOSTICS _desvinc = ROW_COUNT;
  DELETE FROM public.plano_contas WHERE company_id = _company_id AND codigo = _codigo;
  GET DIAGNOSTICS _del = ROW_COUNT;
  RETURN jsonb_build_object('excluidas', _del, 'desvinculadas', _desvinc);
END; $$;
GRANT EXECUTE ON FUNCTION public.excluir_conta_empresa(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.carimbo_dados_empresa(_company_id uuid)
 RETURNS TABLE(linhas bigint, atualizado_em timestamp with time zone)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT
    COUNT(s.*)::bigint + (SELECT COUNT(*) FROM public.depara_contas d WHERE d.company_id = _company_id)
      + (SELECT COUNT(*) FROM public.plano_contas p WHERE p.company_id = _company_id) AS linhas,
    GREATEST(
      MAX(s.updated_at),
      (SELECT MAX(i.updated_at) FROM public.indicadores_empresa i
        JOIN public.companies c ON c.id = _company_id
        WHERE i.tenant_id = c.tenant_id AND i.company_id IS NULL
          AND lower(regexp_replace(i.nome, '[^[:alnum:]]', '', 'g')) IN ('ebit', 'ebitda')),
      (SELECT MAX(GREATEST(d.updated_at, d.created_at)) FROM public.depara_contas d WHERE d.company_id = _company_id),
      (SELECT MAX(p.updated_at) FROM public.plano_contas p WHERE p.company_id = _company_id)
    ) AS atualizado_em
  FROM public.saldos_mensais s
  WHERE s.company_id = _company_id
$function$;

ALTER ROLE authenticated SET statement_timeout = '120s';

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname LIKE 'ecd\_%' OR p.proname IN ('agregar_saldos_competencia','reverter_saldos_competencia',
            'fechar_upload_diario','competencias_do_upload','aplicar_depara_em_lote','drilldown_contas',
            'depara_traducao_pagina','depara_pendencias'))
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET statement_timeout TO %L', r.f, '300s');
  END LOOP;
END $$;