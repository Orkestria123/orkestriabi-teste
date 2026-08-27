-- Folha da DRE/BP passou a guardar o CÓDIGO da conta (não só a classificação).
-- drilldown_contas só casava prefixo de classificação e a gaveta abria vazia.

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
       AND (p.codigo = _classificacao
            OR p.classificacao = _classificacao
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
