CREATE INDEX IF NOT EXISTS idx_plano_contas_tenant_classificacao ON public.plano_contas (tenant_id, classificacao);
CREATE OR REPLACE FUNCTION public.revisar_hierarquia_plano(_tenant_id uuid, _aplicar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s' AS $$
DECLARE _pai int; _niv int; _orf jsonb;
BEGIN
  IF NOT public.pode_tenant(_tenant_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  CREATE TEMP TABLE _h ON COMMIT DROP AS
  SELECT p.id, p.classificacao, p.codigo, p.descricao, p.is_sintetica, p.company_id,
         p.conta_pai_classificacao AS pai_atual, p.nivel AS nivel_atual,
         array_length(string_to_array(p.classificacao, '.'), 1) AS nivel_novo,
         (SELECT array_to_string((string_to_array(p.classificacao, '.'))[1:k], '.')
            FROM generate_series(array_length(string_to_array(p.classificacao, '.'), 1) - 1, 1, -1) k
           WHERE EXISTS (SELECT 1 FROM public.plano_contas s
                          WHERE s.tenant_id = _tenant_id
                            AND (s.company_id IS NULL OR s.company_id = p.company_id)
                            AND s.classificacao = array_to_string((string_to_array(p.classificacao, '.'))[1:k], '.'))
           ORDER BY k DESC LIMIT 1) AS pai_novo
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