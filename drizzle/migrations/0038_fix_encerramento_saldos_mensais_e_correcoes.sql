-- 0038 — As partidas de encerramento (I200 IND_LCTO = E) saíram do diário
-- materializado (ecd_materializar_lote), mas os saldos do I155 as incluem.
--
-- 1) ecd_aplicar_mes: quando monta o movimento mensal pelo diário, a
--    agregação NÃO pode excluir as partidas E — senão o movimento deixa de
--    reproduzir a posição do I155 (o crédito do zeramento no PL some e o
--    Balanço de dezembro deixa de fechar). O enxugo na DRE passa a ser
--    responsabilidade exclusiva de correcoes_encerramento.
-- 2) correcoes_encerramento: passa a ler as partidas E de ecd_lancamento
--    (estrutural, traduzidas pelo de-para) além da heurística de histórico
--    no diário, que continua valendo para uploads de diário comuns.

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

  -- Agrega TODAS as partidas do diário do ECD, inclusive as de
  -- encerramento (I200 IND_LCTO = E): o I155 as inclui na posição, e o
  -- movimento precisa reproduzir o saldo final do arquivo. O que a DRE
  -- faz com elas é papel de correcoes_encerramento, não daqui.
  WITH lcto AS (
    SELECT l.codigo, sum(l.debito) AS deb, sum(l.credito) AS cred
      FROM public.ecd_lancamento l
     WHERE _usa_diario
       AND l.importacao_id = _importacao_id
       AND l.competencia = _competencia
     GROUP BY 1
  ),
  destinos AS (
    SELECT DISTINCT d.conta_padrao_codigo AS cod
      FROM public.ecd_saldo s
      JOIN public.depara_contas d
        ON d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_codigo = s.codigo AND d.conta_padrao_codigo IS NOT NULL
       AND NOT COALESCE(d.ignorada, false)
     WHERE s.importacao_id = _importacao_id AND s.competencia = _competencia
  ),
  lado AS (
    SELECT dst.cod,
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
      FROM destinos dst
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

CREATE OR REPLACE FUNCTION public.correcoes_encerramento(_company_id uuid, _periodos date[])
 RETURNS TABLE(conta_codigo text, competencia date, debitos numeric, creditos numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- ECD: partidas de encerramento (I200 IND_LCTO = E), traduzidas pelo
  -- de-para para o código do plano padrão — mesma chave dos saldos_mensais.
  SELECT d.conta_padrao_codigo,
         l.competencia,
         SUM(COALESCE(l.debito, 0))::numeric,
         SUM(COALESCE(l.credito, 0))::numeric
    FROM public.ecd_lancamento l
    JOIN public.ecd_importacao i ON i.id = l.importacao_id
    JOIN public.depara_contas d
      ON d.tenant_id = i.tenant_id AND d.company_id = i.company_id
     AND d.conta_codigo = l.codigo AND d.conta_padrao_codigo IS NOT NULL
     AND NOT COALESCE(d.ignorada, false)
   WHERE i.company_id = _company_id
     AND i.aplicado_em IS NOT NULL
     AND l.competencia = ANY (_periodos)
     AND l.encerramento
   GROUP BY 1, 2
  UNION ALL
  -- Diário (upload comum): heurística por histórico, como antes.
  SELECT l.conta_codigo,
         l.competencia,
         SUM(COALESCE(l.debito, 0))::numeric,
         SUM(COALESCE(l.credito, 0))::numeric
    FROM public.lancamentos_diario l
   WHERE l.company_id = _company_id
     AND l.competencia = ANY (_periodos)
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