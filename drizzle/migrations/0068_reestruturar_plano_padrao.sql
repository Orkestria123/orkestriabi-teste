CREATE OR REPLACE FUNCTION public.revisar_hierarquia_plano(_tenant_id uuid, _aplicar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s' AS $$
DECLARE _pai int; _niv int; _orf jsonb;
BEGIN
  IF NOT public.pode_tenant(_tenant_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  CREATE TEMP TABLE _h ON COMMIT DROP AS
  SELECT p.id, p.classificacao, p.codigo, p.descricao, p.is_sintetica, p.company_id,
         p.conta_pai_classificacao AS pai_atual, p.nivel AS nivel_atual,
         array_length(string_to_array(p.classificacao, '.'), 1) AS nivel_novo,
         (SELECT s.classificacao FROM public.plano_contas s
           WHERE s.tenant_id = _tenant_id AND s.is_sintetica AND NOT s.is_participante
             AND (s.company_id IS NULL OR s.company_id = p.company_id)
             AND left(p.classificacao, length(s.classificacao) + 1) = s.classificacao || '.'
           ORDER BY length(s.classificacao) DESC LIMIT 1) AS pai_novo
    FROM public.plano_contas p
   WHERE p.tenant_id = _tenant_id AND NOT p.is_participante;

  SELECT count(*) FILTER (WHERE pai_atual IS DISTINCT FROM pai_novo),
         count(*) FILTER (WHERE nivel_atual IS DISTINCT FROM nivel_novo)
    INTO _pai, _niv FROM _h;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('classificacao', classificacao, 'codigo', codigo, 'descricao', descricao)
           ORDER BY classificacao), '[]'::jsonb)
    INTO _orf FROM (SELECT * FROM _h WHERE pai_novo IS NULL AND nivel_novo > 1 ORDER BY classificacao LIMIT 100) o;

  IF _aplicar THEN
    UPDATE public.plano_contas p SET conta_pai_classificacao = h.pai_novo, nivel = h.nivel_novo, updated_at = now()
      FROM _h h WHERE h.id = p.id
       AND (h.pai_atual IS DISTINCT FROM h.pai_novo OR h.nivel_atual IS DISTINCT FROM h.nivel_novo);
  END IF;

  RETURN jsonb_build_object(
    'pai_divergente', _pai, 'nivel_divergente', _niv,
    'exemplos', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
       SELECT jsonb_build_object('classificacao', classificacao, 'descricao', descricao,
              'pai_atual', pai_atual, 'pai_novo', pai_novo) x
         FROM _h WHERE pai_atual IS DISTINCT FROM pai_novo ORDER BY classificacao LIMIT 30) e),
    'sem_grupo', _orf, 'aplicado', _aplicar);
END $$;

CREATE OR REPLACE FUNCTION public.mover_grupo_plano(_tenant_id uuid, _de text, _para text, _aplicar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s' AS $$
DECLARE _n int; _col jsonb; _sint int; _dfc int := 0; _reg int := 0; _sa int := 0; _lista jsonb;
BEGIN
  IF NOT public.pode_tenant(_tenant_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  _de := btrim(_de, ' .'); _para := btrim(_para, ' .');
  IF _de = '' OR _para = '' OR _de = _para THEN RAISE EXCEPTION 'Informe a classificação atual e a nova.'; END IF;
  IF left(_para, length(_de) + 1) = _de || '.' THEN RAISE EXCEPTION 'A nova posição não pode ficar dentro do próprio grupo.'; END IF;
  IF _para !~ '^[0-9]+(\.[0-9]+)*$' THEN RAISE EXCEPTION 'Classificação nova inválida: %', _para; END IF;

  CREATE TEMP TABLE _m ON COMMIT DROP AS
  SELECT p.id, p.classificacao AS antiga, _para || substr(p.classificacao, length(_de) + 1) AS nova,
         p.codigo, p.descricao, p.is_sintetica, p.company_id
    FROM public.plano_contas p
   WHERE p.tenant_id = _tenant_id AND NOT p.is_participante
     AND (p.classificacao = _de OR left(p.classificacao, length(_de) + 1) = _de || '.');

  SELECT count(*), count(*) FILTER (WHERE is_sintetica) INTO _n, _sint FROM _m;
  IF _n = 0 THEN RAISE EXCEPTION 'Nenhuma conta com a classificação %', _de; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('classificacao', p.classificacao, 'descricao', p.descricao, 'codigo', p.codigo)), '[]'::jsonb)
    INTO _col
    FROM public.plano_contas p JOIN _m m ON m.nova = p.classificacao
   WHERE p.tenant_id = _tenant_id AND NOT p.is_participante
     AND p.company_id IS NOT DISTINCT FROM m.company_id
     AND p.id NOT IN (SELECT id FROM _m);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('antiga', antiga, 'nova', nova, 'descricao', descricao,
           'sintetica', is_sintetica, 'empresa', company_id IS NOT NULL) ORDER BY antiga), '[]'::jsonb)
    INTO _lista FROM (SELECT * FROM _m ORDER BY antiga LIMIT 200) l;

  IF _aplicar THEN
    IF jsonb_array_length(_col) > 0 THEN
      RAISE EXCEPTION 'Já existem contas nas classificações de destino. Escolha outra posição.';
    END IF;
    UPDATE public.plano_contas p SET classificacao = m.nova, updated_at = now() FROM _m m WHERE m.id = p.id;

    UPDATE public.dfc_vinculo v SET classificacao = _para || substr(v.classificacao, length(_de) + 1), atualizado_em = now()
     WHERE v.tenant_id = _tenant_id AND (v.classificacao = _de OR left(v.classificacao, length(_de) + 1) = _de || '.');
    GET DIAGNOSTICS _dfc = ROW_COUNT;

    UPDATE public.depara_regras r SET classificacao_prefixo = _para || substr(r.classificacao_prefixo, length(_de) + 1)
     WHERE r.tenant_id = _tenant_id AND (r.classificacao_prefixo = _de OR left(r.classificacao_prefixo, length(_de) + 1) = _de || '.');
    GET DIAGNOSTICS _reg = ROW_COUNT;

    UPDATE public.saldos_abertura s SET classificacao = _para || substr(s.classificacao, length(_de) + 1)
     WHERE s.tenant_id = _tenant_id AND (s.classificacao = _de OR left(s.classificacao, length(_de) + 1) = _de || '.');
    GET DIAGNOSTICS _sa = ROW_COUNT;

    -- Garante os grupos acima da nova posição e refaz pai/nível de todo o plano.
    PERFORM public.revisar_hierarquia_plano(_tenant_id, true);
  END IF;

  RETURN jsonb_build_object('contas', _n, 'sinteticas', _sint, 'conflitos', _col, 'lista', _lista,
    'pai_destino', (SELECT s.classificacao || ' ' || s.descricao FROM public.plano_contas s
       WHERE s.tenant_id = _tenant_id AND s.company_id IS NULL AND s.is_sintetica
         AND left(_para, length(s.classificacao) + 1) = s.classificacao || '.'
       ORDER BY length(s.classificacao) DESC LIMIT 1),
    'dfc_atualizados', _dfc, 'regras_atualizadas', _reg, 'saldos_atualizados', _sa, 'aplicado', _aplicar);
END $$;

REVOKE ALL ON FUNCTION public.revisar_hierarquia_plano(uuid, boolean) FROM anon, public;
REVOKE ALL ON FUNCTION public.mover_grupo_plano(uuid, text, text, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.revisar_hierarquia_plano(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mover_grupo_plano(uuid, text, text, boolean) TO authenticated, service_role;