CREATE OR REPLACE FUNCTION public.ecd_criar_participantes(_importacao_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '300s'
AS $function$
DECLARE _tenant uuid; _company uuid; _pref text; _n int := 0;
BEGIN
 SELECT tenant_id,company_id INTO _tenant,_company FROM public.ecd_importacao WHERE id=_importacao_id;
 IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
 IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
 _pref:=public.prefixo_empresa(_company);
 CREATE TEMP TABLE IF NOT EXISTS _ecd_parts_v3(ecd_cod text PRIMARY KEY,novo text,nome text,cls text,tipo text,natureza text,nivel int,pai text) ON COMMIT DROP;
 DELETE FROM _ecd_parts_v3 WHERE ecd_cod IS NOT NULL;
 INSERT INTO _ecd_parts_v3
 WITH base AS (
 SELECT c.codigo,c.descricao,c.natureza AS origem_nat,pc.classificacao,pc.tipo,pc.natureza,pc.nivel,pc.conta_pai_classificacao,
        d.conta_padrao_codigo,d.observacao,COALESCE(d.ignorada,false) ignorada,
        pc.company_id destino_empresa
 FROM public.ecd_conta c
 JOIN public.ecd_conta p ON p.importacao_id=c.importacao_id AND p.codigo=c.cod_superior
 LEFT JOIN public.depara_contas d ON d.company_id=_company AND d.conta_codigo=c.codigo
 LEFT JOIN public.depara_contas dp ON dp.company_id=_company AND dp.conta_codigo=p.codigo
 JOIN LATERAL (SELECT x.* FROM public.plano_contas x WHERE x.tenant_id=_tenant
   AND (x.company_id=_company OR x.company_id IS NULL)
   AND x.codigo=COALESCE(d.conta_padrao_codigo,dp.conta_padrao_codigo)
   ORDER BY (x.company_id=_company) DESC NULLS LAST LIMIT 1) pc ON true
 WHERE c.importacao_id=_importacao_id AND c.tipo='A'
 AND upper(p.descricao) LIKE ANY(ARRAY['%CLIENTE%','%FORNECEDOR%'])
 AND pc.tipo IN ('1-Ativo','2-Passivo','4-Cli. Nac.','5-For. Nac.','6-Cli. Ex.','7-For. Ex.')
 ), candidatos AS (
 SELECT b.*, CASE WHEN b.tipo IN ('4-Cli. Nac.','5-For. Nac.','6-Cli. Ex.','7-For. Ex.') THEN b.tipo
 WHEN b.classificacao LIKE '1.01.02.01.02%' THEN '6-Cli. Ex.'
 WHEN b.classificacao LIKE '2.01.01.01.02%' THEN '7-For. Ex.'
 WHEN b.tipo='2-Passivo' THEN '5-For. Nac.' ELSE '4-Cli. Nac.' END part_tipo
 FROM base b WHERE NOT b.ignorada AND b.destino_empresa IS NULL
 AND (b.conta_padrao_codigo LIKE 'AGG-%' OR b.conta_padrao_codigo IS NULL
      OR public.ecd_vinculo_do_robo(b.observacao))
 AND (b.conta_padrao_codigo LIKE 'AGG-%' OR b.tipo IN ('4-Cli. Nac.','5-For. Nac.','6-Cli. Ex.','7-For. Ex.')
      OR b.classificacao LIKE '1.01.02.01.%' OR b.classificacao LIKE '2.01.01.01.%')
 )
 SELECT codigo,_pref||'-'||CASE WHEN part_tipo IN ('4-Cli. Nac.','6-Cli. Ex.') THEN 'C' ELSE 'F' END||codigo,
 COALESCE(NULLIF(btrim(descricao),''),codigo),classificacao,part_tipo,
 CASE WHEN origem_nat IN ('01','1') THEN 'D' WHEN origem_nat IN ('02','2') THEN 'C' ELSE natureza END,
 nivel,CASE WHEN conta_padrao_codigo LIKE 'AGG-%' THEN classificacao ELSE COALESCE(conta_pai_classificacao,classificacao) END
 FROM candidatos;
 INSERT INTO public.plano_contas(tenant_id,company_id,codigo,classificacao,descricao,tipo,natureza,nivel,is_participante,is_sintetica,ativo,conta_pai_classificacao,dfc_nao_caixa)
 SELECT _tenant,_company,t.novo,t.cls,t.nome,t.tipo,t.natureza,t.nivel,true,false,true,t.pai,false FROM _ecd_parts_v3 t
 WHERE NOT EXISTS(SELECT 1 FROM public.plano_contas x WHERE x.tenant_id=_tenant AND x.company_id=_company AND x.codigo=t.novo);
 GET DIAGNOSTICS _n=ROW_COUNT;
 UPDATE public.depara_contas d SET conta_padrao_codigo=t.novo,
 observacao='ECD: participante individual automático; origem '||t.ecd_cod,updated_at=now()
 FROM _ecd_parts_v3 t WHERE d.company_id=_company AND d.conta_codigo=t.ecd_cod AND NOT d.ignorada AND d.conta_padrao_codigo IS DISTINCT FROM t.novo;
 INSERT INTO public.depara_contas(tenant_id,company_id,conta_codigo,conta_padrao_codigo,ignorada,observacao)
 SELECT _tenant,_company,t.ecd_cod,t.novo,false,'ECD: participante individual automático; origem '||t.ecd_cod FROM _ecd_parts_v3 t
 WHERE NOT EXISTS(SELECT 1 FROM public.depara_contas d WHERE d.company_id=_company AND d.conta_codigo=t.ecd_cod);
 RETURN _n;
END;
$function$;