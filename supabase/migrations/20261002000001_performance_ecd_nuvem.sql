-- ============================================================
-- Empresa ECD na nuvem: não varrer 485 mil lançamentos
-- ============================================================
--
-- DRE, drill-down e de-para chamavam DISTINCT em lancamentos_diario
-- (e depara_traducao com LATERAL por conta). Com ECD materializado
-- isso estoura o statement_timeout de ~8s da API hospedada. Os
-- saldos_mensais já têm o movimento do período.

CREATE INDEX IF NOT EXISTS idx_lanc_company_hist
  ON public.lancamentos_diario (company_id, competencia)
  WHERE historico IS NOT NULL AND btrim(historico) <> '';

CREATE INDEX IF NOT EXISTS idx_depara_company_codigo
  ON public.depara_contas (company_id, conta_codigo);

-- ------------------------------------------------------------
-- Períodos: checa permissão uma vez
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.periodos_da_empresa(_company_id uuid)
RETURNS TABLE (competencia date, fonte text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  RETURN QUERY
  SELECT c.competencia,
         string_agg(DISTINCT c.fonte, '+' ORDER BY c.fonte) AS fonte
    FROM (
      SELECT DISTINCT m.competencia,
             CASE WHEN m.origem_ecd IS NULL THEN 'diario' ELSE 'ecd' END AS fonte
        FROM public.saldos_mensais m
       WHERE m.company_id = _company_id
      UNION
      SELECT DISTINCT b.periodo, 'balancete'::text
        FROM public.account_balances b
       WHERE b.company_id = _company_id
      UNION
      SELECT DISTINCT f.periodo, 'demonstracao'::text
        FROM public.financial_statements f
       WHERE f.company_id = _company_id
    ) c
   GROUP BY c.competencia
   ORDER BY c.competencia;
END;
$fn$;

-- ------------------------------------------------------------
-- De-para: uma página por chamada (PostgREST max_rows = 1000).
-- Sem OFFSET: cada página não reconstrói e descarta o restante.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.depara_traducao_pagina(
  _company_id uuid,
  _depois text DEFAULT NULL,
  _limite integer DEFAULT 1000
)
RETURNS TABLE (
  conta_codigo text,
  conta_padrao_codigo text,
  origem text,
  ignorada boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $fn$
DECLARE
  _tenant uuid;
  _tem_saldo boolean;
  _tem_regras boolean;
  _lim int;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;
  _lim := LEAST(GREATEST(COALESCE(_limite, 1000), 1), 1000);

  SELECT EXISTS (SELECT 1 FROM public.saldos_mensais s WHERE s.company_id = _company_id)
      OR EXISTS (SELECT 1 FROM public.saldos_abertura a WHERE a.company_id = _company_id)
    INTO _tem_saldo;

  SELECT EXISTS (SELECT 1 FROM public.depara_regras r WHERE r.company_id = _company_id)
    INTO _tem_regras;

  RETURN QUERY
  WITH com_saldo AS (
    SELECT sm.conta_codigo FROM public.saldos_mensais sm
     WHERE sm.company_id = _company_id
    UNION
    SELECT sa.conta_codigo FROM public.saldos_abertura sa
     WHERE sa.company_id = _company_id
    UNION
    SELECT l.conta_codigo FROM public.lancamentos_diario l
     WHERE l.company_id = _company_id
       AND NOT _tem_saldo
  ),
  pagina AS (
    SELECT cs.conta_codigo
      FROM com_saldo cs
     WHERE _depois IS NULL OR cs.conta_codigo > _depois
     ORDER BY cs.conta_codigo
     LIMIT _lim
  )
  SELECT p.conta_codigo,
         COALESCE(dc.conta_padrao_codigo, r.conta_padrao_codigo),
         CASE WHEN dc.conta_padrao_codigo IS NOT NULL THEN 'exato'::text
              WHEN r.conta_padrao_codigo IS NOT NULL THEN 'regra'::text
              ELSE 'sem_vinculo'::text END,
         COALESCE(dc.ignorada, false)
    FROM pagina p
    LEFT JOIN public.plano_contas pc
      ON pc.tenant_id = _tenant AND pc.company_id = _company_id AND pc.codigo = p.conta_codigo
    LEFT JOIN public.depara_contas dc
      ON dc.company_id = _company_id AND dc.conta_codigo = p.conta_codigo
    LEFT JOIN LATERAL (
      SELECT dr.conta_padrao_codigo
        FROM public.depara_regras dr
       WHERE _tem_regras
         AND dc.conta_padrao_codigo IS NULL
         AND dr.company_id = _company_id
         AND (dr.tipo_conta IS NULL OR dr.tipo_conta = coalesce(pc.tipo, dr.tipo_conta))
         AND (dr.classificacao_prefixo IS NULL
              OR coalesce(pc.classificacao, p.conta_codigo) = dr.classificacao_prefixo
              OR left(coalesce(pc.classificacao, p.conta_codigo), length(dr.classificacao_prefixo) + 1)
                 = dr.classificacao_prefixo || '.')
       ORDER BY length(COALESCE(dr.classificacao_prefixo, '')) DESC,
                (dr.tipo_conta IS NOT NULL) DESC
       LIMIT 1
    ) r ON true
   ORDER BY p.conta_codigo;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.depara_traducao_pagina(uuid, text, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.depara_traducao_pagina(uuid, text, integer) TO authenticated, service_role;

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
  _tem_regras boolean;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;

  SELECT EXISTS (SELECT 1 FROM public.saldos_mensais s WHERE s.company_id = _company_id)
      OR EXISTS (SELECT 1 FROM public.saldos_abertura a WHERE a.company_id = _company_id)
    INTO _tem_saldo;

  SELECT EXISTS (SELECT 1 FROM public.depara_regras r WHERE r.company_id = _company_id)
    INTO _tem_regras;

  RETURN QUERY
  WITH com_saldo AS (
    SELECT sm.conta_codigo FROM public.saldos_mensais sm
     WHERE sm.company_id = _company_id
    UNION
    SELECT sa.conta_codigo FROM public.saldos_abertura sa
     WHERE sa.company_id = _company_id
    UNION
    SELECT l.conta_codigo FROM public.lancamentos_diario l
     WHERE l.company_id = _company_id
       AND NOT _tem_saldo
  )
  SELECT cs.conta_codigo,
         COALESCE(dc.conta_padrao_codigo, r.conta_padrao_codigo),
         CASE WHEN dc.conta_padrao_codigo IS NOT NULL THEN 'exato'::text
              WHEN r.conta_padrao_codigo IS NOT NULL THEN 'regra'::text
              ELSE 'sem_vinculo'::text END,
         COALESCE(dc.ignorada, false)
    FROM com_saldo cs
    LEFT JOIN public.plano_contas pc
      ON pc.tenant_id = _tenant AND pc.company_id = _company_id AND pc.codigo = cs.conta_codigo
    LEFT JOIN public.depara_contas dc
      ON dc.company_id = _company_id AND dc.conta_codigo = cs.conta_codigo
    LEFT JOIN LATERAL (
      SELECT dr.conta_padrao_codigo
        FROM public.depara_regras dr
       WHERE _tem_regras
         AND dc.conta_padrao_codigo IS NULL
         AND dr.company_id = _company_id
         AND (dr.tipo_conta IS NULL OR dr.tipo_conta = coalesce(pc.tipo, dr.tipo_conta))
         AND (dr.classificacao_prefixo IS NULL
              OR coalesce(pc.classificacao, cs.conta_codigo) = dr.classificacao_prefixo
              OR left(coalesce(pc.classificacao, cs.conta_codigo), length(dr.classificacao_prefixo) + 1)
                 = dr.classificacao_prefixo || '.')
       ORDER BY length(COALESCE(dr.classificacao_prefixo, '')) DESC,
                (dr.tipo_conta IS NOT NULL) DESC
       LIMIT 1
    ) r ON true
   ORDER BY cs.conta_codigo;
END;
$fn$;

-- ------------------------------------------------------------
-- Drill-down: contas com movimento vêm do saldo, não do diário
-- ------------------------------------------------------------
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
SET statement_timeout = '30s'
AS $fn$
DECLARE
  _tenant uuid; _scope uuid; _usa_padrao boolean; _usa_depara boolean; _esc jsonb;
  _tem_saldo boolean;
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

  SELECT EXISTS (
    SELECT 1 FROM public.saldos_mensais sm
     WHERE sm.company_id = _company_id
       AND (_competencia_min IS NULL OR sm.competencia >= _competencia_min)
       AND (_competencia_max IS NULL OR sm.competencia <= _competencia_max)
  ) INTO _tem_saldo;

  IF NOT _usa_depara THEN
    RETURN QUERY
    WITH com_mov AS (
      SELECT DISTINCT sm.conta_codigo FROM public.saldos_mensais sm
       WHERE sm.company_id = _company_id
         AND (_competencia_min IS NULL OR sm.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR sm.competencia <= _competencia_max)
      UNION
      SELECT DISTINCT sa.conta_codigo FROM public.saldos_abertura sa
       WHERE sa.company_id = _company_id
      UNION
      SELECT DISTINCT l.conta_codigo FROM public.lancamentos_diario l
       WHERE l.company_id = _company_id
         AND NOT _tem_saldo
         AND (_competencia_min IS NULL OR l.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR l.competencia <= _competencia_max)
    )
    SELECT p.codigo, p.descricao, p.classificacao
      FROM com_mov m
      JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _scope
       AND p.codigo = m.conta_codigo
     WHERE p.is_sintetica = false
       AND (p.codigo = _classificacao
            OR p.classificacao = _classificacao
            OR left(p.classificacao, length(_classificacao) + 1) = _classificacao || '.')
     ORDER BY p.classificacao, p.codigo;
  ELSE
    RETURN QUERY
    WITH com_mov AS (
      SELECT DISTINCT sm.conta_codigo FROM public.saldos_mensais sm
       WHERE sm.company_id = _company_id
         AND (_competencia_min IS NULL OR sm.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR sm.competencia <= _competencia_max)
      UNION
      SELECT DISTINCT sa.conta_codigo FROM public.saldos_abertura sa
       WHERE sa.company_id = _company_id
      UNION
      SELECT DISTINCT l.conta_codigo FROM public.lancamentos_diario l
       WHERE l.company_id = _company_id
         AND NOT _tem_saldo
         AND (_competencia_min IS NULL OR l.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR l.competencia <= _competencia_max)
    ),
    trad AS (
      SELECT d.conta_codigo, d.conta_padrao_codigo
        FROM public.depara_contas d
       WHERE d.company_id = _company_id
         AND NOT COALESCE(d.ignorada, false)
         AND d.conta_padrao_codigo IS NOT NULL
    ),
    resolvido AS (
      SELECT m.conta_codigo AS busca, tr.conta_padrao_codigo AS plano
        FROM com_mov m
        JOIN trad tr ON tr.conta_codigo = m.conta_codigo
      UNION
      SELECT m.conta_codigo, m.conta_codigo
        FROM com_mov m
       WHERE NOT EXISTS (SELECT 1 FROM trad tr WHERE tr.conta_codigo = m.conta_codigo)
         AND EXISTS (
           SELECT 1 FROM public.plano_contas p2
            WHERE p2.tenant_id = _tenant
              AND p2.company_id IS NOT DISTINCT FROM _scope
              AND p2.codigo = m.conta_codigo)
    )
    SELECT r.busca, COALESCE(o.descricao, p.descricao), p.classificacao
      FROM resolvido r
      JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _scope
       AND p.codigo = r.plano
      LEFT JOIN public.plano_contas o
        ON o.tenant_id = _tenant AND o.company_id = _company_id
       AND o.codigo = r.busca
     WHERE p.is_sintetica = false
       AND (p.codigo = _classificacao
            OR p.classificacao = _classificacao
            OR left(p.classificacao, length(_classificacao) + 1) = _classificacao || '.')
     ORDER BY p.classificacao, r.busca;
  END IF;
END;
$fn$;

-- ------------------------------------------------------------
-- Painel ECD: movimento + saldo final sem baixar 9 × N saldos
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ecd_movimento_por_conta(
  _importacao_id uuid,
  _depois text DEFAULT NULL,
  _limite integer DEFAULT 1000
)
RETURNS TABLE (codigo text, mov numeric, fim numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $fn$
DECLARE
  _company uuid;
  _lim int;
BEGIN
  SELECT i.company_id INTO _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _company IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_acessar_empresa(_company) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  _lim := LEAST(GREATEST(COALESCE(_limite, 1000), 1), 1000);

  RETURN QUERY
  SELECT s.codigo,
         SUM(ABS(s.debitos) + ABS(s.creditos)) AS mov,
         (ARRAY_AGG(s.saldo_final ORDER BY s.competencia DESC))[1] AS fim
    FROM public.ecd_saldo s
   WHERE s.importacao_id = _importacao_id
     AND (_depois IS NULL OR s.codigo > _depois)
   GROUP BY s.codigo
   ORDER BY s.codigo
   LIMIT _lim;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_movimento_por_conta(uuid, text, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_movimento_por_conta(uuid, text, integer) TO authenticated, service_role;

ALTER FUNCTION public.ecd_conferir_natureza(uuid) SET statement_timeout = '30s';
ALTER FUNCTION public.ecd_encerramento(uuid) SET statement_timeout = '30s';
ALTER FUNCTION public.ecd_estado_diario(uuid) SET statement_timeout = '30s';

NOTIFY pgrst, 'reload schema';
