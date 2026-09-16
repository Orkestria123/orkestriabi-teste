-- Função temporária de medição: quanto tempo leva cada etapa da
-- conferência de grupos da ECD. Serve só para diagnóstico e é removida
-- em seguida.
CREATE OR REPLACE FUNCTION public.ecd_diag_grupos(_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid; _company uuid; _escopo uuid; _t timestamptz; _out jsonb := '{}'::jsonb;
  _ms numeric;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;

  _t := clock_timestamp();
  _escopo := CASE WHEN COALESCE(
      (public.escopo_plano_empresa(_company)->>'usa_plano_padrao')::boolean, false)
    THEN NULL ELSE _company END;
  _out := _out || jsonb_build_object('escopo_ms',
    extract(milliseconds from clock_timestamp() - _t));

  _t := clock_timestamp();
  CREATE TEMP TABLE _grp ON COMMIT DROP AS
    SELECT * FROM public.ecd_grupo_destino(_importacao_id);
  CREATE INDEX ON _grp (codigo);
  CREATE INDEX ON _grp (grupo_classificacao);
  ANALYZE _grp;
  _out := _out || jsonb_build_object('grp_ms',
    round(extract(epoch from clock_timestamp() - _t) * 1000),
    'grp_linhas', (SELECT count(*) FROM _grp));

  _t := clock_timestamp();
  CREATE TEMP TABLE _fora_base ON COMMIT DROP AS
    SELECT d.conta_codigo
      FROM public.depara_contas d
      JOIN _grp g ON g.codigo = d.conta_codigo
      JOIN public.plano_contas pa
             ON pa.tenant_id = _tenant
            AND pa.company_id IS NOT DISTINCT FROM _escopo
            AND pa.codigo = d.conta_padrao_codigo
     WHERE d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_padrao_codigo IS NOT NULL
       AND g.grupo_classificacao IS NOT NULL
       AND NOT (pa.classificacao = g.grupo_classificacao
             OR left(pa.classificacao, length(g.grupo_classificacao) + 1)
                = g.grupo_classificacao || '.')
     ORDER BY d.conta_codigo LIMIT 300;
  ANALYZE _fora_base;
  _out := _out || jsonb_build_object('fora_ms',
    round(extract(epoch from clock_timestamp() - _t) * 1000),
    'fora_linhas', (SELECT count(*) FROM _fora_base));

  _t := clock_timestamp();
  CREATE TEMP TABLE _folha ON COMMIT DROP AS
    SELECT p.codigo, p.classificacao, p.tipo,
           public.ecd_normalizar_texto(p.descricao) AS norm,
           public.ecd_palavras(p.descricao)         AS palavras
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _escopo
       AND p.ativo AND NOT p.is_sintetica
       AND NOT COALESCE(p.is_participante, false);
  ANALYZE _folha;
  _out := _out || jsonb_build_object('folha_ms',
    round(extract(epoch from clock_timestamp() - _t) * 1000),
    'folha_linhas', (SELECT count(*) FROM _folha));

  _t := clock_timestamp();
  PERFORM count(*)
    FROM public.depara_contas d
    JOIN _grp g ON g.codigo = d.conta_codigo
   WHERE d.tenant_id = _tenant AND d.company_id = _company
     AND NOT public.ecd_vinculo_do_robo(d.observacao);
  _out := _out || jsonb_build_object('manuais_ms',
    round(extract(epoch from clock_timestamp() - _t) * 1000));

  _t := clock_timestamp();
  PERFORM count(*)
    FROM public.depara_contas d
    JOIN _grp g ON g.codigo = d.conta_codigo
    JOIN public.plano_contas pa
      ON pa.tenant_id = _tenant AND pa.company_id IS NOT DISTINCT FROM _escopo
     AND pa.codigo = d.conta_padrao_codigo
   WHERE d.tenant_id = _tenant AND d.company_id = _company
     AND g.grupo_classificacao IS NOT NULL
     AND (pa.classificacao = g.grupo_classificacao
       OR left(pa.classificacao, length(g.grupo_classificacao) + 1)
          = g.grupo_classificacao || '.');
  _out := _out || jsonb_build_object('mantidas_ms',
    round(extract(epoch from clock_timestamp() - _t) * 1000));

  RETURN _out;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ecd_diag_grupos(uuid) TO PUBLIC;