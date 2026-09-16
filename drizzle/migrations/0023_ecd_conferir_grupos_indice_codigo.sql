-- `company_id IS NOT DISTINCT FROM _escopo` impede o uso de índice:
-- as duas consultas que cruzam o de-para com o plano varriam as 212 mil
-- contas do escritório (3,6 s + 2,6 s) e era isso que estourava o tempo
-- limite na conferência de grupos. Com COALESCE o planejador usa o
-- índice único (tenant_id, COALESCE(company_id, zeros), codigo).
CREATE OR REPLACE FUNCTION public.ecd_alocar_por_grupo(_importacao_id uuid, _so_conferir boolean DEFAULT false, _minimo numeric DEFAULT 0.34)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid; _company uuid; _escopo uuid;
  _escopo_k uuid;
  _novas int := 0; _movidas int := 0; _mantidas int := 0;
  _sem_grupo int; _sem_folha int := 0; _manuais int; _fora jsonb;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_acessar_empresa(_company) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  _escopo := CASE WHEN COALESCE(
      (public.escopo_plano_empresa(_company)->>'usa_plano_padrao')::boolean, false)
    THEN NULL ELSE _company END;
  _escopo_k := COALESCE(_escopo, '00000000-0000-0000-0000-000000000000'::uuid);

  CREATE TEMP TABLE _grp ON COMMIT DROP AS
    SELECT * FROM public.ecd_grupo_destino(_importacao_id);
  CREATE INDEX ON _grp (codigo);
  CREATE INDEX ON _grp (grupo_classificacao);
  ANALYZE _grp;

  CREATE TEMP TABLE _fora_base ON COMMIT DROP AS
    SELECT d.conta_codigo, g.descricao AS nome, d.conta_padrao_codigo AS hoje,
           pa.classificacao AS hoje_em, g.grupo_classificacao AS grupo,
           g.grupo_descricao AS grupo_nome, d.observacao AS motivo
      FROM public.depara_contas d
      JOIN _grp g ON g.codigo = d.conta_codigo
      JOIN public.plano_contas pa
             ON pa.tenant_id = _tenant
            AND COALESCE(pa.company_id, '00000000-0000-0000-0000-000000000000'::uuid) = _escopo_k
            AND pa.codigo = d.conta_padrao_codigo
     WHERE d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_padrao_codigo IS NOT NULL
       AND g.grupo_classificacao IS NOT NULL
       AND pa.classificacao IS NOT NULL
       AND NOT (pa.classificacao = g.grupo_classificacao
             OR left(pa.classificacao, length(g.grupo_classificacao) + 1)
                = g.grupo_classificacao || '.')
     ORDER BY d.conta_codigo
     LIMIT CASE WHEN _so_conferir THEN 300 ELSE NULL END;
  CREATE INDEX ON _fora_base (conta_codigo);
  ANALYZE _fora_base;

  CREATE TEMP TABLE _folha ON COMMIT DROP AS
    SELECT p.codigo, p.classificacao, p.descricao, p.tipo,
           public.ecd_normalizar_texto(p.descricao) AS norm,
           public.ecd_palavras(p.descricao)         AS palavras
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant
       AND COALESCE(p.company_id, '00000000-0000-0000-0000-000000000000'::uuid) = _escopo_k
       AND p.ativo AND NOT p.is_sintetica
       AND NOT COALESCE(p.is_participante, false);
  CREATE INDEX ON _folha (classificacao);
  ANALYZE _folha;

  CREATE TEMP TABLE _origem ON COMMIT DROP AS
    SELECT g.codigo, g.grupo_classificacao, g.tipo_alvo,
           public.ecd_normalizar_texto(g.descricao) AS norm,
           public.ecd_palavras(g.descricao)         AS palavras
      FROM _grp g
     WHERE g.grupo_classificacao IS NOT NULL
       AND (NOT _so_conferir
            OR EXISTS (SELECT 1 FROM _fora_base f WHERE f.conta_codigo = g.codigo));
  CREATE INDEX ON _origem (codigo);
  ANALYZE _origem;

  -- Semelhança por join de PALAVRA, não subselect por par de contas.
  CREATE TEMP TABLE _cand ON COMMIT DROP AS
    WITH ow AS (
      SELECT o.codigo, o.grupo_classificacao, o.tipo_alvo, o.norm,
             COALESCE(array_length(o.palavras, 1), 0) AS n, w.palavra
        FROM _origem o CROSS JOIN LATERAL unnest(o.palavras) AS w(palavra)
    ), fw AS (
      SELECT f.codigo, f.classificacao, f.tipo, f.norm,
             COALESCE(array_length(f.palavras, 1), 0) AS n, w.palavra
        FROM _folha f CROSS JOIN LATERAL unnest(f.palavras) AS w(palavra)
    )
    SELECT ow.codigo AS ecd_codigo, fw.codigo AS plano_codigo,
           (ow.norm = fw.norm) AS nome_igual,
           round(2.0 * count(DISTINCT ow.palavra)
                 / NULLIF(ow.n + fw.n, 0), 4) AS nota
      FROM ow
      JOIN fw
        ON fw.palavra = ow.palavra
       AND (fw.classificacao = ow.grupo_classificacao
            OR left(fw.classificacao, length(ow.grupo_classificacao) + 1)
               = ow.grupo_classificacao || '.')
       AND (ow.tipo_alvo IS NULL OR fw.tipo = ow.tipo_alvo)
     GROUP BY ow.codigo, fw.codigo, (ow.norm = fw.norm), ow.n, fw.n;
  ANALYZE _cand;

  CREATE TEMP TABLE _alvo ON COMMIT DROP AS
    SELECT DISTINCT ON (c.ecd_codigo)
           c.ecd_codigo, c.plano_codigo, c.nome_igual, c.nota
      FROM _cand c
     WHERE c.nome_igual OR c.nota >= _minimo
     ORDER BY c.ecd_codigo, c.nome_igual DESC, c.nota DESC, c.plano_codigo;
  CREATE INDEX ON _alvo (ecd_codigo);
  ANALYZE _alvo;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'conta',   f.conta_codigo,
             'nome',    f.nome,
             'hoje',    f.hoje,
             'hoje_em', f.hoje_em,
             'grupo',   f.grupo,
             'grupo_nome', f.grupo_nome,
             'passa_a_ser', a.plano_codigo,
             'motivo',  f.motivo) ORDER BY f.conta_codigo), '[]'::jsonb)
    INTO _fora
    FROM _fora_base f
    LEFT JOIN _alvo a ON a.ecd_codigo = f.conta_codigo;

  IF NOT _so_conferir THEN
    WITH movidas AS (
      UPDATE public.depara_contas d
         SET conta_padrao_codigo = a.plano_codigo,
             observacao = 'ECD: realocada para o grupo ' || g.grupo_descricao,
             updated_at = now()
        FROM _grp g, _alvo a,
             public.plano_contas pa
       WHERE g.codigo = d.conta_codigo
         AND a.ecd_codigo = d.conta_codigo
         AND d.tenant_id = _tenant AND d.company_id = _company
         AND d.conta_padrao_codigo IS NOT NULL
         AND public.ecd_vinculo_do_robo(d.observacao)
         AND g.grupo_classificacao IS NOT NULL
         AND pa.tenant_id = _tenant
         AND COALESCE(pa.company_id, '00000000-0000-0000-0000-000000000000'::uuid) = _escopo_k
         AND pa.codigo = d.conta_padrao_codigo
         AND NOT (pa.classificacao = g.grupo_classificacao
               OR left(pa.classificacao, length(g.grupo_classificacao) + 1)
                  = g.grupo_classificacao || '.')
         AND a.plano_codigo IS DISTINCT FROM d.conta_padrao_codigo
      RETURNING 1
    ) SELECT count(*) INTO _movidas FROM movidas;

    WITH novas AS (
      INSERT INTO public.depara_contas
        (tenant_id, company_id, conta_codigo, conta_padrao_codigo, ignorada, observacao)
      SELECT _tenant, _company, a.ecd_codigo, a.plano_codigo, false,
             'ECD: alocada no grupo ' || g.grupo_descricao ||
             CASE WHEN a.nome_igual THEN ' (nome idêntico)'
                  ELSE ' (' || round(a.nota * 100) || '% de semelhança)' END
        FROM _alvo a JOIN _grp g ON g.codigo = a.ecd_codigo
       WHERE NOT EXISTS (
         SELECT 1 FROM public.depara_contas d
          WHERE d.tenant_id = _tenant AND d.company_id = _company
            AND d.conta_codigo = a.ecd_codigo)
      RETURNING 1
    ) SELECT count(*) INTO _novas FROM novas;
  END IF;

  IF _so_conferir THEN
    SELECT count(*) FILTER (WHERE g.grupo_classificacao IS NULL)
      INTO _sem_grupo FROM _grp g;
    _sem_folha := NULL;
  ELSE
    SELECT count(*) FILTER (WHERE g.grupo_classificacao IS NULL),
           count(*) FILTER (WHERE g.grupo_classificacao IS NOT NULL
                              AND NOT EXISTS (SELECT 1 FROM _alvo a WHERE a.ecd_codigo = g.codigo))
      INTO _sem_grupo, _sem_folha
      FROM _grp g;
  END IF;

  SELECT count(*) INTO _manuais
    FROM public.depara_contas d
    JOIN _grp g ON g.codigo = d.conta_codigo
   WHERE d.tenant_id = _tenant AND d.company_id = _company
     AND NOT public.ecd_vinculo_do_robo(d.observacao);

  SELECT count(*) INTO _mantidas
    FROM public.depara_contas d
    JOIN _grp g ON g.codigo = d.conta_codigo
    JOIN public.plano_contas pa
      ON pa.tenant_id = _tenant
     AND COALESCE(pa.company_id, '00000000-0000-0000-0000-000000000000'::uuid) = _escopo_k
     AND pa.codigo = d.conta_padrao_codigo
   WHERE d.tenant_id = _tenant AND d.company_id = _company
     AND g.grupo_classificacao IS NOT NULL
     AND (pa.classificacao = g.grupo_classificacao
       OR left(pa.classificacao, length(g.grupo_classificacao) + 1)
          = g.grupo_classificacao || '.');

  RETURN jsonb_build_object(
    'so_conferir',    _so_conferir,
    'realocadas',     _movidas,
    'novas',          _novas,
    'ja_no_grupo',    _mantidas,
    'sem_grupo',      _sem_grupo,
    'sem_folha_no_grupo', _sem_folha,
    'manuais_preservados', _manuais,
    'fora_do_grupo',  _fora);
END;
$function$;