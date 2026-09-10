-- Fila em tabela temporária: o diário só é lido quando não há saldo,
-- com IF real (não predicado parametrizado). O plano genérico do
-- plpgsql, depois de algumas chamadas, voltaria a varrer 150 mil
-- lançamentos mesmo com saldo já agregado.

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
  SELECT m.conta_codigo,
         coalesce(
           nullif(btrim(p.classificacao), ''),
           CASE WHEN m.conta_codigo ~ '[0-9]+[.\-/][0-9]' THEN m.conta_codigo ELSE '' END
         ),
         coalesce(nullif(btrim(n.conta_nome), ''), nullif(btrim(p.descricao), ''), m.conta_codigo),
         coalesce(nullif(btrim(p.tipo), ''), ''),
         m.movimento,
         sug.codigo,
         sug.descricao
    FROM _depara_fila_mov m
    LEFT JOIN LATERAL (
      SELECT p0.classificacao, p0.descricao, p0.tipo
        FROM public.plano_contas p0
       WHERE p0.tenant_id = _tenant
         AND p0.company_id = _company_id
         AND p0.codigo = m.conta_codigo
       LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT l.conta_nome
        FROM public.lancamentos_diario l
       WHERE l.company_id = _company_id
         AND l.conta_codigo = m.conta_codigo
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
    ) sug ON true
   WHERE NOT EXISTS (
           SELECT 1 FROM public.depara_contas d
            WHERE d.company_id = _company_id
              AND d.conta_codigo = m.conta_codigo
              AND (d.ignorada = true OR d.conta_padrao_codigo IS NOT NULL)
         )
   ORDER BY abs(m.movimento) DESC, m.conta_codigo
   LIMIT GREATEST(_limite, 1);
END;
$$;

NOTIFY pgrst, 'reload schema';
