-- (1) Lançamentos com IND_LCTO = E (transferência de resultado) saem
-- TOTALMENTE do diário materializado. Antes só saía quando a conta era
-- de resultado; agora qualquer partida de um lote 'E' fica de fora
-- (saldo, drill-down e demonstrações não leem mais nada dessas linhas).
CREATE OR REPLACE FUNCTION public.ecd_materializar_lote(_importacao_id uuid, _depois bigint DEFAULT 0, _limite integer DEFAULT 2000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
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
    -- Histórico ausente fica NULO (antes virava string vazia e a tela
    -- mostrava célula em branco sem explicar por quê).
    -- Partidas de transferência de resultado (lote I200 com IND_LCTO = E)
    -- não entram mais em hipótese alguma.
    SELECT _tenant, _company, _upload, d.conta_padrao_codigo, l.data, l.competencia,
           nullif(btrim(l.historico), ''), l.debito, l.credito, l.numero
      FROM lote l
      JOIN public.depara_contas d
        ON d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_codigo = l.codigo
       AND d.conta_padrao_codigo IS NOT NULL
       AND NOT COALESCE(d.ignorada, false)
     WHERE NOT COALESCE(l.encerramento, false)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM gravadas), (SELECT max(seq) FROM lote)
    INTO _n, _ultimo;

  RETURN jsonb_build_object(
    'gravadas', COALESCE(_n, 0),
    'ultimo_seq', COALESCE(_ultimo, _depois),
    'upload_id', _upload);
END;
$function$;

-- (2) Contas de cliente/fornecedor da própria empresa: cada conta de
-- detalhe pendurada em um grupo chamado Clientes ou Fornecedores vira
-- uma linha participante no plano da empresa (só dela), com o nome
-- "<último segmento> <NOME>" — ex.: "05567 Mercado Mergen Ltda Me" —
-- para o drill-down abrir cliente a cliente igual às empresas do
-- plano padrão.
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
           split_part(p.codigo, '.') || ' ' || initcap(lower(p.descricao)) AS descricao,
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

-- (3) O preparar agora também cria as contas participantes (idempotente).
CREATE OR REPLACE FUNCTION public.ecd_aplicar_preparar(
  _importacao_id uuid,
  _forcar boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  _tenant uuid; _company uuid; _primeiro date;
  _sem_vinculo int; _apagadas int := 0; _meses_do_diario int := 0;
  _tem_lcto boolean := false; _meses date[];
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  PERFORM public.ecd_marcar_encerramento(_importacao_id);
  PERFORM public.ecd_criar_participantes(_importacao_id);

  SELECT count(DISTINCT s.codigo) INTO _sem_vinculo
    FROM public.ecd_saldo s
    LEFT JOIN public.depara_contas d
           ON d.tenant_id = _tenant AND d.company_id = _company AND d.conta_codigo = s.codigo
   WHERE s.importacao_id = _importacao_id
     AND (s.debitos <> 0 OR s.creditos <> 0 OR s.saldo_final <> 0)
     AND d.conta_padrao_codigo IS NULL
     AND NOT COALESCE(d.ignorada, false);

  IF _sem_vinculo > 0 AND NOT _forcar THEN
    RETURN jsonb_build_object('ok', false, 'contas_sem_vinculo', _sem_vinculo);
  END IF;

  SELECT min(competencia) INTO _primeiro
    FROM public.ecd_saldo WHERE importacao_id = _importacao_id;

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

  SELECT array_agg(DISTINCT competencia ORDER BY competencia) INTO _meses
    FROM public.ecd_saldo WHERE importacao_id = _importacao_id;

  SELECT EXISTS (
    SELECT 1 FROM public.ecd_lancamento WHERE importacao_id = _importacao_id
  ) INTO _tem_lcto;

  RETURN jsonb_build_object('ok', true,
    'contas_sem_vinculo', _sem_vinculo,
    'linhas_removidas', _apagadas,
    'meses_do_diario', _meses_do_diario,
    'competencias', COALESCE(to_jsonb(_meses), '[]'::jsonb),
    'abertura_em', (_primeiro - INTERVAL '1 day')::date,
    'tem_lancamentos', _tem_lcto);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ecd_aplicar_preparar(uuid, boolean) TO authenticated, service_role;