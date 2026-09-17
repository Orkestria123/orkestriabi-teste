-- ECD aplicada em etapas (uma por mês) e ferramentas de exclusão.
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

CREATE OR REPLACE FUNCTION public.ecd_aplicar_mes(
  _importacao_id uuid,
  _competencia date,
  _substituir boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  _tenant uuid; _company uuid; _linhas int := 0;
  _deb_lcto numeric; _deb_saldo numeric; _usa_diario boolean := false;
  _ocupado boolean := false;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.saldos_mensais m
     WHERE m.company_id = _company AND m.competencia = _competencia
       AND m.origem_ecd IS NULL
  ) INTO _ocupado;
  IF _ocupado AND NOT _substituir THEN
    RETURN jsonb_build_object('linhas', 0, 'pulado', true);
  END IF;

  SELECT sum(l.debito) INTO _deb_lcto FROM public.ecd_lancamento l
   WHERE l.importacao_id = _importacao_id AND l.competencia = _competencia;

  SELECT sum(s.debitos) INTO _deb_saldo
    FROM public.ecd_saldo s
    JOIN public.ecd_conta c
      ON c.importacao_id = s.importacao_id AND c.codigo = s.codigo
   WHERE s.importacao_id = _importacao_id AND s.competencia = _competencia
     AND COALESCE(c.tipo, 'A') <> 'S';

  _usa_diario := COALESCE(_deb_saldo, 0) > 0 AND _deb_lcto IS NOT NULL
    AND abs(_deb_lcto - _deb_saldo) <= _deb_saldo * 0.01;

  WITH lcto AS (
    SELECT l.codigo, sum(l.debito) AS deb, sum(l.credito) AS cred
      FROM public.ecd_lancamento l
     WHERE _usa_diario
       AND l.importacao_id = _importacao_id
       AND l.competencia = _competencia
       AND NOT l.encerramento
     GROUP BY 1
  ),
  bruto AS (
    SELECT d.conta_padrao_codigo AS codigo,
           CASE WHEN _usa_diario AND COALESCE(c.tipo, 'A') <> 'S'
                THEN COALESCE(lc.deb, 0) ELSE x.debito END AS deb,
           CASE WHEN _usa_diario AND COALESCE(c.tipo, 'A') <> 'S'
                THEN COALESCE(lc.cred, 0) ELSE x.credito END AS cred
      FROM public.ecd_saldo s
      JOIN public.ecd_conta c
        ON c.importacao_id = s.importacao_id AND c.codigo = s.codigo
      JOIN public.depara_contas d
        ON d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_codigo = s.codigo AND d.conta_padrao_codigo IS NOT NULL
       AND NOT COALESCE(d.ignorada, false)
      LEFT JOIN lcto lc ON lc.codigo = s.codigo
      CROSS JOIN LATERAL public.ecd_dc_movimento(
        s.saldo_inicial, s.debitos, s.creditos, s.saldo_final,
        public.ecd_conta_resultado(c.classificacao, c.codigo)
          AND COALESCE(c.tipo, 'A') <> 'S',
        (SELECT CASE WHEN ep.papel LIKE 'RECEITA%' OR ep.papel LIKE '%RECEITAS%'
                     THEN 'D' ELSE 'C' END
           FROM public.plano_contas pa
           JOIN public.estrutura_padrao ep
             ON pa.classificacao = ep.classificacao
             OR pa.classificacao LIKE ep.classificacao || '.%'
          WHERE pa.tenant_id = _tenant
            AND pa.codigo = d.conta_padrao_codigo
            AND pa.tipo = '3-DRE'
          ORDER BY length(ep.classificacao) DESC
          LIMIT 1)
      ) x
     WHERE s.importacao_id = _importacao_id AND s.competencia = _competencia
  ),
  tradu AS (
    SELECT codigo, sum(deb) AS deb, sum(cred) AS cred FROM bruto GROUP BY 1
  ),
  gravado AS (
    INSERT INTO public.saldos_mensais
      (tenant_id, company_id, conta_codigo, competencia, total_debitos, total_creditos, origem_ecd)
    SELECT _tenant, _company, t.codigo, _competencia, t.deb, t.cred, _importacao_id FROM tradu t
    ON CONFLICT (company_id, conta_codigo, competencia)
      DO UPDATE SET total_debitos = EXCLUDED.total_debitos,
                    total_creditos = EXCLUDED.total_creditos,
                    origem_ecd = EXCLUDED.origem_ecd,
                    updated_at = now()
    RETURNING 1
  ) SELECT count(*) INTO _linhas FROM gravado;

  RETURN jsonb_build_object('linhas', _linhas, 'pulado', false, 'do_diario', _usa_diario);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ecd_aplicar_mes(uuid, date, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ecd_aplicar_abertura(_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  _tenant uuid; _company uuid; _primeiro date; _data_abert date; _abert int := 0;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT min(competencia) INTO _primeiro
    FROM public.ecd_saldo WHERE importacao_id = _importacao_id;
  IF _primeiro IS NULL THEN
    RETURN jsonb_build_object('linhas_abertura', 0, 'abertura_em', NULL);
  END IF;
  _data_abert := (_primeiro - INTERVAL '1 day')::date;

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

  UPDATE public.ecd_importacao
     SET resumo = COALESCE(resumo, '{}'::jsonb) || jsonb_build_object('linhas_abertura', _abert)
   WHERE id = _importacao_id;

  RETURN jsonb_build_object('linhas_abertura', _abert, 'abertura_em', _data_abert);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ecd_aplicar_abertura(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ecd_apagar_diario_mes(
  _importacao_id uuid,
  _competencia date DEFAULT NULL,
  _limite integer DEFAULT 2000
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  _tenant uuid; _company uuid; _arquivo text; _upload uuid; _n int := 0;
BEGIN
  SELECT i.tenant_id, i.company_id, i.arquivo_nome INTO _tenant, _company, _arquivo
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT id INTO _upload FROM public.diario_uploads
   WHERE company_id = _company AND filename = 'ECD: ' || _arquivo LIMIT 1;
  IF _upload IS NULL THEN RETURN 0; END IF;

  WITH alvo AS (
    SELECT l.id FROM public.lancamentos_diario l
     WHERE l.upload_id = _upload
       AND (_competencia IS NULL OR l.competencia = _competencia)
     LIMIT GREATEST(1, LEAST(COALESCE(_limite, 2000), 5000))
  ), removidas AS (
    DELETE FROM public.lancamentos_diario l
     USING alvo a WHERE l.id = a.id RETURNING 1
  ) SELECT count(*) INTO _n FROM removidas;

  RETURN _n;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ecd_apagar_diario_mes(uuid, date, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ecd_excluir_mes(
  _importacao_id uuid,
  _competencia date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '180s'
AS $function$
DECLARE
  _tenant uuid; _company uuid; _primeiro date;
  _saldos int := 0; _abert int := 0; _lctos int := 0; _linhas_ecd int := 0;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT min(competencia) INTO _primeiro
    FROM public.ecd_saldo WHERE importacao_id = _importacao_id;

  DELETE FROM public.saldos_mensais
   WHERE company_id = _company AND origem_ecd = _importacao_id
     AND competencia = _competencia;
  GET DIAGNOSTICS _saldos = ROW_COUNT;

  IF _competencia = _primeiro THEN
    DELETE FROM public.saldos_abertura
     WHERE company_id = _company AND origem_ecd = _importacao_id;
    GET DIAGNOSTICS _abert = ROW_COUNT;
  END IF;

  DELETE FROM public.ecd_lancamento
   WHERE importacao_id = _importacao_id AND competencia = _competencia;
  GET DIAGNOSTICS _lctos = ROW_COUNT;

  DELETE FROM public.ecd_saldo
   WHERE importacao_id = _importacao_id AND competencia = _competencia;
  GET DIAGNOSTICS _linhas_ecd = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'saldos_removidos', _saldos,
    'aberturas_removidas', _abert, 'lancamentos_removidos', _lctos,
    'linhas_arquivo_removidas', _linhas_ecd);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ecd_excluir_mes(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ecd_excluir_importacao(_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '180s'
AS $function$
DECLARE
  _tenant uuid; _company uuid; _arquivo text; _upload uuid;
  _saldos int := 0; _abert int := 0;
BEGIN
  SELECT i.tenant_id, i.company_id, i.arquivo_nome INTO _tenant, _company, _arquivo
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  DELETE FROM public.saldos_mensais
   WHERE company_id = _company AND origem_ecd = _importacao_id;
  GET DIAGNOSTICS _saldos = ROW_COUNT;

  DELETE FROM public.saldos_abertura
   WHERE company_id = _company AND origem_ecd = _importacao_id;
  GET DIAGNOSTICS _abert = ROW_COUNT;

  SELECT id INTO _upload FROM public.diario_uploads
   WHERE company_id = _company AND filename = 'ECD: ' || _arquivo LIMIT 1;

  IF _upload IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.lancamentos_diario WHERE upload_id = _upload
  ) THEN
    DELETE FROM public.diario_uploads WHERE id = _upload;
  END IF;

  DELETE FROM public.ecd_importacao WHERE id = _importacao_id;

  RETURN jsonb_build_object('ok', true, 'saldos_removidos', _saldos,
    'aberturas_removidas', _abert, 'upload_removido', _upload IS NOT NULL);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ecd_excluir_importacao(uuid) TO authenticated, service_role;