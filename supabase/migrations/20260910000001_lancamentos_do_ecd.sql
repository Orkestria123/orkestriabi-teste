-- ============================================================
-- AJUSTE 37 — o diário do ECD (I200/I250)
-- ============================================================
--
-- "não abre o drill down do dre" / "drill down no dfc também não funciona"
--
-- A causa é a mesma dos dois, e é simples de ver depois de achada:
--
--     drilldown_contas() → com_mov AS (
--       SELECT conta_codigo FROM lancamentos_diario ...
--       UNION SELECT conta_codigo FROM saldos_abertura ...)
--
-- O drill-down parte das contas que TÊM LANÇAMENTO. E o ECD nunca
-- escreveu lançamento nenhum: ele gravava saldo mensal agregado. Para um
-- período vindo de ECD, `com_mov` só tem as contas de abertura — e conta
-- de resultado não tem abertura. Zero contas → a gaveta não abre.
--
-- Dava para remendar (somar `saldos_mensais` ao `com_mov`, e isso está
-- feito no fim como rede de segurança). Mas o ECD TRAZ o lançamento: os
-- registros I200 (cabeçalho) e I250 (partidas) são o diário inteiro, com
-- data, valor, lado e HISTÓRICO. Eu só não estava lendo.
--
-- Lendo, três coisas se resolvem de uma vez:
--
--   1. o drill-down abre, com o lançamento de verdade;
--   2. o encerramento do exercício passa a ser identificável — o motor
--      já procura "Transferido Para Conta ... Resultado" no histórico, e
--      agora existe histórico para procurar. Era o número de dezembro
--      que você viu errado;
--   3. dá para conferir partida dobrada do que entrou.

