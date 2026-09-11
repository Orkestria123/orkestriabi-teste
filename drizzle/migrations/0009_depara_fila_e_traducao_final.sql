CREATE INDEX IF NOT EXISTS idx_plano_padrao_classif_analitica
  ON public.plano_contas (tenant_id, classificacao)
  WHERE company_id IS NULL
    AND coalesce(is_sintetica, false) = false
    AND coalesce(is_participante, false) = false;

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
VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
  _tem_saldo boolean;
BEGIN
  PERFORM set_config('statement_timeout', '15s', true);

  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RETURN;
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;
  IF _tenant IS NULL THEN RETURN; END IF;

  SELECT EXISTS (SELECT 1 FROM public.saldos_mensais s WHERE s.company_id = _company_id)
      OR EXISTS (SELECT 1 FROM public.saldos_abertura a WHERE a.company_id = _company_id)
    INTO _tem_saldo;

  DROP TABLE IF EXISTS _depara_fila_mov;
  CREATE TEMP TABLE _depara_fila_mov (
    conta_codigo text PRIMARY KEY,
    movimento numeric NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _depara_fila_mov
  SELECT s.conta_codigo, sum(s.movimento)::numeric
    FROM public.saldos_mensais s
   WHERE s.company_id = _company_id
   GROUP BY s.conta_codigo
  ON CONFLICT DO NOTHING;

  INSERT INTO _depara_fila_mov
  SELECT sa.conta_codigo, sum(sa.saldo)::numeric
    FROM public.saldos_abertura sa
   WHERE sa.company_id = _company_id
   GROUP BY sa.conta_codigo
  ON CONFLICT DO NOTHING;

  IF NOT _tem_saldo THEN
    INSERT INTO _depara_fila_mov
    SELECT l.conta_codigo, (sum(l.debito) - sum(l.credito))::numeric
      FROM public.lancamentos_diario l
     WHERE l.company_id = _company_id
     GROUP BY l.conta_codigo
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO _depara_fila_mov
  SELECT p.codigo, 0::numeric
    FROM public.plano_contas p
   WHERE p.tenant_id = _tenant
     AND p.company_id = _company_id
     AND coalesce(p.is_sintetica, false) = false
     AND coalesce(p.is_participante, false) = false
  ON CONFLICT DO NOTHING;

  RETURN QUERY
  WITH topo AS (
    SELECT m.conta_codigo, m.movimento
      FROM _depara_fila_mov m
     WHERE NOT EXISTS (
             SELECT 1 FROM public.depara_contas d
              WHERE d.company_id = _company_id
                AND d.conta_codigo = m.conta_codigo
                AND (d.ignorada = true OR d.conta_padrao_codigo IS NOT NULL)
           )
     ORDER BY abs(m.movimento) DESC, m.conta_codigo
     LIMIT GREATEST(_limite, 1)
  )
  SELECT t.conta_codigo,
         coalesce(
           nullif(btrim(p.classificacao), ''),
           CASE WHEN t.conta_codigo ~ '[0-9]+[.\-/][0-9]' THEN t.conta_codigo ELSE '' END
         ),
         coalesce(nullif(btrim(n.conta_nome), ''), nullif(btrim(p.descricao), ''), t.conta_codigo),
         coalesce(nullif(btrim(p.tipo), ''), ''),
         t.movimento,
         sug.codigo,
         sug.descricao
    FROM topo t
    LEFT JOIN LATERAL (
      SELECT p0.classificacao, p0.descricao, p0.tipo
        FROM public.plano_contas p0
       WHERE p0.tenant_id = _tenant
         AND p0.company_id = _company_id
         AND p0.codigo = t.conta_codigo
       LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT l.conta_nome
        FROM public.lancamentos_diario l
       WHERE l.company_id = _company_id
         AND l.conta_codigo = t.conta_codigo
         AND nullif(btrim(l.conta_nome), '') IS NOT NULL
       LIMIT 1
    ) n ON true
    LEFT JOIN LATERAL (
      SELECT pp.codigo, pp.descricao
        FROM public.plano_contas pp
       WHERE pp.tenant_id = _tenant
         AND pp.company_id IS NULL
         AND coalesce(pp.is_sintetica, false) = false
         AND coalesce(pp.is_participante, false) = false
         AND coalesce(pp.ativo, true)
         AND coalesce(nullif(btrim(p.classificacao), ''), '') <> ''
         AND pp.classificacao = p.classificacao
       LIMIT 1
    ) sug ON true;
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
DECLARE
  _tenant uuid;
  _tem_saldo boolean;
BEGIN
  PERFORM set_config('statement_timeout', '15s', true);

  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;

  SELECT EXISTS (SELECT 1 FROM public.saldos_mensais s WHERE s.company_id = _company_id)
      OR EXISTS (SELECT 1 FROM public.saldos_abertura a WHERE a.company_id = _company_id)
    INTO _tem_saldo;

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
       AND NOT _tem_saldo
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
    ) r ON true
   ORDER BY cs.conta_codigo;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.depara_traducao(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.depara_traducao(uuid) TO authenticated, service_role;