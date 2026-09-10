CREATE OR REPLACE FUNCTION public.depara_pendencias(_company_id uuid, _limite int DEFAULT 500)
RETURNS TABLE (
  codigo text,
  classificacao text,
  descricao text,
  tipo text,
  movimento numeric,
  sugestao_codigo text,
  sugestao_descricao text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RETURN;
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;
  IF _tenant IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH mov_saldos AS (
    SELECT s.conta_codigo, sum(s.movimento)::numeric AS movimento
      FROM public.saldos_mensais s
     WHERE s.company_id = _company_id
     GROUP BY s.conta_codigo
  ),
  mov_abertura AS (
    SELECT sa.conta_codigo, sum(sa.saldo)::numeric AS movimento
      FROM public.saldos_abertura sa
     WHERE sa.company_id = _company_id
       AND NOT EXISTS (
         SELECT 1 FROM mov_saldos m WHERE m.conta_codigo = sa.conta_codigo)
     GROUP BY sa.conta_codigo
  ),
  mov_diario AS (
    SELECT l.conta_codigo,
           (sum(l.debito) - sum(l.credito))::numeric AS movimento
      FROM public.lancamentos_diario l
     WHERE l.company_id = _company_id
       AND NOT EXISTS (
         SELECT 1 FROM mov_saldos m WHERE m.conta_codigo = l.conta_codigo)
       AND NOT EXISTS (
         SELECT 1 FROM mov_abertura a WHERE a.conta_codigo = l.conta_codigo)
     GROUP BY l.conta_codigo
  ),
  plano_sem_mov AS (
    SELECT p.codigo AS conta_codigo, 0::numeric AS movimento
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant
       AND p.company_id = _company_id
       AND coalesce(p.is_sintetica, false) = false
       AND coalesce(p.is_participante, false) = false
       AND NOT EXISTS (SELECT 1 FROM mov_saldos m WHERE m.conta_codigo = p.codigo)
       AND NOT EXISTS (SELECT 1 FROM mov_abertura a WHERE a.conta_codigo = p.codigo)
       AND NOT EXISTS (SELECT 1 FROM mov_diario d WHERE d.conta_codigo = p.codigo)
  ),
  mov AS (
    SELECT * FROM mov_saldos
    UNION ALL SELECT * FROM mov_abertura
    UNION ALL SELECT * FROM mov_diario
    UNION ALL SELECT * FROM plano_sem_mov
  ),
  nomes AS (
    SELECT DISTINCT ON (l.conta_codigo) l.conta_codigo, l.conta_nome
      FROM public.lancamentos_diario l
     WHERE l.company_id = _company_id
       AND nullif(btrim(l.conta_nome), '') IS NOT NULL
     ORDER BY l.conta_codigo, l.conta_nome
  ),
  origem AS (
    SELECT m.conta_codigo AS codigo,
           coalesce(
             nullif(btrim(p.classificacao), ''),
             CASE WHEN m.conta_codigo ~ '[0-9]+[.\-/][0-9]' THEN m.conta_codigo ELSE '' END
           ) AS classificacao,
           coalesce(nullif(btrim(p.descricao), ''), nullif(btrim(n.conta_nome), ''), m.conta_codigo) AS descricao,
           coalesce(nullif(btrim(p.tipo), ''), '') AS tipo,
           m.movimento
      FROM mov m
      LEFT JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND p.company_id = _company_id
       AND p.codigo = m.conta_codigo
      LEFT JOIN nomes n ON n.conta_codigo = m.conta_codigo
      LEFT JOIN public.depara_contas d
        ON d.company_id = _company_id AND d.conta_codigo = m.conta_codigo
     WHERE d.id IS NULL
        OR (d.ignorada = false AND d.conta_padrao_codigo IS NULL)
  )
  SELECT o.codigo, o.classificacao, o.descricao, o.tipo, o.movimento,
         sug.codigo, sug.descricao
    FROM origem o
    LEFT JOIN LATERAL (
      SELECT pp.codigo, pp.descricao
        FROM public.plano_contas pp
       WHERE pp.tenant_id = _tenant
         AND pp.company_id IS NULL
         AND coalesce(pp.is_sintetica, false) = false
         AND coalesce(pp.is_participante, false) = false
         AND coalesce(pp.ativo, true)
         AND o.classificacao <> ''
         AND (
              pp.classificacao = o.classificacao
           OR pp.classificacao LIKE o.classificacao || '.%'
           OR o.classificacao LIKE pp.classificacao || '.%'
         )
       ORDER BY (pp.classificacao = o.classificacao) DESC,
                length(coalesce(pp.classificacao, '')) ASC
       LIMIT 1
    ) sug ON true
   ORDER BY abs(o.movimento) DESC
   LIMIT GREATEST(_limite, 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.depara_pendencias(uuid, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.depara_pendencias(uuid, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.depara_traducao(_company_id uuid)
RETURNS TABLE (
  conta_codigo text,
  conta_padrao_codigo text,
  origem text,
  ignorada boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _tenant uuid;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;

  RETURN QUERY
  WITH com_saldo AS (
    SELECT DISTINCT sm.conta_codigo FROM public.saldos_mensais sm
     WHERE sm.company_id = _company_id
    UNION
    SELECT DISTINCT sa.conta_codigo FROM public.saldos_abertura sa
     WHERE sa.company_id = _company_id
    UNION
    SELECT DISTINCT l.conta_codigo FROM public.lancamentos_diario l
     WHERE l.company_id = _company_id
  )
  SELECT cs.conta_codigo,
         COALESCE(dc.conta_padrao_codigo, r.conta_padrao_codigo),
         CASE WHEN dc.conta_padrao_codigo IS NOT NULL THEN 'exato'
              WHEN r.conta_padrao_codigo IS NOT NULL THEN 'regra'
              ELSE 'sem_vinculo' END,
         COALESCE(dc.ignorada, false)
    FROM com_saldo cs
    LEFT JOIN public.plano_contas p
      ON p.tenant_id = _tenant AND p.company_id = _company_id AND p.codigo = cs.conta_codigo
    LEFT JOIN public.depara_contas dc
      ON dc.company_id = _company_id AND dc.conta_codigo = cs.conta_codigo
    LEFT JOIN LATERAL (
      SELECT dr.conta_padrao_codigo
        FROM public.depara_regras dr
       WHERE dr.company_id = _company_id
         AND (dr.tipo_conta IS NULL OR dr.tipo_conta = coalesce(p.tipo, dr.tipo_conta))
         AND (dr.classificacao_prefixo IS NULL
              OR coalesce(p.classificacao, cs.conta_codigo) = dr.classificacao_prefixo
              OR left(coalesce(p.classificacao, cs.conta_codigo), length(dr.classificacao_prefixo) + 1)
                 = dr.classificacao_prefixo || '.')
       ORDER BY length(COALESCE(dr.classificacao_prefixo, '')) DESC,
                (dr.tipo_conta IS NOT NULL) DESC
       LIMIT 1
    ) r ON true;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.depara_traducao(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.depara_traducao(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.depara_carregar_origem(_company_id uuid, _contas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
  _n int := 0;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para configurar o de-para desta empresa';
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada';
  END IF;
  IF _contas IS NULL OR jsonb_typeof(_contas) <> 'array' THEN
    RETURN jsonb_build_object('gravadas', 0);
  END IF;

  WITH entrada AS (
    SELECT DISTINCT ON (x.codigo)
           btrim(x.codigo) AS codigo,
           nullif(btrim(x.classificacao), '') AS classificacao,
           nullif(btrim(x.descricao), '') AS descricao
      FROM jsonb_to_recordset(_contas) AS x(
        codigo text, classificacao text, descricao text
      )
     WHERE nullif(btrim(x.codigo), '') IS NOT NULL
     ORDER BY x.codigo
  ),
  gravadas AS (
    INSERT INTO public.plano_contas (
      tenant_id, company_id, codigo, classificacao, descricao, tipo, natureza,
      nivel, is_sintetica, is_participante, ativo
    )
    SELECT _tenant, _company_id, e.codigo,
           coalesce(e.classificacao, e.codigo),
           coalesce(e.descricao, e.codigo),
           CASE left(coalesce(e.classificacao, e.codigo), 1)
             WHEN '1' THEN '1-Ativo'
             WHEN '2' THEN '2-Passivo'
             ELSE '3-DRE'
           END,
           'A',
           greatest(1, array_length(regexp_split_to_array(coalesce(e.classificacao, e.codigo), '[.\-/]'), 1)),
           false, false, true
      FROM entrada e
    ON CONFLICT (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo)
    DO UPDATE SET
      classificacao = COALESCE(EXCLUDED.classificacao, public.plano_contas.classificacao),
      descricao     = COALESCE(NULLIF(EXCLUDED.descricao, EXCLUDED.codigo), public.plano_contas.descricao),
      updated_at    = now()
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM gravadas;

  RETURN jsonb_build_object('gravadas', _n);
END;
$$;

REVOKE ALL ON FUNCTION public.depara_carregar_origem(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.depara_carregar_origem(uuid, jsonb) TO authenticated, service_role;