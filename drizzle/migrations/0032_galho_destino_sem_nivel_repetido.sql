CREATE OR REPLACE FUNCTION public.plano_grupos_destino(_tenant_id uuid, _company_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(classificacao text, demonstracao text, galho text, codigo_dfc text, descricao_dfc text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH alvo AS (
    SELECT CASE
      WHEN _company_id IS NULL THEN NULL::uuid
      WHEN COALESCE((public.escopo_plano_empresa(_company_id)->>'usa_plano_padrao')::boolean,
                    false) THEN NULL::uuid
      ELSE _company_id END AS company_id
  ),
  sint AS MATERIALIZED (
    SELECT p.classificacao, p.descricao, p.tipo, p.nivel
      FROM public.plano_contas p, alvo a
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM a.company_id
       AND p.ativo AND p.is_sintetica
       AND NOT COALESCE(p.is_participante, false)
  ),
  folhas AS MATERIALIZED (
    SELECT DISTINCT ON (p.classificacao) p.classificacao, p.tipo
      FROM public.plano_contas p, alvo a
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM a.company_id
       AND p.ativo AND NOT p.is_sintetica
       AND NOT COALESCE(p.is_participante, false)
     ORDER BY p.classificacao,
              (left(p.tipo, 1) = left(p.classificacao, 1)) DESC, p.tipo
  ),
  cadeia_bruta AS (
    SELECT f.classificacao, f.tipo,
           array_agg(public.ecd_titulo(s.descricao) ORDER BY length(s.classificacao))
             AS degraus
      FROM folhas f
      LEFT JOIN sint s
             ON s.classificacao = f.classificacao
             OR left(f.classificacao, length(s.classificacao) + 1) = s.classificacao || '.'
     GROUP BY f.classificacao, f.tipo
  ),
  -- Degraus consecutivos com o MESMO nome (ex.: 3.02 e 3.02.99, ambos
  -- "Custos dos Produtos Vendidos") viram um só: o galho não repete nível.
  cadeia AS (
    SELECT b.classificacao, b.tipo,
           (SELECT string_agg(d.nome, ' > ' ORDER BY d.ord)
              FROM (
                SELECT u.nome, u.ord,
                       lag(u.nome) OVER (ORDER BY u.ord) AS ant
                  FROM unnest(b.degraus) WITH ORDINALITY AS u(nome, ord)
              ) d
             WHERE d.ant IS DISTINCT FROM d.nome) AS galho
      FROM cadeia_bruta b
  ),
  res AS MATERIALIZED (
    SELECT * FROM public.dfc_resolucao(_tenant_id, (SELECT company_id FROM alvo))
  )
  SELECT c.classificacao, c.tipo, c.galho, r.codigo_dfc, cat.descricao
    FROM cadeia c
    LEFT JOIN LATERAL (
      SELECT x.codigo_dfc FROM res x
       WHERE c.classificacao = x.classificacao
          OR left(c.classificacao, length(x.classificacao) + 1) = x.classificacao || '.'
       ORDER BY length(x.classificacao) DESC
       LIMIT 1
    ) r ON true
    LEFT JOIN public.dfc_catalogo cat ON cat.codigo = r.codigo_dfc;
$function$;