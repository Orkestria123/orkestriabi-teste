CREATE OR REPLACE FUNCTION public.ecd_criar_participantes(_importacao_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE _tenant uuid; _company uuid; _pref text; _n int := 0;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  _pref := public.prefixo_empresa(_company);

  -- Lista de trabalho da transação (esvazia sozinha no fim).
  CREATE TEMP TABLE IF NOT EXISTS _ecd_parts_v2 (
    ecd_cod text, seg text, nome text, pd_cls text, pd_nat text, pd_nivel int,
    tipo text, novo text, descr text, rn bigint
  ) ON COMMIT DELETE ROWS;

  INSERT INTO _ecd_parts_v2 (ecd_cod, seg, nome, pd_cls, pd_nat, pd_nivel, tipo, novo, descr, rn)
  WITH base AS (
    SELECT c.codigo AS ecd_cod,
           (string_to_array(c.codigo,'.'))[array_length(string_to_array(c.codigo,'.'),1)] AS seg,
           btrim(c.descricao) AS nome,
           pd.classificacao AS pd_cls, pd.natureza AS pd_nat, pd.nivel AS pd_nivel,
           CASE WHEN pd.tipo IN ('4-Cli. Nac.','5-For. Nac.','6-Cli. Ex.','7-For. Ex.') THEN pd.tipo
                WHEN pd.tipo = '2-Passivo' THEN '5-For. Nac.' ELSE '4-Cli. Nac.' END AS tipo,
           dc.conta_padrao_codigo AS dc_dest,
           COALESCE(dc.ignorada, false) AS dc_ign,
           dc.observacao AS dc_obs
      FROM public.ecd_conta c
      JOIN public.ecd_conta p ON p.importacao_id = c.importacao_id AND p.codigo = c.cod_superior
      LEFT JOIN public.depara_contas dc ON dc.company_id = _company AND dc.conta_codigo = c.codigo
      LEFT JOIN public.depara_contas dp ON dp.company_id = _company AND dp.conta_codigo = c.cod_superior
      JOIN public.plano_contas pd ON pd.tenant_id = _tenant AND pd.company_id IS NULL
       AND pd.codigo = COALESCE(
             CASE WHEN dc.conta_padrao_codigo LIKE _pref || '-%' THEN NULL ELSE dc.conta_padrao_codigo END,
             dp.conta_padrao_codigo)
       AND pd.tipo IN ('1-Ativo','2-Passivo','4-Cli. Nac.','5-For. Nac.','6-Cli. Ex.','7-For. Ex.')
     WHERE c.importacao_id = _importacao_id AND c.tipo = 'A'
       AND upper(p.descricao) LIKE ANY (ARRAY['%CLIENTE%','%FORNECEDOR%'])
  ),
  calc AS (
    SELECT b.*,
           _pref || '-' || CASE WHEN b.tipo IN ('4-Cli. Nac.','6-Cli. Ex.') THEN 'C' ELSE 'F' END || b.seg AS novo
      FROM base b
  ),
  -- Decisão manual manda: a rotina só cria/aponta o participante na
  -- primeira vez, ou quando o vínculo foi escrito pelo robô. Depois que
  -- o usuário revincula a conta, "Atualizar demonstrações" não desfaz.
  filtrado AS (
    SELECT k.* FROM calc k
     WHERE NOT k.dc_ign
       AND NOT (k.dc_dest LIKE _pref || '-%' AND k.dc_dest <> k.novo)
       AND NOT (k.dc_dest IS NOT NULL AND k.dc_dest <> k.novo
                AND k.dc_obs IS NOT NULL
                AND k.dc_obs NOT ILIKE '%autom%'
                AND k.dc_obs NOT ILIKE 'ECD: classificação idêntica%'
                AND EXISTS (SELECT 1 FROM public.plano_contas x
                             WHERE x.tenant_id = _tenant AND x.company_id = _company
                               AND x.codigo = k.novo))
  )
  SELECT f.ecd_cod, f.seg, f.nome, f.pd_cls, f.pd_nat, f.pd_nivel, f.tipo, f.novo,
         f.seg || ' ' || f.nome,
         row_number() OVER (PARTITION BY f.novo ORDER BY f.ecd_cod)
    FROM filtrado f;

  UPDATE public.plano_contas pc
     SET codigo = t.novo, classificacao = t.pd_cls, descricao = t.descr, tipo = t.tipo,
         natureza = t.pd_nat, nivel = t.pd_nivel, is_participante = true, is_sintetica = false,
         conta_pai_classificacao = t.pd_cls, updated_at = now()
    FROM _ecd_parts_v2 t
   WHERE t.rn = 1 AND pc.tenant_id = _tenant AND pc.company_id = _company AND pc.codigo = t.ecd_cod
     AND NOT EXISTS (SELECT 1 FROM public.plano_contas x
                      WHERE x.tenant_id = _tenant AND x.company_id = _company AND x.codigo = t.novo);

  INSERT INTO public.plano_contas
    (tenant_id, company_id, codigo, classificacao, descricao, tipo, natureza, nivel,
     is_participante, is_sintetica, ativo, conta_pai_classificacao, dfc_nao_caixa)
  SELECT _tenant, _company, t.novo, t.pd_cls, t.descr, t.tipo, t.pd_nat, t.pd_nivel,
         true, false, true, t.pd_cls, false
    FROM _ecd_parts_v2 t
   WHERE t.rn = 1 AND NOT EXISTS (SELECT 1 FROM public.plano_contas x
                      WHERE x.tenant_id = _tenant AND x.company_id = _company AND x.codigo = t.novo);
  GET DIAGNOSTICS _n = ROW_COUNT;

  UPDATE public.depara_contas d SET conta_padrao_codigo = t.novo, updated_at = now()
    FROM _ecd_parts_v2 t
   WHERE d.company_id = _company AND d.conta_codigo = t.ecd_cod
     AND NOT COALESCE(d.ignorada, false)
     AND d.conta_padrao_codigo IS DISTINCT FROM t.novo;

  INSERT INTO public.depara_contas (tenant_id, company_id, conta_codigo, conta_padrao_codigo, ignorada)
  SELECT DISTINCT ON (t.ecd_cod) _tenant, _company, t.ecd_cod, t.novo, false FROM _ecd_parts_v2 t
   WHERE NOT EXISTS (SELECT 1 FROM public.depara_contas d WHERE d.company_id = _company AND d.conta_codigo = t.ecd_cod);

  RETURN _n;
END;
$function$;