-- ------------------------------------------------------------
-- 1) O diário como o ECD conta
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ecd_lancamento (
  importacao_id uuid NOT NULL REFERENCES public.ecd_importacao(id) ON DELETE CASCADE,
  seq           bigserial,
  numero        text,
  data          date NOT NULL,
  competencia   date NOT NULL,
  codigo        text NOT NULL,
  debito        numeric(18,2) NOT NULL DEFAULT 0,
  credito       numeric(18,2) NOT NULL DEFAULT 0,
  historico     text,
  PRIMARY KEY (importacao_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_ecd_lancamento_conta
  ON public.ecd_lancamento (importacao_id, codigo, competencia);
CREATE INDEX IF NOT EXISTS idx_ecd_lancamento_comp
  ON public.ecd_lancamento (importacao_id, competencia);

ALTER TABLE public.ecd_lancamento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ecd_lancamento tenant" ON public.ecd_lancamento;
CREATE POLICY "ecd_lancamento tenant" ON public.ecd_lancamento
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ecd_importacao i
                  WHERE i.id = importacao_id AND public.pode_gerenciar_tenant(i.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ecd_importacao i
                  WHERE i.id = importacao_id AND public.pode_gerenciar_tenant(i.tenant_id)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ecd_lancamento TO authenticated;
GRANT ALL ON public.ecd_lancamento TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ecd_lancamento_seq_seq TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2) Gravar o que o parser leu
-- ------------------------------------------------------------
-- Em blocos, porque um ECD de empresa média tem dezenas de milhares de
-- partidas e mandar tudo num payload só é pedir timeout. Quem chama
-- fatia; esta função é idempotente por bloco.
CREATE OR REPLACE FUNCTION public.ecd_gravar_lancamentos(
  _importacao_id uuid,
  _linhas jsonb,
  _primeiro_bloco boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _n int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ecd_importacao i
     WHERE i.id = _importacao_id AND public.pode_acessar_empresa(i.company_id)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para esta importação';
  END IF;

  -- O primeiro bloco limpa: reimportar o mesmo arquivo não pode somar o
  -- diário duas vezes.
  IF _primeiro_bloco THEN
    DELETE FROM public.ecd_lancamento WHERE importacao_id = _importacao_id;
  END IF;

  WITH gravadas AS (
    INSERT INTO public.ecd_lancamento
      (importacao_id, numero, data, competencia, codigo, debito, credito, historico)
    SELECT _importacao_id, x.numero, x.data::date,
           date_trunc('month', x.data::date)::date,
           x.codigo, COALESCE(x.debito, 0), COALESCE(x.credito, 0),
           nullif(btrim(x.historico), '')
      FROM jsonb_to_recordset(_linhas) AS x(
        numero text, data text, codigo text,
        debito numeric, credito numeric, historico text)
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

-- ------------------------------------------------------------
-- 3) Aplicar: o lançamento também entra
-- ------------------------------------------------------------
-- Entra em `lancamentos_diario`, sob um upload PRÓPRIO do ECD, com
-- `agregado = true`. O `agregado` é o que impede a agregação de somar
-- este movimento de novo em `saldos_mensais` — o `ecd_aplicar` já
-- escreve o saldo direto, e somar duas vezes dobraria tudo.
--
-- Reaproveitar `lancamentos_diario` em vez de inventar um caminho novo é
-- o ponto: drill-down, correção de encerramento e busca por histórico
-- passam a funcionar sem que nenhum deles saiba que o dado veio de ECD.
CREATE OR REPLACE FUNCTION public.ecd_materializar_lancamentos(_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _company uuid; _arquivo text; _upload uuid; _n int := 0;
BEGIN
  SELECT i.tenant_id, i.company_id, i.arquivo_nome
    INTO _tenant, _company, _arquivo
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ecd_lancamento WHERE importacao_id = _importacao_id) THEN
    RETURN jsonb_build_object('lancamentos', 0, 'nota', 'este ECD não trouxe I200/I250');
  END IF;

  -- Um upload por importação, reaproveitado nas reaplicações.
  SELECT id INTO _upload FROM public.diario_uploads
   WHERE company_id = _company AND filename = 'ECD: ' || _arquivo
   LIMIT 1;

  IF _upload IS NULL THEN
    INSERT INTO public.diario_uploads
      (tenant_id, company_id, filename, status, total_lancamentos, agregado)
    VALUES (_tenant, _company, 'ECD: ' || _arquivo, 'done', 0, true)
    RETURNING id INTO _upload;
  END IF;

  DELETE FROM public.lancamentos_diario WHERE upload_id = _upload;

  WITH gravadas AS (
    INSERT INTO public.lancamentos_diario
      (tenant_id, company_id, upload_id, conta_codigo, data, competencia,
       historico, debito, credito, numero_lancamento)
    SELECT _tenant, _company, _upload, d.conta_padrao_codigo, l.data, l.competencia,
           COALESCE(l.historico, ''), l.debito, l.credito, l.numero
      FROM public.ecd_lancamento l
      JOIN public.depara_contas d
        ON d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_codigo = l.codigo
       AND d.conta_padrao_codigo IS NOT NULL
       AND NOT COALESCE(d.ignorada, false)
     WHERE l.importacao_id = _importacao_id
    RETURNING 1
  ) SELECT count(*) INTO _n FROM gravadas;

  UPDATE public.diario_uploads
     SET total_lancamentos = _n, agregado = true, updated_at = now()
   WHERE id = _upload;

  RETURN jsonb_build_object('lancamentos', _n, 'upload_id', _upload);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_materializar_lancamentos(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_materializar_lancamentos(uuid) TO authenticated, service_role;

-- `ecd_aplicar` chama a materialização no fim. O resto da função é o do
-- ajuste 35, sem uma vírgula de diferença — só o bloco novo antes do
-- RETURN.
CREATE OR REPLACE FUNCTION public.ecd_aplicar(
  _importacao_id uuid,
  _substituir boolean DEFAULT false,
  _forcar boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _company uuid; _primeiro date;
  _sem_vinculo int; _linhas int := 0; _abert int := 0;
  _apagadas int := 0; _meses_do_diario int := 0; _data_abert date;
  _lctos jsonb;
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

  -- NOVO: o diário do ECD entra também. É o que faz o drill-down abrir e
  -- o que dá ao motor o histórico para reconhecer o encerramento.
  _lctos := public.ecd_materializar_lancamentos(_importacao_id);

  UPDATE public.ecd_importacao
     SET status = 'aplicado', aplicado_em = now(),
         resumo = resumo || jsonb_build_object(
           'linhas_saldos', _linhas, 'linhas_abertura', _abert,
           'lancamentos', COALESCE((_lctos->>'lancamentos')::int, 0),
           'contas_sem_vinculo', _sem_vinculo)
   WHERE id = _importacao_id;

  RETURN jsonb_build_object('ok', true,
    'linhas_saldos', _linhas, 'linhas_abertura', _abert,
    'linhas_removidas', _apagadas,
    'lancamentos', COALESCE((_lctos->>'lancamentos')::int, 0),
    'meses_do_diario', _meses_do_diario,
    'abertura_em', _data_abert,
    'contas_sem_vinculo', _sem_vinculo,
    'conferencia', public.ecd_conferencia(_importacao_id));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_aplicar(uuid, boolean, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_aplicar(uuid, boolean, boolean) TO authenticated, service_role;

-- Desfazer leva o upload do ECD junto — e só ele.
CREATE OR REPLACE FUNCTION public.ecd_desfazer(_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
-- 4) O drill-down também olha o saldo mensal
-- ------------------------------------------------------------
-- Rede de segurança: mesmo um ECD importado ANTES deste ajuste (sem
-- I200/I250 lidos) passa a abrir a gaveta — as contas aparecem, com os
-- totais do mês, ainda que sem o lançamento linha a linha.
CREATE OR REPLACE FUNCTION public.drilldown_contas(
  _company_id uuid,
  _classificacao text,
  _competencia_min date DEFAULT NULL,
  _competencia_max date DEFAULT NULL
)
RETURNS TABLE (codigo text, descricao text, classificacao text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _scope uuid; _usa_padrao boolean; _usa_depara boolean; _esc jsonb;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  _esc := public.escopo_plano_empresa(_company_id);
  _tenant := (_esc->>'tenant_id')::uuid;
  _usa_padrao := COALESCE((_esc->>'usa_plano_padrao')::boolean, false);
  _usa_depara := COALESCE((_esc->>'usa_depara')::boolean, false);
  IF _tenant IS NULL THEN RETURN; END IF;
  _scope := CASE WHEN _usa_padrao THEN NULL ELSE _company_id END;

  IF NOT _usa_depara THEN
    RETURN QUERY
    WITH com_mov AS (
      SELECT DISTINCT l.conta_codigo FROM public.lancamentos_diario l
       WHERE l.company_id = _company_id
         AND (_competencia_min IS NULL OR l.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR l.competencia <= _competencia_max)
      UNION
      SELECT DISTINCT sa.conta_codigo FROM public.saldos_abertura sa
       WHERE sa.company_id = _company_id
      UNION
      -- O ramo que faltava: período vindo de ECD tem saldo mensal e podia
      -- não ter lançamento. Sem isto a gaveta não abria.
      SELECT DISTINCT sm.conta_codigo FROM public.saldos_mensais sm
       WHERE sm.company_id = _company_id
         AND (_competencia_min IS NULL OR sm.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR sm.competencia <= _competencia_max)
    )
    SELECT p.codigo, p.descricao, p.classificacao
      FROM com_mov m
      JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _scope
       AND p.codigo = m.conta_codigo
     WHERE p.is_sintetica = false
       AND (p.classificacao = _classificacao
            OR left(p.classificacao, length(_classificacao) + 1) = _classificacao || '.')
     ORDER BY p.classificacao, p.codigo;
  ELSE
    RETURN QUERY
    WITH com_mov AS (
      SELECT DISTINCT l.conta_codigo FROM public.lancamentos_diario l
       WHERE l.company_id = _company_id
         AND (_competencia_min IS NULL OR l.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR l.competencia <= _competencia_max)
      UNION
      SELECT DISTINCT sa.conta_codigo FROM public.saldos_abertura sa
       WHERE sa.company_id = _company_id
      UNION
      SELECT DISTINCT sm.conta_codigo FROM public.saldos_mensais sm
       WHERE sm.company_id = _company_id
         AND (_competencia_min IS NULL OR sm.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR sm.competencia <= _competencia_max)
    ),
    trad AS (
      SELECT t.conta_codigo, t.conta_padrao_codigo
        FROM public.depara_traducao(_company_id) t
       WHERE NOT t.ignorada AND t.conta_padrao_codigo IS NOT NULL
    )
    SELECT m.conta_codigo, COALESCE(o.descricao, p.descricao), p.classificacao
      FROM com_mov m
      JOIN trad tr ON tr.conta_codigo = m.conta_codigo
      JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _scope
       AND p.codigo = tr.conta_padrao_codigo
      LEFT JOIN public.plano_contas o
        ON o.tenant_id = _tenant AND o.company_id = _company_id
       AND o.codigo = m.conta_codigo
     WHERE p.is_sintetica = false
       AND (p.classificacao = _classificacao
            OR left(p.classificacao, length(_classificacao) + 1) = _classificacao || '.')
     ORDER BY p.classificacao, m.conta_codigo;
  END IF;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.drilldown_contas(uuid, text, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.drilldown_contas(uuid, text, date, date)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5) O encerramento, agora pelo histórico
-- ------------------------------------------------------------
-- Com o I250 lido, a detecção deixa de ser heurística de saldo e passa a
-- ser o que o próprio lançamento diz. E o motor de demonstrações começa
-- a corrigir dezembro sozinho, porque ele já procura esse texto — só não
-- tinha onde procurar.
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
       AND left(COALESCE(nullif(c.classificacao, ''), c.codigo), 1) IN ('3', '4', '5', '6')
  ),
  zeradas AS (
    SELECT competencia,
           count(*) FILTER (WHERE abs(saldo_final) < 0.005
                              AND abs(saldo_inicial) >= 0.005) AS contas_zeradas,
           sum(abs(saldo_inicial)) FILTER (WHERE abs(saldo_final) < 0.005) AS valor
      FROM resultado GROUP BY competencia
  ),
  -- O lançamento que o motor reconhece como encerramento.
  pelo_historico AS (
    SELECT competencia, count(*) AS partidas, sum(debito + credito) AS valor
      FROM public.ecd_lancamento
     WHERE importacao_id = _importacao_id
       AND historico ILIKE '%Transferido Para Conta%Resultado%'
     GROUP BY competencia
  )
  SELECT jsonb_build_object(
    'tem_encerramento', EXISTS (SELECT 1 FROM zeradas WHERE contas_zeradas >= 3),
    -- Quando isto é verdadeiro, o motor CORRIGE sozinho: ele procura esse
    -- histórico e subtrai o encerramento antes de montar a DRE.
    'corrigido_automaticamente', EXISTS (SELECT 1 FROM pelo_historico),
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

NOTIFY pgrst, 'reload schema';
