CREATE OR REPLACE FUNCTION public.ecd_diag_grupos(_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid; _company uuid; _escopo uuid := NULL; _t timestamptz; _out jsonb := '{}'::jsonb;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;

  _t := clock_timestamp();
  CREATE TEMP TABLE _grp ON COMMIT DROP AS
  WITH conta AS (
    SELECT c.codigo, c.descricao, public.ecd_tipo_do_cod_nat(c.natureza) AS tipo_alvo,
           c.caminho_nomes
      FROM public.ecd_conta c
     WHERE c.importacao_id = _importacao_id AND COALESCE(c.tipo, 'A') <> 'S'
  ), ancestral AS (
    SELECT ct.codigo, seg.nome, seg.ord, ct.tipo_alvo,
           row_number() OVER (PARTITION BY ct.codigo ORDER BY seg.ord DESC) AS distancia
      FROM conta ct
      CROSS JOIN LATERAL (
        SELECT s AS nome, i AS ord
          FROM unnest(string_to_array(COALESCE(ct.caminho_nomes, ''), ' > ')) WITH ORDINALITY AS t(s, i)
      ) seg
     WHERE seg.ord < COALESCE(array_length(string_to_array(COALESCE(ct.caminho_nomes, ''), ' > '), 1), 0)
       AND btrim(seg.nome) <> ''
  ), nome_ancestral AS (SELECT DISTINCT a.nome, a.tipo_alvo FROM ancestral a
  ), grupo AS (
    SELECT p.classificacao, p.descricao, p.tipo, public.ecd_palavras(p.descricao) AS palavras
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant AND p.company_id IS NOT DISTINCT FROM _escopo
       AND p.ativo AND p.is_sintetica AND COALESCE(p.classificacao, '') <> ''
  ), par AS (
    SELECT na.nome, na.tipo_alvo, g.classificacao, g.descricao,
           round(2.0 * count(*) / (COALESCE(array_length(public.ecd_palavras(na.nome), 1), 0)
                + COALESCE(array_length(g.palavras, 1), 0)), 4) AS nota
      FROM nome_ancestral na
      CROSS JOIN LATERAL unnest(public.ecd_palavras(na.nome)) AS w(palavra)
      JOIN grupo g ON g.palavras @> ARRAY[w.palavra]
     WHERE na.tipo_alvo IS NULL OR g.tipo = na.tipo_alvo
     GROUP BY na.nome, na.tipo_alvo, g.classificacao, g.descricao, g.palavras
  ), melhor_grupo AS (
    SELECT DISTINCT ON (p.nome, p.tipo_alvo) p.nome, p.tipo_alvo, p.classificacao, p.descricao, p.nota
      FROM par p WHERE p.nota >= 0.5
     ORDER BY p.nome, p.tipo_alvo, p.nota DESC, length(p.classificacao) DESC, p.classificacao
  ), escolhido AS (
    SELECT DISTINCT ON (a.codigo) a.codigo, mg.classificacao, mg.descricao, a.nome, mg.nota
      FROM ancestral a
      JOIN melhor_grupo mg ON mg.nome = a.nome AND mg.tipo_alvo IS NOT DISTINCT FROM a.tipo_alvo
     ORDER BY a.codigo, a.distancia, mg.nota DESC
  )
  SELECT ct.codigo, ct.descricao, ct.tipo_alvo,
         e.classificacao AS grupo_classificacao, e.descricao AS grupo_descricao
    FROM conta ct LEFT JOIN escolhido e ON e.codigo = ct.codigo;
  CREATE INDEX ON _grp (codigo);
  CREATE INDEX ON _grp (grupo_classificacao);
  ANALYZE _grp;
  _out := _out || jsonb_build_object('grp_ms',
    round(extract(epoch from clock_timestamp() - _t) * 1000),
    'grp_linhas', (SELECT count(*) FROM _grp));

  _t := clock_timestamp();
  CREATE TEMP TABLE _fora_base ON COMMIT DROP AS
    SELECT d.conta_codigo, g.grupo_classificacao AS grupo
      FROM public.depara_contas d
      JOIN _grp g ON g.codigo = d.conta_codigo
      JOIN public.plano_contas pa
             ON pa.tenant_id = _tenant AND pa.company_id IS NOT DISTINCT FROM _escopo
            AND pa.codigo = d.conta_padrao_codigo
     WHERE d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_padrao_codigo IS NOT NULL
       AND g.grupo_classificacao IS NOT NULL
       AND NOT (pa.classificacao = g.grupo_classificacao
             OR left(pa.classificacao, length(g.grupo_classificacao) + 1)
                = g.grupo_classificacao || '.')
     ORDER BY d.conta_codigo LIMIT 300;
  CREATE INDEX ON _fora_base (conta_codigo);
  ANALYZE _fora_base;
  _out := _out || jsonb_build_object('fora_ms',
    round(extract(epoch from clock_timestamp() - _t) * 1000),
    'fora_linhas', (SELECT count(*) FROM _fora_base));

  _t := clock_timestamp();
  CREATE TEMP TABLE _folha ON COMMIT DROP AS
    SELECT p.codigo, p.classificacao, p.tipo,
           public.ecd_normalizar_texto(p.descricao) AS norm,
           public.ecd_palavras(p.descricao) AS palavras
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant AND p.company_id IS NOT DISTINCT FROM _escopo
       AND p.ativo AND NOT p.is_sintetica AND NOT COALESCE(p.is_participante, false);
  CREATE INDEX ON _folha (classificacao);
  ANALYZE _folha;
  _out := _out || jsonb_build_object('folha_ms',
    round(extract(epoch from clock_timestamp() - _t) * 1000),
    'folha_linhas', (SELECT count(*) FROM _folha));

  _t := clock_timestamp();
  CREATE TEMP TABLE _origem ON COMMIT DROP AS
    SELECT g.codigo, g.grupo_classificacao, g.tipo_alvo,
           public.ecd_normalizar_texto(g.descricao) AS norm,
           public.ecd_palavras(g.descricao) AS palavras
      FROM _grp g
     WHERE g.grupo_classificacao IS NOT NULL
       AND EXISTS (SELECT 1 FROM _fora_base f WHERE f.conta_codigo = g.codigo);
  ANALYZE _origem;

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
           round(2.0 * count(DISTINCT ow.palavra) / NULLIF(ow.n + fw.n, 0), 4) AS nota
      FROM ow
      JOIN fw ON fw.palavra = ow.palavra
       AND (fw.classificacao = ow.grupo_classificacao
            OR left(fw.classificacao, length(ow.grupo_classificacao) + 1)
               = ow.grupo_classificacao || '.')
       AND (ow.tipo_alvo IS NULL OR fw.tipo = ow.tipo_alvo)
     GROUP BY ow.codigo, fw.codigo, (ow.norm = fw.norm), ow.n, fw.n;
  _out := _out || jsonb_build_object('cand_ms',
    round(extract(epoch from clock_timestamp() - _t) * 1000),
    'cand_linhas', (SELECT count(*) FROM _cand));

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