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
  IF _ocupado AND NOT EXISTS (
    SELECT 1 FROM public.lancamentos_diario l
      JOIN public.diario_uploads u ON u.id = l.upload_id
     WHERE l.company_id = _company AND l.competencia = _competencia
       AND COALESCE(u.filename, '') NOT LIKE 'ECD:%'
  ) THEN
    DELETE FROM public.saldos_mensais m
     WHERE m.company_id = _company AND m.competencia = _competencia
       AND m.origem_ecd IS NULL;
    _ocupado := false;
  END IF;
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

  _usa_diario := COALESCE(_deb_lcto, 0) > 0;
  IF _usa_diario AND COALESCE(_deb_saldo, 0) > 0
     AND abs(_deb_lcto - _deb_saldo) / _deb_saldo > 0.005 THEN
    _usa_diario := false;
  END IF;
  DELETE FROM public.saldos_mensais m
   WHERE m.company_id = _company AND m.competencia = _competencia
     AND m.origem_ecd = _importacao_id;
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