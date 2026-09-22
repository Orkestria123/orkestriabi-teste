-- 1) Movimento mensal da ECD passa a ser montado pelo I250 (lançamentos);
--    o I155 (saldos) fica como apoio/verificação e como fallback quando o
--    arquivo não traz diário. As partidas de encerramento (I200 IND_LCTO = E)
--    NÃO entram nas contas de resultado (a DRE mostra o movimento do mês),
--    mas ENTRAM nas contas patrimoniais — é a transferência do resultado do
--    período para o PL, sem a qual o Balanço não fecha.
CREATE OR REPLACE FUNCTION public.ecd_aplicar_mes(_importacao_id uuid, _competencia date, _substituir boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  _tenant uuid; _company uuid; _linhas int := 0;
  _deb_lcto numeric; _deb_saldo numeric; _usa_diario boolean := false;
  _ocupado boolean := false; _diverg numeric := NULL;
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

  -- O I250 é a fonte quando existe diário no mês. O I155 vira conferência:
  -- a divergência volta no retorno, sem mudar a fonte.
  _usa_diario := COALESCE(_deb_lcto, 0) > 0;
  IF COALESCE(_deb_saldo, 0) > 0 AND _deb_lcto IS NOT NULL THEN
    _diverg := round(abs(_deb_lcto - _deb_saldo) / _deb_saldo * 100, 4);
  END IF;

  WITH dest AS (
    SELECT d.conta_codigo,
           d.conta_padrao_codigo AS cod,
           bool_or(pa.tipo = '3-DRE') AS resultado
      FROM public.depara_contas d
      LEFT JOIN public.plano_contas pa
        ON pa.tenant_id = _tenant AND pa.codigo = d.conta_padrao_codigo
     WHERE d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_padrao_codigo IS NOT NULL
       AND NOT COALESCE(d.ignorada, false)
     GROUP BY 1, 2
  ),
  lcto AS (
    SELECT l.codigo, sum(l.debito) AS deb, sum(l.credito) AS cred
      FROM public.ecd_lancamento l
      LEFT JOIN public.ecd_conta c
        ON c.importacao_id = l.importacao_id AND c.codigo = l.codigo
      LEFT JOIN dest dr ON dr.conta_codigo = l.codigo
     WHERE _usa_diario
       AND l.importacao_id = _importacao_id
       AND l.competencia = _competencia
       AND (
         NOT COALESCE(l.encerramento, false)
         OR NOT COALESCE(dr.resultado,
                         public.ecd_conta_resultado(c.classificacao, l.codigo),
                         false)
       )
     GROUP BY 1
  ),
  lado AS (
    SELECT DISTINCT dst.cod,
           (SELECT CASE WHEN ep.papel LIKE 'RECEITA%' OR ep.papel LIKE '%RECEITAS%'
                        THEN 'D' ELSE 'C' END
              FROM public.plano_contas pa
              JOIN public.estrutura_padrao ep
                ON pa.classificacao = ep.classificacao
                OR pa.classificacao LIKE ep.classificacao || '.%'
             WHERE pa.tenant_id = _tenant
               AND pa.codigo = dst.cod
               AND pa.tipo = '3-DRE'
             ORDER BY length(ep.classificacao) DESC
             LIMIT 1) AS zerar
      FROM dest dst
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
      LEFT JOIN lado ld ON ld.cod = d.conta_padrao_codigo
      CROSS JOIN LATERAL public.ecd_dc_movimento(
        s.saldo_inicial, s.debitos, s.creditos, s.saldo_final,
        public.ecd_conta_resultado(c.classificacao, c.codigo)
          AND COALESCE(c.tipo, 'A') <> 'S',
        ld.zerar
      ) x
     WHERE s.importacao_id = _importacao_id AND s.competencia = _competencia
  ),
  -- Contas com partida no I250 mas sem linha de I155 no mês: sem isso o
  -- lançamento existiria no diário e não no saldo mensal.
  extra AS (
    SELECT dst.cod AS codigo, lc.deb, lc.cred
      FROM lcto lc
      JOIN dest dst ON dst.conta_codigo = lc.codigo
     WHERE NOT EXISTS (
       SELECT 1 FROM public.ecd_saldo s
        WHERE s.importacao_id = _importacao_id
          AND s.competencia = _competencia
          AND s.codigo = lc.codigo)
  ),
  tudo AS (
    SELECT codigo, deb, cred FROM bruto
    UNION ALL
    SELECT codigo, deb, cred FROM extra
  ),
  tradu AS (
    SELECT codigo, sum(deb) AS deb, sum(cred) AS cred FROM tudo GROUP BY 1
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

  RETURN jsonb_build_object('linhas', _linhas, 'pulado', false,
    'do_diario', _usa_diario, 'divergencia_i155', _diverg);
END;
$function$;

-- 2) Diário materializado: mesma regra. A partida "E" que cai em conta
--    patrimonial (transferência do resultado) passa a existir no diário,
--    com o histórico do I250; a que cai em conta de resultado, não.
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
    SELECT _tenant, _company, d.conta_padrao_codigo, l.data, l.competencia,
           nullif(btrim(l.historico), ''), l.debito, l.credito, l.numero
      FROM lote l
      JOIN public.depara_contas d
        ON d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_codigo = l.codigo
       AND d.conta_padrao_codigo IS NOT NULL
       AND NOT COALESCE(d.ignorada, false)
      LEFT JOIN public.plano_contas pa
        ON pa.tenant_id = _tenant AND pa.codigo = d.conta_padrao_codigo
     WHERE NOT COALESCE(l.encerramento, false)
        OR COALESCE(pa.tipo, '') <> '3-DRE'
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

-- 3) A DRE não subtrai mais nada vindo da ECD: as partidas "E" já não
--    entram no movimento das contas de resultado. Subtrair de novo zerava
--    o mês do encerramento. Resta apenas a heurística por histórico para
--    uploads comuns de diário (não-ECD).
CREATE OR REPLACE FUNCTION public.correcoes_encerramento(_company_id uuid, _periodos date[])
 RETURNS TABLE(conta_codigo text, competencia date, debitos numeric, creditos numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT l.conta_codigo,
         l.competencia,
         SUM(COALESCE(l.debito, 0))::numeric,
         SUM(COALESCE(l.credito, 0))::numeric
    FROM public.lancamentos_diario l
    JOIN public.diario_uploads u ON u.id = l.upload_id
   WHERE l.company_id = _company_id
     AND l.competencia = ANY (_periodos)
     AND COALESCE(u.filename, '') NOT LIKE 'ECD: %'
     AND l.historico IS NOT NULL
     AND l.historico <> ''
     AND (
       l.historico ILIKE '%Transferido Para Conta%Resultado%'
       OR l.historico ILIKE '%transfer%resultado%'
       OR l.historico ILIKE '%encerramento%resultado%'
       OR l.historico ILIKE '%apura%resultado%'
       OR l.historico ILIKE '%resultado do exercicio%'
       OR l.historico ILIKE '%resultado do exercício%'
     )
   GROUP BY l.conta_codigo, l.competencia
$function$;