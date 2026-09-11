ALTER TABLE public.ecd_lancamento
  ADD COLUMN IF NOT EXISTS encerramento boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ecd_lancamento_encerramento
  ON public.ecd_lancamento (importacao_id)
  WHERE encerramento;

CREATE OR REPLACE FUNCTION public.ecd_debito_credito_dre(
  _saldo_inicial numeric,
  _debitos numeric,
  _creditos numeric,
  _saldo_final numeric,
  _conta_resultado boolean
)
RETURNS TABLE (debito numeric, credito numeric)
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT
    CASE
      WHEN _conta_resultado
           AND abs(COALESCE(_saldo_final, 0)) < 0.005
           AND (
             abs(COALESCE(_saldo_inicial, 0)) >= 0.005
             OR (COALESCE(_debitos, 0) > 0 AND COALESCE(_creditos, 0) > 0)
           )
           AND COALESCE(_saldo_inicial, 0) <= 0
        THEN 0::numeric
      ELSE COALESCE(_debitos, 0)
    END,
    CASE
      WHEN _conta_resultado
           AND abs(COALESCE(_saldo_final, 0)) < 0.005
           AND (
             abs(COALESCE(_saldo_inicial, 0)) >= 0.005
             OR (COALESCE(_debitos, 0) > 0 AND COALESCE(_creditos, 0) > 0)
           )
           AND COALESCE(_saldo_inicial, 0) > 0
        THEN 0::numeric
      ELSE COALESCE(_creditos, 0)
    END;
$fn$;

