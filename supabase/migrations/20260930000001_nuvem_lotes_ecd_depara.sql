-- ============================================================
-- Timeout da nuvem (~8s), ECD em fatias, participantes no plano próprio
-- ============================================================
--
-- Na API hospedada do Supabase o statement_timeout é curto. DELETE do
-- plano, agregar o diário inteiro, materializar I200/I250 e a fila do
-- de-para caem em: canceling statement due to statement timeout.
-- Cada RPC abaixo faz UM lote (ou UM mês); o cliente repete até zerar.
-- statement_timeout = 60s vale DENTRO da função, acima do teto da API.

ALTER TABLE public.diario_uploads
  ADD COLUMN IF NOT EXISTS competencias_agregadas date[] NOT NULL DEFAULT '{}';

-- ------------------------------------------------------------
-- Apagar plano em fatias (Padrão = company_id NULL).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apagar_lote_plano_contas(
  _tenant_id uuid,
  _company_id uuid,
  _limite int DEFAULT 1500
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
DECLARE
  n int;
BEGIN
  IF _tenant_id IS NULL THEN RAISE EXCEPTION 'tenant obrigatório'; END IF;
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() IS NOT DISTINCT FROM _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF _company_id IS NULL THEN
    IF NOT (
      public.is_orkestria_admin()
      OR public.has_role(auth.uid(), 'tenant_admin')
    ) THEN
      RAISE EXCEPTION 'Sem permissão';
    END IF;
  ELSE
    IF NOT public.pode_acessar_empresa(_company_id) THEN
      RAISE EXCEPTION 'Sem permissão';
    END IF;
    IF (SELECT tenant_id FROM public.companies WHERE id = _company_id) IS DISTINCT FROM _tenant_id THEN
      RAISE EXCEPTION 'Sem permissão';
    END IF;
  END IF;

  WITH doomed AS (
    SELECT id FROM public.plano_contas
     WHERE tenant_id = _tenant_id
       AND company_id IS NOT DISTINCT FROM _company_id
     LIMIT GREATEST(1, LEAST(COALESCE(_limite, 1500), 4000))
  )
  DELETE FROM public.plano_contas p
   USING doomed d
   WHERE p.id = d.id;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.apagar_lote_plano_contas(uuid, uuid, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.apagar_lote_plano_contas(uuid, uuid, int) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Agregar UM mês do upload (idempotente).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agregar_saldos_competencia(
  _upload_id uuid,
  _competencia date
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
DECLARE
  _company uuid;
  _agregado boolean;
  _ja date[];
  n int;
BEGIN
  SELECT company_id, agregado, competencias_agregadas
    INTO _company, _agregado, _ja
    FROM public.diario_uploads
   WHERE id = _upload_id
   FOR UPDATE;
  IF _company IS NULL THEN RAISE EXCEPTION 'Upload não encontrado'; END IF;
  IF NOT public.pode_acessar_empresa(_company) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF _agregado THEN RETURN 0; END IF;
  IF _competencia = ANY(COALESCE(_ja, '{}'::date[])) THEN RETURN 0; END IF;

  INSERT INTO public.saldos_mensais (
    tenant_id, company_id, conta_codigo, competencia, total_debitos, total_creditos
  )
  SELECT tenant_id, company_id, conta_codigo, competencia,
         SUM(debito), SUM(credito)
    FROM public.lancamentos_diario
   WHERE upload_id = _upload_id AND competencia = _competencia
   GROUP BY tenant_id, company_id, conta_codigo, competencia
  ON CONFLICT (company_id, conta_codigo, competencia) DO UPDATE
    SET total_debitos = public.saldos_mensais.total_debitos + EXCLUDED.total_debitos,
        total_creditos = public.saldos_mensais.total_creditos + EXCLUDED.total_creditos,
        updated_at = now();

  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE public.diario_uploads
     SET competencias_agregadas = COALESCE(competencias_agregadas, '{}'::date[]) || _competencia
   WHERE id = _upload_id;

  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.agregar_saldos_competencia(uuid, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.agregar_saldos_competencia(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fechar_upload_diario(_upload_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
DECLARE
  _company uuid; _tenant uuid;
  _lancamentos int; _esperados int; _desconhecidas int;
  _comps_arq int; _comps_ok int;
BEGIN
  SELECT u.company_id, u.tenant_id, u.total_lancamentos
    INTO _company, _tenant, _esperados
    FROM public.diario_uploads u WHERE u.id = _upload_id;
  IF _company IS NULL THEN RAISE EXCEPTION 'Upload não encontrado'; END IF;
  IF NOT public.pode_acessar_empresa(_company) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT count(*) INTO _lancamentos
    FROM public.lancamentos_diario l WHERE l.upload_id = _upload_id;

  IF _esperados IS NOT NULL AND _lancamentos <> _esperados THEN
    UPDATE public.diario_uploads
       SET status = 'error',
           erro_detalhe = format(
             'Carga incompleta: %s de %s lançamentos gravados. Exclua este upload e envie o arquivo de novo.',
             _lancamentos, _esperados)
     WHERE id = _upload_id;
    RETURN jsonb_build_object('ok', false, 'gravados', _lancamentos, 'esperados', _esperados);
  END IF;

  SELECT count(DISTINCT competencia) INTO _comps_arq
    FROM public.lancamentos_diario WHERE upload_id = _upload_id;
  SELECT COALESCE(cardinality(competencias_agregadas), 0) INTO _comps_ok
    FROM public.diario_uploads WHERE id = _upload_id;

  IF _comps_arq > 0 AND _comps_ok < _comps_arq THEN
    RAISE EXCEPTION
      'Agregação incompleta: % de % competências. Recarregue o fechamento.',
      _comps_ok, _comps_arq;
  END IF;

  SELECT count(DISTINCT l.conta_codigo) INTO _desconhecidas
    FROM public.lancamentos_diario l
   WHERE l.upload_id = _upload_id
     AND NOT EXISTS (
       SELECT 1 FROM public.plano_contas p
        WHERE p.tenant_id = _tenant
          AND p.codigo = l.conta_codigo
          AND (p.company_id IS NULL OR p.company_id = _company));

  UPDATE public.diario_uploads
     SET status = 'done',
         agregado = true,
         contas_desconhecidas = _desconhecidas,
         erro_detalhe = NULL
   WHERE id = _upload_id;

  RETURN jsonb_build_object(
    'ok', true, 'gravados', _lancamentos, 'contas_desconhecidas', _desconhecidas);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fechar_upload_diario(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fechar_upload_diario(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.competencias_do_upload(_upload_id uuid)
RETURNS date[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _company uuid;
  _out date[];
BEGIN
  SELECT company_id INTO _company FROM public.diario_uploads WHERE id = _upload_id;
  IF _company IS NULL THEN RETURN '{}'::date[]; END IF;
  IF NOT public.pode_acessar_empresa(_company) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  SELECT COALESCE(array_agg(d ORDER BY d), '{}'::date[])
    INTO _out
    FROM (
      SELECT DISTINCT competencia AS d
        FROM public.lancamentos_diario
       WHERE upload_id = _upload_id
    ) x;
  RETURN _out;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.competencias_do_upload(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.competencias_do_upload(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reverter_saldos_competencia(
  _upload_id uuid,
  _competencia date
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
DECLARE
  _company uuid;
  n int := 0;
BEGIN
  SELECT company_id INTO _company FROM public.diario_uploads WHERE id = _upload_id FOR UPDATE;
  IF _company IS NULL THEN RETURN 0; END IF;
  IF NOT public.pode_acessar_empresa(_company) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  WITH agg AS (
    SELECT conta_codigo, SUM(debito) d, SUM(credito) c
      FROM public.lancamentos_diario
     WHERE upload_id = _upload_id AND competencia = _competencia
     GROUP BY conta_codigo
  )
  UPDATE public.saldos_mensais s
     SET total_debitos = s.total_debitos - agg.d,
         total_creditos = s.total_creditos - agg.c,
         updated_at = now()
    FROM agg
   WHERE s.company_id = _company
     AND s.conta_codigo = agg.conta_codigo
     AND s.competencia = _competencia;

  GET DIAGNOSTICS n = ROW_COUNT;

  DELETE FROM public.saldos_mensais
   WHERE company_id = _company
     AND competencia = _competencia
     AND total_debitos = 0 AND total_creditos = 0;

  UPDATE public.diario_uploads
     SET competencias_agregadas = array_remove(competencias_agregadas, _competencia),
         agregado = false
   WHERE id = _upload_id;

  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.reverter_saldos_competencia(uuid, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.reverter_saldos_competencia(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apagar_lote_lancamentos(
  _upload_id uuid,
  _limite int DEFAULT 2000
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
DECLARE
  _company uuid;
  n int;
BEGIN
  SELECT company_id INTO _company FROM public.diario_uploads WHERE id = _upload_id;
  IF _company IS NULL THEN RETURN 0; END IF;
  IF NOT public.pode_acessar_empresa(_company) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  WITH doomed AS (
    SELECT id FROM public.lancamentos_diario
     WHERE upload_id = _upload_id
     LIMIT GREATEST(1, LEAST(COALESCE(_limite, 2000), 5000))
  )
  DELETE FROM public.lancamentos_diario l
   USING doomed d
   WHERE l.id = d.id;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.apagar_lote_lancamentos(uuid, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.apagar_lote_lancamentos(uuid, int) TO authenticated, service_role;

-- ------------------------------------------------------------
-- ECD: aplicar = saldos; o diário entra em lotes no cliente.
-- ------------------------------------------------------------
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

  WITH tradu AS (
    SELECT d.conta_padrao_codigo AS codigo, s.competencia,
           sum(s.debitos) AS deb, sum(s.creditos) AS cred
      FROM public.ecd_saldo s
      JOIN public.depara_contas d
        ON d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_codigo = s.codigo AND d.conta_padrao_codigo IS NOT NULL
       AND NOT COALESCE(d.ignorada, false)
     WHERE s.importacao_id = _importacao_id
     GROUP BY 1, 2
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

CREATE OR REPLACE FUNCTION public.ecd_preparar_diario(_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
DECLARE
  _tenant uuid; _company uuid; _arquivo text; _upload uuid;
BEGIN
  SELECT i.tenant_id, i.company_id, i.arquivo_nome
    INTO _tenant, _company, _arquivo
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ecd_lancamento WHERE importacao_id = _importacao_id) THEN
    RETURN jsonb_build_object('tem_lancamentos', false, 'upload_id', NULL);
  END IF;

  SELECT id INTO _upload FROM public.diario_uploads
   WHERE company_id = _company AND filename = 'ECD: ' || _arquivo
   LIMIT 1;

  IF _upload IS NULL THEN
    INSERT INTO public.diario_uploads
      (tenant_id, company_id, filename, status, total_lancamentos, agregado)
    VALUES (_tenant, _company, 'ECD: ' || _arquivo, 'processing', 0, true)
    RETURNING id INTO _upload;
  ELSE
    UPDATE public.diario_uploads
       SET agregado = true, status = 'processing', updated_at = now()
     WHERE id = _upload;
  END IF;

  RETURN jsonb_build_object('tem_lancamentos', true, 'upload_id', _upload);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_preparar_diario(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_preparar_diario(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ecd_upload_do_ecd(_importacao_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _company uuid; _arquivo text; _upload uuid;
BEGIN
  SELECT i.company_id, i.arquivo_nome INTO _company, _arquivo
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _company IS NULL THEN RETURN NULL; END IF;
  IF NOT public.pode_acessar_empresa(_company) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT id INTO _upload FROM public.diario_uploads
   WHERE company_id = _company AND filename = 'ECD: ' || _arquivo
   LIMIT 1;
  RETURN _upload;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_upload_do_ecd(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_upload_do_ecd(uuid) TO authenticated, service_role;

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
    SELECT l.seq, l.numero, l.data, l.competencia, l.codigo, l.debito, l.credito, l.historico
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

CREATE OR REPLACE FUNCTION public.ecd_fechar_aplicacao(
  _importacao_id uuid,
  _lancamentos int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
DECLARE
  _company uuid; _arquivo text; _upload uuid; _n int := 0;
BEGIN
  SELECT i.company_id, i.arquivo_nome INTO _company, _arquivo
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _company IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(
       (SELECT tenant_id FROM public.ecd_importacao WHERE id = _importacao_id)
     ) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT id INTO _upload FROM public.diario_uploads
   WHERE company_id = _company AND filename = 'ECD: ' || _arquivo
   LIMIT 1;

  IF _upload IS NOT NULL THEN
    SELECT count(*) INTO _n FROM public.lancamentos_diario WHERE upload_id = _upload;
    UPDATE public.diario_uploads
       SET total_lancamentos = _n, agregado = true, status = 'done', updated_at = now()
     WHERE id = _upload;
  END IF;

  UPDATE public.ecd_importacao
     SET status = 'aplicado', aplicado_em = now(),
         resumo = COALESCE(resumo, '{}'::jsonb) || jsonb_build_object(
           'lancamentos', COALESCE(_lancamentos, _n, 0))
   WHERE id = _importacao_id;

  RETURN jsonb_build_object('ok', true, 'lancamentos', COALESCE(_lancamentos, _n, 0),
                            'upload_id', _upload);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_fechar_aplicacao(uuid, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_fechar_aplicacao(uuid, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ecd_materializar_lancamentos(_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
DECLARE
  _prep jsonb; _lote jsonb; _depois bigint := 0; _n int := 0; _upload uuid;
BEGIN
  _prep := public.ecd_preparar_diario(_importacao_id);
  IF NOT COALESCE((_prep->>'tem_lancamentos')::boolean, false) THEN
    RETURN jsonb_build_object('lancamentos', 0, 'nota', 'este ECD não trouxe I200/I250');
  END IF;
  _upload := (_prep->>'upload_id')::uuid;

  DELETE FROM public.lancamentos_diario WHERE upload_id = _upload;

  LOOP
    _lote := public.ecd_materializar_lote(_importacao_id, _depois, 2000);
    _n := _n + COALESCE((_lote->>'gravadas')::int, 0);
    EXIT WHEN COALESCE((_lote->>'ultimo_seq')::bigint, _depois) <= _depois;
    _depois := (_lote->>'ultimo_seq')::bigint;
  END LOOP;

  UPDATE public.diario_uploads
     SET total_lancamentos = _n, agregado = true, status = 'done', updated_at = now()
   WHERE id = _upload;

  RETURN jsonb_build_object('lancamentos', _n, 'upload_id', _upload);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_materializar_lancamentos(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_materializar_lancamentos(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ecd_desfazer(_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
DECLARE _tenant uuid; _company uuid; _arquivo text; _de date; _ate date;
        _n int; _na int; _nl int := 0;
BEGIN
  SELECT i.tenant_id, i.company_id, i.arquivo_nome INTO _tenant, _company, _arquivo
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT min(competencia), max(competencia) INTO _de, _ate
    FROM public.ecd_saldo WHERE importacao_id = _importacao_id;

  WITH d AS (
    DELETE FROM public.saldos_mensais m WHERE m.origem_ecd = _importacao_id RETURNING 1
  ) SELECT count(*) INTO _n FROM d;

  WITH d AS (
    DELETE FROM public.saldos_abertura a WHERE a.origem_ecd = _importacao_id RETURNING 1
  ) SELECT count(*) INTO _na FROM d;

  WITH d AS (
    DELETE FROM public.lancamentos_diario l
     USING public.diario_uploads u
     WHERE u.id = l.upload_id
       AND u.company_id = _company
       AND u.filename = 'ECD: ' || _arquivo
    RETURNING 1
  ) SELECT count(*) INTO _nl FROM d;
  DELETE FROM public.diario_uploads
   WHERE company_id = _company AND filename = 'ECD: ' || _arquivo;

  UPDATE public.ecd_importacao SET status = 'importado', aplicado_em = NULL
   WHERE id = _importacao_id;

  RETURN jsonb_build_object('ok', true, 'saldos_removidos', _n,
                            'aberturas_removidas', _na,
                            'lancamentos_removidos', _nl, 'de', _de, 'ate', _ate);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_desfazer(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_desfazer(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Plano de terceiros: cliente/fornecedor não entra na fila do de-para.
-- Ativo/Passivo analítico com ≥ 20 irmãos no mesmo prefixo = participante.
-- Destino AGG-* também marca.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marcar_participantes_origem(_company_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $fn$
DECLARE _n int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  WITH base AS (
    SELECT p.id,
           regexp_replace(
             coalesce(nullif(btrim(p.classificacao), ''), p.codigo),
             '[.\-/][^.\-/]+$', '') AS pai
      FROM public.plano_contas p
     WHERE p.company_id = _company_id
       AND coalesce(p.is_sintetica, false) = false
       AND left(coalesce(nullif(btrim(p.tipo), ''), p.classificacao, p.codigo), 1) IN ('1', '2')
  ),
  irmaos AS (
    SELECT b.id, b.pai
      FROM base b
     WHERE b.pai IS NOT NULL AND b.pai <> ''
       AND EXISTS (
         SELECT 1 FROM public.plano_contas p WHERE p.id = b.id
          AND regexp_replace(
                coalesce(nullif(btrim(p.classificacao), ''), p.codigo),
                '[.\-/][^.\-/]+$', '')
              IS DISTINCT FROM coalesce(nullif(btrim(p.classificacao), ''), p.codigo)
       )
  ),
  pais AS (
    SELECT pai FROM irmaos GROUP BY pai HAVING count(*) >= 20
  )
  UPDATE public.plano_contas p
     SET is_participante = true
    FROM irmaos i
    JOIN pais x ON x.pai = i.pai
   WHERE p.id = i.id
     AND coalesce(p.is_participante, false) = false;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.marcar_participantes_origem(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.marcar_participantes_origem(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.depara_carregar_origem(_company_id uuid, _contas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
DECLARE
  _tenant uuid;
  _n int := 0;
  _part int := 0;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para configurar o de-para desta empresa';
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada';
  END IF;
  IF _contas IS NULL OR jsonb_typeof(_contas) <> 'array' THEN
    RETURN jsonb_build_object('gravadas', 0, 'participantes', 0);
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

  _part := public.marcar_participantes_origem(_company_id);

  RETURN jsonb_build_object('gravadas', _n, 'participantes', _part);
END;
$$;

REVOKE ALL ON FUNCTION public.depara_carregar_origem(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.depara_carregar_origem(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.aplicar_depara_em_lote(_company_id uuid, _itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
DECLARE
  _tenant uuid;
  _n int := 0;
  _apagadas int := 0;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para configurar o de-para desta empresa';
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada';
  END IF;

  CREATE TEMP TABLE _entrada ON COMMIT DROP AS
  SELECT DISTINCT ON (x.conta_codigo) x.*
    FROM jsonb_to_recordset(_itens) AS x(
      conta_codigo text,
      conta_padrao_codigo text,
      ignorada boolean,
      observacao text
    )
   WHERE x.conta_codigo IS NOT NULL
   ORDER BY x.conta_codigo;

  DELETE FROM public.depara_contas d
   USING _entrada e
   WHERE d.company_id = _company_id
     AND d.conta_codigo = e.conta_codigo
     AND e.conta_padrao_codigo IS NULL
     AND COALESCE(e.ignorada, false) = false;
  GET DIAGNOSTICS _apagadas = ROW_COUNT;

  WITH gravadas AS (
    INSERT INTO public.depara_contas (
      tenant_id, company_id, conta_codigo, conta_padrao_codigo, ignorada, observacao
    )
    SELECT _tenant, _company_id, e.conta_codigo, e.conta_padrao_codigo,
           COALESCE(e.ignorada,false), e.observacao
      FROM _entrada e
     WHERE e.conta_padrao_codigo IS NOT NULL OR COALESCE(e.ignorada,false) = true
    ON CONFLICT (company_id, conta_codigo) DO UPDATE SET
      conta_padrao_codigo = EXCLUDED.conta_padrao_codigo,
      ignorada            = EXCLUDED.ignorada,
      observacao          = EXCLUDED.observacao,
      updated_at          = now()
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM gravadas;

  UPDATE public.plano_contas p
     SET is_participante = true
    FROM _entrada e
   WHERE p.company_id = _company_id
     AND p.codigo = e.conta_codigo
     AND e.conta_padrao_codigo LIKE 'AGG-%'
     AND coalesce(p.is_participante, false) = false;

  DROP TABLE IF EXISTS _entrada;
  RETURN jsonb_build_object('gravadas', _n, 'limpas', _apagadas);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.aplicar_depara_em_lote(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.aplicar_depara_em_lote(uuid, jsonb) TO authenticated, service_role;

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
SET statement_timeout = '60s'
AS $$
DECLARE
  _tenant uuid;
  _tem_saldo boolean;
BEGIN
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
    LEFT JOIN public.plano_contas p
      ON p.tenant_id = _tenant AND p.company_id = _company_id AND p.codigo = s.conta_codigo
   WHERE s.company_id = _company_id
     AND coalesce(p.is_participante, false) = false
   GROUP BY s.conta_codigo
  ON CONFLICT DO NOTHING;

  INSERT INTO _depara_fila_mov
  SELECT sa.conta_codigo, sum(sa.saldo)::numeric
    FROM public.saldos_abertura sa
    LEFT JOIN public.plano_contas p
      ON p.tenant_id = _tenant AND p.company_id = _company_id AND p.codigo = sa.conta_codigo
   WHERE sa.company_id = _company_id
     AND coalesce(p.is_participante, false) = false
   GROUP BY sa.conta_codigo
  ON CONFLICT DO NOTHING;

  IF NOT _tem_saldo THEN
    INSERT INTO _depara_fila_mov
    SELECT l.conta_codigo, (sum(l.debito) - sum(l.credito))::numeric
      FROM public.lancamentos_diario l
      LEFT JOIN public.plano_contas p
        ON p.tenant_id = _tenant AND p.company_id = _company_id AND p.codigo = l.conta_codigo
     WHERE l.company_id = _company_id
       AND coalesce(p.is_participante, false) = false
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
SET statement_timeout = '60s'
AS $fn$
DECLARE
  _tenant uuid;
  _tem_saldo boolean;
BEGIN
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

-- Destino agregadora já gravado = participante.
UPDATE public.plano_contas p
   SET is_participante = true
  FROM public.depara_contas d
 WHERE p.company_id = d.company_id
   AND p.codigo = d.conta_codigo
   AND p.company_id IS NOT NULL
   AND d.conta_padrao_codigo LIKE 'AGG-%'
   AND coalesce(p.is_participante, false) = false;

DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT company_id AS id
      FROM public.plano_contas
     WHERE company_id IS NOT NULL
  LOOP
    PERFORM public.marcar_participantes_origem(r.id);
  END LOOP;
END;
$do$;

-- Funções pesadas que já existiam: sobem o teto sem reescrever o corpo.
ALTER FUNCTION public.dfc_exportar(uuid, uuid, boolean) SET statement_timeout = '60s';
ALTER FUNCTION public.dfc_exportar_contas(uuid, uuid, integer) SET statement_timeout = '60s';
ALTER FUNCTION public.dfc_efetivo(uuid, uuid, boolean) SET statement_timeout = '60s';
ALTER FUNCTION public.dfc_efetivo_escopo(uuid, uuid, uuid, boolean) SET statement_timeout = '60s';
ALTER FUNCTION public.dfc_importar_vinculos(uuid, jsonb, uuid, boolean) SET statement_timeout = '60s';
ALTER FUNCTION public.ecd_importar(uuid, text, jsonb, jsonb, jsonb) SET statement_timeout = '60s';
ALTER FUNCTION public.ecd_gravar_lancamentos(uuid, jsonb, boolean) SET statement_timeout = '60s';
ALTER FUNCTION public.ecd_classificar(uuid) SET statement_timeout = '60s';
ALTER FUNCTION public.ecd_conferencia(uuid) SET statement_timeout = '60s';
ALTER FUNCTION public.finalizar_upload_diario(uuid) SET statement_timeout = '60s';
ALTER FUNCTION public.reverter_upload_diario(uuid) SET statement_timeout = '60s';
ALTER FUNCTION public.agregar_saldos_mensais(uuid) SET statement_timeout = '60s';
ALTER FUNCTION public.revincular_dfc(uuid, uuid, boolean) SET statement_timeout = '60s';

NOTIFY pgrst, 'reload schema';
