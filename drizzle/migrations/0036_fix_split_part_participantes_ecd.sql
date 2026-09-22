CREATE OR REPLACE FUNCTION public.ecd_criar_participantes(_importacao_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  _tenant uuid; _company uuid; _n int := 0;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  WITH pais AS (
    SELECT c.codigo, c.descricao, c.natureza, c.cod_superior, c.profundidade,
           upper(p.descricao) AS nome_pai
      FROM public.ecd_conta c
      JOIN public.ecd_conta p
        ON p.importacao_id = c.importacao_id AND p.codigo = c.cod_superior
     WHERE c.importacao_id = _importacao_id
       AND c.tipo = 'A'
       AND upper(p.descricao) LIKE ANY (ARRAY['%CLIENTE%', '%FORNECEDOR%'])
  ),
  prontas AS (
    SELECT p.codigo,
           p.natureza, p.cod_superior, p.profundidade,
           (string_to_array(p.codigo, '.'))[array_length(string_to_array(p.codigo, '.'), 1)]
             || ' ' || initcap(lower(p.descricao)) AS descricao,
           COALESCE(d.conta_padrao_codigo, p.cod_superior) AS classificacao
      FROM pais p
      LEFT JOIN public.depara_contas d
        ON d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_codigo = p.cod_superior
  ),
  inseridas AS (
    INSERT INTO public.plano_contas
      (tenant_id, company_id, codigo, classificacao, descricao, tipo, natureza,
       nivel, is_participante, is_sintetica, ativo, conta_pai_classificacao, dfc_nao_caixa)
    SELECT _tenant, _company, r.codigo, r.classificacao, r.descricao, 'A',
           COALESCE(r.natureza, 'D'),
           GREATEST(COALESCE(r.profundidade, 5), 1),
           true, false, true, r.classificacao, false
      FROM prontas r
     WHERE NOT EXISTS (
       SELECT 1 FROM public.plano_contas pc
        WHERE pc.tenant_id = _tenant
          AND pc.company_id = _company
          AND pc.codigo = r.codigo)
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM inseridas;

  RETURN _n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ecd_criar_participantes(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_criar_participantes(uuid) TO authenticated, service_role;