CREATE OR REPLACE FUNCTION public.ecd_conta_resultado(_classificacao text, _codigo text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT left(COALESCE(nullif(btrim(_classificacao), ''), _codigo, ''), 1)
         IN ('3', '4', '5', '6');
$fn$;

CREATE OR REPLACE FUNCTION public.ecd_marcar_encerramento(_importacao_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '180s'
AS $fn$
DECLARE
  _n int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ecd_importacao i WHERE i.id = _importacao_id) THEN
    RAISE EXCEPTION 'Importação não encontrada';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ecd_importacao i
     WHERE i.id = _importacao_id AND public.pode_acessar_empresa(i.company_id)
  ) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  UPDATE public.ecd_lancamento l
     SET encerramento = true
    FROM public.ecd_saldo s
    JOIN public.ecd_conta c
      ON c.importacao_id = s.importacao_id AND c.codigo = s.codigo
   WHERE l.importacao_id = _importacao_id
     AND s.importacao_id = _importacao_id
     AND l.codigo = s.codigo
     AND l.competencia = s.competencia
     AND COALESCE(c.tipo, 'A') <> 'S'
     AND public.ecd_conta_resultado(c.classificacao, c.codigo)
     AND abs(s.saldo_final) < 0.005
     AND abs(s.saldo_inicial) >= 0.005
     AND NOT l.encerramento
     AND (
       (
         l.data = (date_trunc('month', s.competencia) + INTERVAL '1 month' - INTERVAL '1 day')::date
         AND (
           (s.saldo_inicial <= 0 AND l.debito > 0)
           OR (s.saldo_inicial > 0 AND l.credito > 0)
         )
       )
       OR (s.saldo_inicial <= 0 AND l.debito > 0 AND l.debito >= s.debitos * 0.5)
       OR (s.saldo_inicial > 0 AND l.credito > 0 AND l.credito >= s.creditos * 0.5)
     );
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_marcar_encerramento(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_marcar_encerramento(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ecd_gravar_lancamentos(
  _importacao_id uuid,
  _linhas jsonb,
  _primeiro_bloco boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
DECLARE _n int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ecd_importacao i
     WHERE i.id = _importacao_id AND public.pode_acessar_empresa(i.company_id)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para esta importação';
  END IF;

  IF _primeiro_bloco THEN
    DELETE FROM public.ecd_lancamento WHERE importacao_id = _importacao_id;
  END IF;

  WITH gravadas AS (
    INSERT INTO public.ecd_lancamento
      (importacao_id, numero, data, competencia, codigo, debito, credito, historico, encerramento)
    SELECT _importacao_id, x.numero, x.data::date,
           date_trunc('month', x.data::date)::date,
           x.codigo, COALESCE(x.debito, 0), COALESCE(x.credito, 0),
           nullif(btrim(x.historico), ''),
           COALESCE(x.encerramento, false)
      FROM jsonb_to_recordset(_linhas) AS x(
        numero text, data text, codigo text,
        debito numeric, credito numeric, historico text, encerramento boolean)
     WHERE x.codigo IS NOT NULL AND x.data IS NOT NULL AND x.data <> ''
    RETURNING 1
  ) SELECT count(*) INTO _n FROM gravadas;

  RETURN jsonb_build_object('gravadas', _n,
    'total', (SELECT count(*) FROM public.ecd_lancamento WHERE importacao_id = _importacao_id));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_gravar_lancamentos(uuid, jsonb, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_gravar_lancamentos(uuid, jsonb, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ecd_aplicar(
  _importacao_id uuid,
  _substituir boolean DEFAULT false,
  _forcar boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
DECLARE
  _tenant uuid; _company uuid; _primeiro date;
  _sem_vinculo int; _linhas int := 0; _abert int := 0;
  _apagadas int := 0; _meses_do_diario int := 0; _data_abert date;
  _tem_lcto boolean := false;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  PERFORM public.ecd_marcar_encerramento(_importacao_id);

  SELECT count(DISTINCT s.codigo) INTO _sem_vinculo
    FROM public.ecd_saldo s
    LEFT JOIN public.depara_contas d
           ON d.tenant_id = _tenant AND d.company_id = _company AND d.conta_codigo = s.codigo
   WHERE s.importacao_id = _importacao_id
     AND (s.debitos <> 0 OR s.creditos <> 0 OR s.saldo_final <> 0)
     AND d.conta_padrao_codigo IS NULL
     AND NOT COALESCE(d.ignorada, false);

  IF _sem_vinculo > 0 AND NOT _forcar THEN
    RETURN jsonb_build_object('ok', false, 'contas_sem_vinculo', _sem_vinculo,
      'nota', 'há conta com movimento e sem vínculo — vincule ou marque como ignorada antes de aplicar');
  END IF;

  SELECT min(competencia) INTO _primeiro
    FROM public.ecd_saldo WHERE importacao_id = _importacao_id;
  _data_abert := (_primeiro - INTERVAL '1 day')::date;

  SELECT count(DISTINCT s.competencia) INTO _meses_do_diario
    FROM public.ecd_saldo s
   WHERE s.importacao_id = _importacao_id
     AND EXISTS (
       SELECT 1 FROM public.saldos_mensais m
        WHERE m.company_id = _company AND m.competencia = s.competencia
          AND m.origem_ecd IS NULL);

  WITH fora AS (
    DELETE FROM public.saldos_mensais m
     WHERE m.origem_ecd = _importacao_id
       AND NOT EXISTS (
         SELECT 1 FROM public.ecd_saldo s
           JOIN public.depara_contas d
             ON d.tenant_id = _tenant AND d.company_id = _company
            AND d.conta_codigo = s.codigo AND d.conta_padrao_codigo IS NOT NULL
            AND NOT COALESCE(d.ignorada, false)
          WHERE s.importacao_id = _importacao_id
            AND d.conta_padrao_codigo = m.conta_codigo
            AND s.competencia = m.competencia)
    RETURNING 1
  ) SELECT count(*) INTO _apagadas FROM fora;

  WITH bruto AS (
    SELECT d.conta_padrao_codigo AS codigo, s.competencia,
           x.debito AS deb, x.credito AS cred
      FROM public.ecd_saldo s
      JOIN public.ecd_conta c
        ON c.importacao_id = s.importacao_id AND c.codigo = s.codigo
      JOIN public.depara_contas d
        ON d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_codigo = s.codigo AND d.conta_padrao_codigo IS NOT NULL
       AND NOT COALESCE(d.ignorada, false)
      CROSS JOIN LATERAL public.ecd_debito_credito_dre(
        s.saldo_inicial, s.debitos, s.creditos, s.saldo_final,
        public.ecd_conta_resultado(c.classificacao, c.codigo)
          AND COALESCE(c.tipo, 'A') <> 'S'
      ) x
     WHERE s.importacao_id = _importacao_id
  ),
  tradu AS (
    SELECT codigo, competencia, sum(deb) AS deb, sum(cred) AS cred
      FROM bruto GROUP BY 1, 2
  ),
  alvo AS (
    SELECT t.* FROM tradu t
     WHERE _substituir OR NOT EXISTS (
       SELECT 1 FROM public.saldos_mensais m
        WHERE m.company_id = _company AND m.competencia = t.competencia
          AND m.origem_ecd IS NULL)
  ),
  gravado AS (
    INSERT INTO public.saldos_mensais
      (tenant_id, company_id, conta_codigo, competencia, total_debitos, total_creditos, origem_ecd)
    SELECT _tenant, _company, a.codigo, a.competencia, a.deb, a.cred, _importacao_id FROM alvo a
    ON CONFLICT (company_id, conta_codigo, competencia)
      DO UPDATE SET total_debitos = EXCLUDED.total_debitos,
                    total_creditos = EXCLUDED.total_creditos,
                    origem_ecd = EXCLUDED.origem_ecd,
                    updated_at = now()
    RETURNING 1
  ) SELECT count(*) INTO _linhas FROM gravado;

  WITH tradu AS (
    SELECT d.conta_padrao_codigo AS codigo, sum(s.saldo_inicial) AS saldo
      FROM public.ecd_saldo s
      JOIN public.depara_contas d
        ON d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_codigo = s.codigo AND d.conta_padrao_codigo IS NOT NULL
       AND NOT COALESCE(d.ignorada, false)
     WHERE s.importacao_id = _importacao_id AND s.competencia = _primeiro
     GROUP BY 1
  ),
  gravado AS (
    INSERT INTO public.saldos_abertura
      (tenant_id, company_id, conta_codigo, data_referencia, saldo, origem_ecd)
    SELECT _tenant, _company, t.codigo, _data_abert, t.saldo, _importacao_id
      FROM tradu t WHERE t.saldo <> 0
    ON CONFLICT (company_id, conta_codigo, data_referencia)
      DO UPDATE SET saldo = EXCLUDED.saldo, origem_ecd = EXCLUDED.origem_ecd
      WHERE public.saldos_abertura.origem_ecd IS NOT DISTINCT FROM EXCLUDED.origem_ecd
    RETURNING 1
  ) SELECT count(*) INTO _abert FROM gravado;

  SELECT EXISTS (
    SELECT 1 FROM public.ecd_lancamento WHERE importacao_id = _importacao_id
  ) INTO _tem_lcto;

  UPDATE public.ecd_importacao
     SET resumo = COALESCE(resumo, '{}'::jsonb) || jsonb_build_object(
           'linhas_saldos', _linhas, 'linhas_abertura', _abert,
           'contas_sem_vinculo', _sem_vinculo)
   WHERE id = _importacao_id;

  RETURN jsonb_build_object('ok', true,
    'linhas_saldos', _linhas, 'linhas_abertura', _abert,
    'linhas_removidas', _apagadas,
    'lancamentos', 0,
    'tem_lancamentos', _tem_lcto,
    'meses_do_diario', _meses_do_diario,
    'abertura_em', _data_abert,
    'contas_sem_vinculo', _sem_vinculo);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_aplicar(uuid, boolean, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_aplicar(uuid, boolean, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ecd_materializar_lote(
  _importacao_id uuid,
  _depois bigint DEFAULT 0,
  _limite int DEFAULT 2000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
DECLARE
  _tenant uuid; _company uuid; _arquivo text; _upload uuid;
  _n int := 0; _ultimo bigint;
BEGIN
  SELECT i.tenant_id, i.company_id, i.arquivo_nome
    INTO _tenant, _company, _arquivo
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT id INTO _upload FROM public.diario_uploads
   WHERE company_id = _company AND filename = 'ECD: ' || _arquivo
   LIMIT 1;
  IF _upload IS NULL THEN
    RAISE EXCEPTION 'Diário do ECD ainda não foi preparado';
  END IF;

  WITH lote AS (
    SELECT l.seq, l.numero, l.data, l.competencia, l.codigo, l.debito, l.credito, l.historico,
           l.encerramento
      FROM public.ecd_lancamento l
     WHERE l.importacao_id = _importacao_id
       AND l.seq > COALESCE(_depois, 0)
     ORDER BY l.seq
     LIMIT GREATEST(1, LEAST(COALESCE(_limite, 2000), 5000))
  ),
  gravadas AS (
    INSERT INTO public.lancamentos_diario
      (tenant_id, company_id, upload_id, conta_codigo, data, competencia,
       historico, debito, credito, numero_lancamento)
    SELECT _tenant, _company, _upload, d.conta_padrao_codigo, l.data, l.competencia,
           COALESCE(l.historico, ''), l.debito, l.credito, l.numero
      FROM lote l
      JOIN public.depara_contas d
        ON d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_codigo = l.codigo
       AND d.conta_padrao_codigo IS NOT NULL
       AND NOT COALESCE(d.ignorada, false)
      LEFT JOIN public.ecd_conta c
        ON c.importacao_id = _importacao_id AND c.codigo = l.codigo
     WHERE NOT COALESCE(l.encerramento, false)
        OR NOT public.ecd_conta_resultado(c.classificacao, l.codigo)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM gravadas), (SELECT max(seq) FROM lote)
    INTO _n, _ultimo;

  RETURN jsonb_build_object(
    'gravadas', COALESCE(_n, 0),
    'ultimo_seq', COALESCE(_ultimo, _depois),
    'upload_id', _upload);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_materializar_lote(uuid, bigint, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_materializar_lote(uuid, bigint, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ecd_encerramento(_importacao_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH resultado AS (
    SELECT s.competencia, s.codigo, s.saldo_inicial, s.saldo_final
      FROM public.ecd_saldo s
      JOIN public.ecd_conta c
        ON c.importacao_id = s.importacao_id AND c.codigo = s.codigo
     WHERE s.importacao_id = _importacao_id
       AND COALESCE(c.tipo, 'A') <> 'S'
       AND public.ecd_conta_resultado(c.classificacao, c.codigo)
  ),
  zeradas AS (
    SELECT competencia,
           count(*) FILTER (WHERE abs(saldo_final) < 0.005
                              AND abs(saldo_inicial) >= 0.005) AS contas_zeradas,
           sum(abs(saldo_inicial)) FILTER (WHERE abs(saldo_final) < 0.005) AS valor
      FROM resultado GROUP BY competencia
  )
  SELECT jsonb_build_object(
    'tem_encerramento', EXISTS (SELECT 1 FROM zeradas WHERE contas_zeradas >= 3),
    'corrigido_automaticamente', EXISTS (SELECT 1 FROM zeradas WHERE contas_zeradas >= 3),
    'tem_lancamentos', EXISTS (SELECT 1 FROM public.ecd_lancamento
                                WHERE importacao_id = _importacao_id),
    'meses', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'competencia', competencia,
                'contas_zeradas', contas_zeradas,
                'valor_transferido', round(COALESCE(valor, 0), 2))
                ORDER BY competencia)
              FROM zeradas WHERE contas_zeradas >= 3), '[]'::jsonb),
    'contas_de_resultado', (SELECT count(DISTINCT codigo) FROM resultado))
  WHERE EXISTS (SELECT 1 FROM public.ecd_importacao i
                 WHERE i.id = _importacao_id AND public.pode_acessar_empresa(i.company_id));
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_encerramento(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_encerramento(uuid) TO authenticated, service_role;

DO $do$
DECLARE
  _imp uuid;
  _tenant uuid;
  _company uuid;
  _arquivo text;
  _upload uuid;
BEGIN
  PERFORM set_config('statement_timeout', '600s', true);
  FOR _imp, _tenant, _company, _arquivo IN
    SELECT i.id, i.tenant_id, i.company_id, i.arquivo_nome
      FROM public.ecd_importacao i
     WHERE i.status = 'aplicado'
  LOOP
    PERFORM public.ecd_marcar_encerramento(_imp);

    UPDATE public.saldos_mensais m
       SET total_debitos = n.deb,
           total_creditos = n.cred,
           updated_at = now()
      FROM (
        SELECT d.conta_padrao_codigo AS codigo, s.competencia,
               sum(x.debito) AS deb, sum(x.credito) AS cred
          FROM public.ecd_saldo s
          JOIN public.ecd_conta c
            ON c.importacao_id = s.importacao_id AND c.codigo = s.codigo
          JOIN public.depara_contas d
            ON d.tenant_id = _tenant AND d.company_id = _company
           AND d.conta_codigo = s.codigo AND d.conta_padrao_codigo IS NOT NULL
           AND NOT COALESCE(d.ignorada, false)
          CROSS JOIN LATERAL public.ecd_debito_credito_dre(
            s.saldo_inicial, s.debitos, s.creditos, s.saldo_final,
            public.ecd_conta_resultado(c.classificacao, c.codigo)
              AND COALESCE(c.tipo, 'A') <> 'S'
          ) x
         WHERE s.importacao_id = _imp
         GROUP BY 1, 2
      ) n
     WHERE m.origem_ecd = _imp
       AND m.company_id = _company
       AND m.conta_codigo = n.codigo
       AND m.competencia = n.competencia
       AND (m.total_debitos IS DISTINCT FROM n.deb
         OR m.total_creditos IS DISTINCT FROM n.cred);

    SELECT u.id INTO _upload FROM public.diario_uploads u
     WHERE u.company_id = _company AND u.filename = 'ECD: ' || _arquivo
     LIMIT 1;

    IF _upload IS NOT NULL THEN
      DELETE FROM public.lancamentos_diario ld
        USING public.ecd_lancamento l
        JOIN public.depara_contas d
          ON d.tenant_id = _tenant AND d.company_id = _company
         AND d.conta_codigo = l.codigo
         AND d.conta_padrao_codigo IS NOT NULL
         AND NOT COALESCE(d.ignorada, false)
        JOIN public.ecd_conta c
          ON c.importacao_id = l.importacao_id AND c.codigo = l.codigo
       WHERE ld.upload_id = _upload
         AND l.importacao_id = _imp
         AND l.encerramento
         AND public.ecd_conta_resultado(c.classificacao, l.codigo)
         AND COALESCE(c.tipo, 'A') <> 'S'
         AND ld.conta_codigo = d.conta_padrao_codigo
         AND ld.data = l.data
         AND ld.debito = l.debito
         AND ld.credito = l.credito;
    END IF;
  END LOOP;
END;
$do$;