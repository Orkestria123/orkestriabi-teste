-- Junta origem no índice (evita nested loop 1755×1755 na fila).

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
       AND NOT _tem_saldo
     GROUP BY l.conta_codigo
  ),
  mov_real AS (
    SELECT * FROM mov_saldos
    UNION ALL SELECT * FROM mov_abertura
    UNION ALL SELECT * FROM mov_diario
  ),
  mov AS (
    SELECT * FROM mov_real
    UNION ALL
    SELECT p.codigo, 0::numeric
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant
       AND p.company_id = _company_id
       AND coalesce(p.is_sintetica, false) = false
       AND coalesce(p.is_participante, false) = false
       AND NOT EXISTS (
         SELECT 1 FROM mov_real m WHERE m.conta_codigo = p.codigo)
  ),
  fila AS (
    SELECT m.conta_codigo AS codigo,
           coalesce(
             nullif(btrim(p.classificacao), ''),
             CASE WHEN m.conta_codigo ~ '[0-9]+[.\-/][0-9]' THEN m.conta_codigo ELSE '' END
           ) AS classificacao,
           coalesce(nullif(btrim(p.descricao), ''), m.conta_codigo) AS descricao,
           coalesce(nullif(btrim(p.tipo), ''), '') AS tipo,
           m.movimento
      FROM mov m
      LEFT JOIN LATERAL (
        SELECT p0.classificacao, p0.descricao, p0.tipo
          FROM public.plano_contas p0
         WHERE p0.tenant_id = _tenant
           AND p0.company_id = _company_id
           AND p0.codigo = m.conta_codigo
         LIMIT 1
      ) p ON true
     WHERE NOT EXISTS (
             SELECT 1 FROM public.depara_contas d
              WHERE d.company_id = _company_id
                AND d.conta_codigo = m.conta_codigo
                AND (d.ignorada = true OR d.conta_padrao_codigo IS NOT NULL)
           )
  ),
  topo AS (
    SELECT f.*
      FROM fila f
     ORDER BY abs(f.movimento) DESC, f.codigo
     LIMIT GREATEST(_limite, 1)
  )
  SELECT t.codigo,
         t.classificacao,
         coalesce(nullif(btrim(n.conta_nome), ''), t.descricao) AS descricao,
         t.tipo,
         t.movimento,
         sug.codigo,
         sug.descricao
    FROM topo t
    LEFT JOIN LATERAL (
      SELECT l.conta_nome
        FROM public.lancamentos_diario l
       WHERE l.company_id = _company_id
         AND l.conta_codigo = t.codigo
         AND nullif(btrim(l.conta_nome), '') IS NOT NULL
         AND NOT _tem_saldo
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
         AND t.classificacao <> ''
         AND pp.classificacao = t.classificacao
       LIMIT 1
    ) sug ON true;
END;
$$;

NOTIFY pgrst, 'reload schema';
