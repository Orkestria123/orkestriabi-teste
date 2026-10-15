DROP FUNCTION IF EXISTS public.contas_novas_da_empresa(uuid, uuid, integer);
CREATE FUNCTION public.contas_novas_da_empresa(_tenant_id uuid, _company_id uuid, _limite integer DEFAULT 500)
 RETURNS TABLE(codigo text, nome_sugerido text, movimento numeric, lancamentos bigint, historico_exemplo text, empresas text, primeira_competencia date, ultima_competencia date, tipo_sugerido text, pai_sugerido text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE _larg int; _pai_cli text; _pai_for text;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RETURN;
  END IF;
  -- Códigos do plano estrutural: participantes do diário usam códigos mais longos.
  SELECT max(length(p.codigo)) INTO _larg FROM public.plano_contas p
   WHERE p.tenant_id = _tenant_id AND p.company_id IS NULL AND NOT p.is_participante
     AND p.codigo ~ '^[0-9]+$';
  SELECT p.classificacao INTO _pai_cli FROM public.plano_contas p
   WHERE p.tenant_id = _tenant_id AND p.company_id IS NULL
     AND upper(p.descricao) LIKE 'CLIENTES NACIONAIS%' ORDER BY p.classificacao LIMIT 1;
  SELECT p.classificacao INTO _pai_for FROM public.plano_contas p
   WHERE p.tenant_id = _tenant_id AND p.company_id IS NULL
     AND upper(p.descricao) LIKE 'FORNECEDORES NACIONAIS%' ORDER BY p.classificacao LIMIT 1;

  RETURN QUERY
  WITH ups AS (
    SELECT u.id FROM public.diario_uploads u
     WHERE u.tenant_id = _tenant_id
       AND (_company_id IS NULL OR u.company_id = _company_id)
       AND COALESCE(u.filename, '') NOT LIKE 'ECD:%'
  ),
  mov AS (
    SELECT l.conta_codigo,
           MAX(NULLIF(btrim(l.conta_nome), '')) AS nome,
           SUM(l.debito - l.credito) AS movimento,
           COUNT(*) AS lancamentos,
           MIN(l.competencia) AS primeira,
           MAX(l.competencia) AS ultima,
           MIN(NULLIF(btrim(l.historico), '')) AS historico,
           string_agg(DISTINCT c.name, ', ') AS empresas,
           (array_agg(sign(l.debito - l.credito) ORDER BY l.data, l.numero_lancamento)
              FILTER (WHERE l.debito <> l.credito))[1] AS primeiro_sinal
      FROM public.lancamentos_diario l
      JOIN ups ON ups.id = l.upload_id
      JOIN public.companies c ON c.id = l.company_id
     WHERE COALESCE(c.plano_tipo, 'padrao') = 'padrao'
     GROUP BY l.conta_codigo
  ),
  cls AS (
    SELECT m.*,
      CASE
        WHEN _larg IS NULL OR m.conta_codigo !~ '^[0-9]+$' OR length(m.conta_codigo) <= _larg THEN NULL
        WHEN upper(COALESCE(m.nome,'')) LIKE 'CLIENTE%' THEN '4-Cli. Nac.'
        WHEN upper(COALESCE(m.nome,'')) LIKE 'FORNECEDOR%' THEN '5-For. Nac.'
        WHEN m.primeiro_sinal > 0 THEN '4-Cli. Nac.'
        WHEN m.primeiro_sinal < 0 THEN '5-For. Nac.'
        WHEN m.movimento > 0 THEN '4-Cli. Nac.'
        ELSE '5-For. Nac.'
      END AS tipo
    FROM mov m
  )
  SELECT m.conta_codigo, m.nome, m.movimento, m.lancamentos, m.historico, m.empresas, m.primeira, m.ultima,
         m.tipo,
         CASE m.tipo WHEN '4-Cli. Nac.' THEN _pai_cli WHEN '5-For. Nac.' THEN _pai_for END
    FROM cls m
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
$function$;
GRANT EXECUTE ON FUNCTION public.contas_novas_da_empresa(uuid, uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sinteticas_do_plano_padrao(_tenant_id uuid)
 RETURNS TABLE(codigo text, classificacao text, descricao text, tipo text, filhos bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH filhos_por_pai AS (
    SELECT p.conta_pai_classificacao AS pai, count(*) AS n
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id AND p.company_id IS NULL
       AND p.conta_pai_classificacao IS NOT NULL
     GROUP BY p.conta_pai_classificacao
  )
  SELECT s.codigo, s.classificacao, s.descricao, s.tipo, COALESCE(f.n, 0)
    FROM public.plano_contas s
    LEFT JOIN filhos_por_pai f ON f.pai = s.classificacao
   WHERE s.tenant_id = _tenant_id AND s.company_id IS NULL
     AND (s.is_sintetica = true
          OR upper(s.descricao) ~ '^(CLIENTES|FORNECEDORES) (NACIONAIS|ESTRANGEIROS)')
   ORDER BY s.classificacao;
END;
$function$;