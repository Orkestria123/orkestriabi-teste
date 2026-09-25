DROP INDEX IF EXISTS public.idx_lancamentos_diario_tenant_conta;
CREATE INDEX IF NOT EXISTS lanc_upload_comp ON public.lancamentos_diario (upload_id, competencia);

ALTER FUNCTION public.agregar_saldos_competencia(uuid, date) SET statement_timeout TO '180s';
ALTER FUNCTION public.reverter_saldos_competencia(uuid, date) SET statement_timeout TO '180s';
ALTER FUNCTION public.fechar_upload_diario(uuid) SET statement_timeout TO '180s';
ALTER FUNCTION public.competencias_do_upload(uuid) SET statement_timeout TO '120s';
ALTER FUNCTION public.ecd_gravar_lancamentos(uuid, jsonb, boolean) SET statement_timeout TO '120s';
ALTER FUNCTION public.ecd_materializar_lote(uuid, bigint, integer) SET statement_timeout TO '120s';

-- Contas novas do diário por empresa: ignora o diário vindo da ECD (já tem de-para)
-- e as contas específicas da empresa.
CREATE OR REPLACE FUNCTION public.contas_novas_da_empresa(_tenant_id uuid, _company_id uuid, _limite integer DEFAULT 500)
RETURNS TABLE(codigo text, movimento numeric, lancamentos bigint, historico_exemplo text, empresas text, primeira_competencia date, ultima_competencia date)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH ups AS (
    SELECT u.id FROM public.diario_uploads u
     WHERE u.tenant_id = _tenant_id
       AND (_company_id IS NULL OR u.company_id = _company_id)
       AND COALESCE(u.filename, '') NOT LIKE 'ECD:%'
  ),
  mov AS (
    SELECT l.conta_codigo,
           SUM(l.debito - l.credito) AS movimento,
           COUNT(*) AS lancamentos,
           MIN(l.competencia) AS primeira,
           MAX(l.competencia) AS ultima,
           MIN(NULLIF(btrim(l.historico), '')) AS historico,
           string_agg(DISTINCT c.name, ', ') AS empresas
      FROM public.lancamentos_diario l
      JOIN ups ON ups.id = l.upload_id
      JOIN public.companies c ON c.id = l.company_id
     WHERE COALESCE(c.plano_tipo, 'padrao') = 'padrao'
     GROUP BY l.conta_codigo
  )
  SELECT m.conta_codigo, m.movimento, m.lancamentos, m.historico, m.empresas, m.primeira, m.ultima
    FROM mov m
   WHERE NOT EXISTS (
     SELECT 1 FROM public.plano_contas p
      WHERE p.tenant_id = _tenant_id AND p.codigo = m.conta_codigo
        AND (p.company_id IS NULL OR p.company_id = _company_id))
     AND NOT EXISTS (
     SELECT 1 FROM public.plano_contas_descartadas d
      WHERE d.tenant_id = _tenant_id AND d.codigo = m.conta_codigo)
   ORDER BY abs(m.movimento) DESC
   LIMIT GREATEST(_limite, 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.contas_novas_da_empresa(uuid, uuid, integer) TO authenticated;

-- Drill-down: contas específicas da empresa (clientes/fornecedores com prefixo)
-- também entram quando a empresa usa o Plano Padrão.
CREATE OR REPLACE FUNCTION public.drilldown_contas(_company_id uuid, _classificacao text, _competencia_min date DEFAULT NULL::date, _competencia_max date DEFAULT NULL::date)
 RETURNS TABLE(codigo text, descricao text, classificacao text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
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
         AND (_competencia_min IS NULL OR l.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR l.competencia <= _competencia_max)
    )
    SELECT DISTINCT ON (p.codigo) p.codigo, p.descricao, p.classificacao
      FROM com_mov m
      JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND (p.company_id IS NOT DISTINCT FROM _scope OR p.company_id = _company_id)
       AND p.codigo = m.conta_codigo
     WHERE p.is_sintetica = false
       AND (p.codigo = _classificacao
            OR p.classificacao = _classificacao
            OR left(p.classificacao, length(_classificacao) + 1) = _classificacao || '.')
     ORDER BY p.codigo, (p.company_id IS NULL);
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
              AND (p2.company_id IS NOT DISTINCT FROM _scope OR p2.company_id = _company_id)
              AND p2.codigo = m.conta_codigo)
    )
    SELECT DISTINCT ON (r.busca) r.busca, COALESCE(o.descricao, p.descricao), p.classificacao
      FROM resolvido r
      JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND (p.company_id IS NOT DISTINCT FROM _scope OR p.company_id = _company_id)
       AND p.codigo = r.plano
      LEFT JOIN public.plano_contas o
        ON o.tenant_id = _tenant AND o.company_id = _company_id
       AND o.codigo = r.busca
     WHERE p.is_sintetica = false
       AND (p.codigo = _classificacao
            OR p.classificacao = _classificacao
            OR left(p.classificacao, length(_classificacao) + 1) = _classificacao || '.')
     ORDER BY r.busca, (p.company_id IS NULL);
  END IF;
END;
$function$;