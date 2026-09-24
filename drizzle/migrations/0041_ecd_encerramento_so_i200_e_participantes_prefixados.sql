
-- 1) Encerramento: só o que o próprio arquivo marca (I200 IND_LCTO = E).
--    A heurística anterior marcava partidas NORMAIS do último dia do mês
--    como encerramento e elas sumiam da DRE.
CREATE OR REPLACE FUNCTION public.ecd_marcar_encerramento(_importacao_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '60s'
AS $function$
DECLARE _n int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ecd_importacao i WHERE i.id = _importacao_id) THEN
    RAISE EXCEPTION 'Importação não encontrada';
  END IF;
  SELECT count(*) INTO _n FROM public.ecd_lancamento l
   WHERE l.importacao_id = _importacao_id AND l.encerramento;
  RETURN _n;
END;
$function$;

-- 2) Prefixo da empresa para contas específicas
CREATE OR REPLACE FUNCTION public.prefixo_empresa(_company_id uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(NULLIF(upper(left(regexp_replace(
           translate(c.name,'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç','AAAAEEIOOOUCaaaaeeiooouc'),
           '[^A-Za-z]','','g'),3)),''),'EMP')
    FROM public.companies c WHERE c.id = _company_id
$$;

-- 3) Participantes da ECD: código "<PREFIXO>-<último segmento>",
--    descrição "<último segmento> <nome>", pendurados na conta do Plano
--    Padrão para onde o de-para aponta. O de-para passa a apontar para eles.
CREATE OR REPLACE FUNCTION public.ecd_criar_participantes(_importacao_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s'
AS $function$
DECLARE _tenant uuid; _company uuid; _pref text; _n int := 0;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  _pref := public.prefixo_empresa(_company);

  CREATE TEMP TABLE _parts ON COMMIT DROP AS
  SELECT c.codigo AS ecd_cod,
         _pref || '-' || (string_to_array(c.codigo,'.'))[array_length(string_to_array(c.codigo,'.'),1)] AS novo,
         (string_to_array(c.codigo,'.'))[array_length(string_to_array(c.codigo,'.'),1)] || ' ' || btrim(c.descricao) AS descr,
         pd.codigo AS pd_cod, pd.classificacao AS pd_cls, pd.natureza AS pd_nat, pd.nivel AS pd_nivel,
         CASE WHEN pd.tipo IN ('4-Cli. Nac.','5-For. Nac.','6-Cli. Ex.','7-For. Ex.') THEN pd.tipo
              WHEN pd.tipo = '2-Passivo' THEN '5-For. Nac.' ELSE '4-Cli. Nac.' END AS tipo
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
     AND upper(p.descricao) LIKE ANY (ARRAY['%CLIENTE%','%FORNECEDOR%']);

  -- linhas criadas pela versão anterior (código = código da ECD)
  UPDATE public.plano_contas pc
     SET codigo = t.novo, classificacao = t.pd_cls, descricao = t.descr, tipo = t.tipo,
         natureza = t.pd_nat, nivel = t.pd_nivel, is_participante = true, is_sintetica = false,
         conta_pai_classificacao = t.pd_cls, updated_at = now()
    FROM _parts t
   WHERE pc.tenant_id = _tenant AND pc.company_id = _company AND pc.codigo = t.ecd_cod
     AND NOT EXISTS (SELECT 1 FROM public.plano_contas x
                      WHERE x.tenant_id = _tenant AND x.company_id = _company AND x.codigo = t.novo);

  INSERT INTO public.plano_contas
    (tenant_id, company_id, codigo, classificacao, descricao, tipo, natureza, nivel,
     is_participante, is_sintetica, ativo, conta_pai_classificacao, dfc_nao_caixa)
  SELECT DISTINCT ON (t.novo) _tenant, _company, t.novo, t.pd_cls, t.descr, t.tipo, t.pd_nat, t.pd_nivel,
         true, false, true, t.pd_cls, false
    FROM _parts t
   WHERE NOT EXISTS (SELECT 1 FROM public.plano_contas x
                      WHERE x.tenant_id = _tenant AND x.company_id = _company AND x.codigo = t.novo);
  GET DIAGNOSTICS _n = ROW_COUNT;

  UPDATE public.depara_contas d SET conta_padrao_codigo = t.novo, updated_at = now()
    FROM _parts t
   WHERE d.company_id = _company AND d.conta_codigo = t.ecd_cod
     AND d.conta_padrao_codigo IS DISTINCT FROM t.novo;

  INSERT INTO public.depara_contas (tenant_id, company_id, conta_codigo, conta_padrao_codigo, ignorada)
  SELECT DISTINCT ON (t.ecd_cod) _tenant, _company, t.ecd_cod, t.novo, false FROM _parts t
   WHERE NOT EXISTS (SELECT 1 FROM public.depara_contas d WHERE d.company_id = _company AND d.conta_codigo = t.ecd_cod);

  RETURN _n;
END;
$function$;

-- 4) Conta específica manual da empresa, pendurada numa conta do Plano Padrão
CREATE OR REPLACE FUNCTION public.criar_conta_empresa(_company_id uuid, _conta_padrao text, _codigo_origem text, _descricao text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _tenant uuid; _pd record; _cod text;
BEGIN
  SELECT tenant_id INTO _tenant FROM public.companies WHERE id = _company_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF btrim(COALESCE(_codigo_origem,'')) = '' OR btrim(COALESCE(_descricao,'')) = '' THEN
    RAISE EXCEPTION 'Informe código e descrição';
  END IF;
  SELECT * INTO _pd FROM public.plano_contas
   WHERE tenant_id = _tenant AND company_id IS NULL AND (codigo = _conta_padrao OR classificacao = _conta_padrao)
   ORDER BY (codigo = _conta_padrao) DESC LIMIT 1;
  IF _pd.codigo IS NULL THEN RAISE EXCEPTION 'Conta do Plano Padrão não encontrada'; END IF;
  _cod := public.prefixo_empresa(_company_id) || '-' || btrim(_codigo_origem);
  IF EXISTS (SELECT 1 FROM public.plano_contas WHERE tenant_id = _tenant AND company_id = _company_id AND codigo = _cod) THEN
    RAISE EXCEPTION 'Já existe a conta % nesta empresa', _cod;
  END IF;
  INSERT INTO public.plano_contas
    (tenant_id, company_id, codigo, classificacao, descricao, tipo, natureza, nivel,
     is_participante, is_sintetica, ativo, conta_pai_classificacao, dfc_nao_caixa)
  VALUES (_tenant, _company_id, _cod, _pd.classificacao, btrim(_codigo_origem) || ' ' || btrim(_descricao),
     CASE WHEN _pd.tipo = '1-Ativo' THEN '4-Cli. Nac.' WHEN _pd.tipo = '2-Passivo' THEN '5-For. Nac.' ELSE _pd.tipo END,
     _pd.natureza, _pd.nivel,
     _pd.tipo IN ('1-Ativo','2-Passivo','4-Cli. Nac.','5-For. Nac.','6-Cli. Ex.','7-For. Ex.'),
     false, true, _pd.classificacao, false);
  RETURN _cod;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.criar_conta_empresa(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prefixo_empresa(uuid) TO authenticated;
