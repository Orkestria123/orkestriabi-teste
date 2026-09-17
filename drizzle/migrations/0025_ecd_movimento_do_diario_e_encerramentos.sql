-- Movimento do mês a partir do saldo, isolando o encerramento.
-- `_zerar` diz de que lado está o lançamento de encerramento ('D' ou 'C');
-- quando não se sabe, cai na regra antiga (pelo sinal do saldo inicial).
CREATE OR REPLACE FUNCTION public.ecd_dc_movimento(
  _saldo_inicial numeric,
  _debitos numeric,
  _creditos numeric,
  _saldo_final numeric,
  _resultado boolean,
  _zerar text DEFAULT NULL
) RETURNS TABLE (debito numeric, credito numeric)
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT
    CASE WHEN NOT encerrou THEN d
         WHEN lado = 'D' THEN 0::numeric
         ELSE d END,
    CASE WHEN NOT encerrou THEN c
         WHEN lado = 'D' THEN c
         ELSE 0::numeric END
  FROM (
    SELECT
      COALESCE(_debitos, 0) AS d,
      COALESCE(_creditos, 0) AS c,
      COALESCE(_resultado, false)
        AND abs(COALESCE(_saldo_final, 0)) < 0.005
        AND (abs(COALESCE(_saldo_inicial, 0)) >= 0.005
             OR (COALESCE(_debitos, 0) > 0 AND COALESCE(_creditos, 0) > 0)) AS encerrou,
      CASE
        WHEN upper(COALESCE(_zerar, '')) IN ('D', 'C') THEN upper(_zerar)
        WHEN COALESCE(_saldo_inicial, 0) <= 0 THEN 'D'
        ELSE 'C'
      END AS lado
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.ecd_dc_movimento(numeric, numeric, numeric, numeric, boolean, text)
  TO authenticated, service_role;

-- Competências em que a ECD zerou as contas de resultado (encerramento).
CREATE OR REPLACE FUNCTION public.encerramentos_da_empresa(_company_id uuid)
RETURNS TABLE (competencia date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT m.competencia FROM (
    SELECT l.competencia
      FROM public.ecd_lancamento l
      JOIN public.ecd_importacao i ON i.id = l.importacao_id
     WHERE i.company_id = _company_id
       AND i.aplicado_em IS NOT NULL
       AND l.encerramento
       AND public.pode_acessar_empresa(_company_id)
    UNION ALL
    SELECT s.competencia
      FROM public.ecd_saldo s
      JOIN public.ecd_conta c
        ON c.importacao_id = s.importacao_id AND c.codigo = s.codigo
      JOIN public.ecd_importacao i ON i.id = s.importacao_id
     WHERE i.company_id = _company_id
       AND i.aplicado_em IS NOT NULL
       AND COALESCE(c.tipo, 'A') <> 'S'
       AND public.ecd_conta_resultado(c.classificacao, c.codigo)
       AND abs(s.saldo_final) < 0.005
       AND abs(s.saldo_inicial) >= 0.005
       AND public.pode_acessar_empresa(_company_id)
     GROUP BY s.competencia
    HAVING count(*) >= 3
  ) m
  ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.encerramentos_da_empresa(uuid) TO authenticated, service_role;

-- ecd_aplicar: quando a importação traz o diário, o movimento do mês sai
-- dos lançamentos (excluindo os de encerramento) em vez de ser adivinhado
-- pelo saldo. Sem diário confiável, o lado do encerramento é decidido pelo
-- papel da conta de destino (receita zera o débito; despesa zera o crédito).
CREATE OR REPLACE FUNCTION public.ecd_aplicar(_importacao_id uuid, _substituir boolean DEFAULT false, _forcar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
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

  WITH lcto_mes AS (
    SELECT l.competencia, sum(l.debito) AS deb_tot
      FROM public.ecd_lancamento l
     WHERE l.importacao_id = _importacao_id
     GROUP BY 1
  ),
  saldo_mes AS (
    SELECT s.competencia, sum(s.debitos) AS deb_tot
      FROM public.ecd_saldo s
      JOIN public.ecd_conta c
        ON c.importacao_id = s.importacao_id AND c.codigo = s.codigo
     WHERE s.importacao_id = _importacao_id AND COALESCE(c.tipo, 'A') <> 'S'
     GROUP BY 1
  ),
  -- Mês em que o diário reproduz o saldo (1% de tolerância): só nele o
  -- lançamento pode substituir o saldo sem risco de diário incompleto.
  meses_ok AS (
    SELECT lm.competencia
      FROM lcto_mes lm JOIN saldo_mes sm ON sm.competencia = lm.competencia
     WHERE sm.deb_tot > 0
       AND abs(lm.deb_tot - sm.deb_tot) <= sm.deb_tot * 0.01
  ),
  lcto AS (
    SELECT l.codigo, l.competencia,
           sum(l.debito) AS deb, sum(l.credito) AS cred
      FROM public.ecd_lancamento l
     WHERE l.importacao_id = _importacao_id
       AND NOT l.encerramento
       AND l.competencia IN (SELECT competencia FROM meses_ok)
     GROUP BY 1, 2
  ),
  bruto AS (
    SELECT d.conta_padrao_codigo AS codigo, s.competencia,
           CASE WHEN mk.competencia IS NOT NULL THEN COALESCE(lc.deb, 0) ELSE x.debito END AS deb,
           CASE WHEN mk.competencia IS NOT NULL THEN COALESCE(lc.cred, 0) ELSE x.credito END AS cred
      FROM public.ecd_saldo s
      JOIN public.ecd_conta c
        ON c.importacao_id = s.importacao_id AND c.codigo = s.codigo
      JOIN public.depara_contas d
        ON d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_codigo = s.codigo AND d.conta_padrao_codigo IS NOT NULL
       AND NOT COALESCE(d.ignorada, false)
      LEFT JOIN meses_ok mk
        ON mk.competencia = s.competencia AND COALESCE(c.tipo, 'A') <> 'S'
      LEFT JOIN lcto lc
        ON lc.codigo = s.codigo AND lc.competencia = s.competencia
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
$function$;