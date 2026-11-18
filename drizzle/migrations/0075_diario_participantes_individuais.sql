CREATE OR REPLACE FUNCTION public.alocar_conta_diario(_company_id uuid, _codigo text, _destino text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _tenant uuid; _nome text; _p public.plano_contas%ROWTYPE; _tipo text; _cls text; _sep text;
BEGIN
SELECT tenant_id INTO _tenant FROM public.companies WHERE id=_company_id;
IF NOT public.pode_acessar_empresa(_company_id) OR NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
SELECT max(nullif(btrim(l.conta_nome),'')) INTO _nome FROM public.lancamentos_diario l JOIN public.diario_uploads u ON u.id=l.upload_id WHERE l.company_id=_company_id AND l.conta_codigo=_codigo AND u.filename NOT LIKE 'ECD:%';
IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.lancamentos_diario l JOIN public.diario_uploads u ON u.id=l.upload_id WHERE l.company_id=_company_id AND l.conta_codigo=_codigo AND u.filename NOT LIKE 'ECD:%') THEN RAISE EXCEPTION 'Conta não encontrada no diário'; END IF;
SELECT * INTO _p FROM public.plano_contas WHERE tenant_id=_tenant AND (company_id IS NULL OR company_id=_company_id) AND codigo=_destino AND ativo ORDER BY company_id NULLS LAST LIMIT 1;
IF NOT FOUND THEN RAISE EXCEPTION 'Destino inválido'; END IF;
_tipo:=public.tipo_participante_diario(_codigo);
IF _tipo IS NOT NULL AND (_p.classificacao LIKE '1.01.02.01%' OR _p.classificacao LIKE '2.01.01.01%') THEN
 SELECT coalesce(separador,'.') INTO _sep FROM public.mascara_classificacao WHERE tenant_id=_tenant LIMIT 1; _sep:=coalesce(_sep,'.');
 _cls:=_p.classificacao;
 IF _p.is_sintetica THEN _cls:=_cls||_sep||'01'; END IF;
 _tipo:=CASE WHEN _cls LIKE '1.01.02.01%' THEN CASE WHEN _cls LIKE '1.01.02.01.02%' THEN '6-Cli. Ex.' ELSE '4-Cli. Nac.' END ELSE CASE WHEN _cls LIKE '2.01.01.01.02%' THEN '7-For. Ex.' ELSE '5-For. Nac.' END END;
 PERFORM pg_advisory_xact_lock(hashtext('diario_participante:'||_company_id::text||':'||_codigo));
 INSERT INTO public.plano_contas(tenant_id,company_id,codigo,classificacao,descricao,tipo,natureza,nivel,is_participante,is_sintetica,conta_pai_classificacao,ativo)
 VALUES(_tenant,_company_id,_codigo,_cls,coalesce(_nome,_codigo),_tipo,'A',array_length(string_to_array(_cls,_sep),1),true,false,regexp_replace(_cls,'[.][^.]+$',''),true)
 ON CONFLICT(tenant_id,coalesce(company_id,'00000000-0000-0000-0000-000000000000'::uuid),codigo) DO UPDATE SET classificacao=excluded.classificacao,descricao=coalesce(_nome,plano_contas.descricao),tipo=excluded.tipo,natureza='A',nivel=excluded.nivel,is_participante=true,is_sintetica=false,conta_pai_classificacao=excluded.conta_pai_classificacao,ativo=true,updated_at=now();
 PERFORM public.aplicar_depara_em_lote(_company_id,jsonb_build_array(jsonb_build_object('conta_codigo',_codigo,'conta_padrao_codigo',_codigo,'ignorada',false,'observacao','Conta individual na conferência do Diário')));
ELSE
 IF _p.is_sintetica OR _p.is_participante THEN RAISE EXCEPTION 'Destino inválido'; END IF;
 PERFORM public.aplicar_depara_em_lote(_company_id,jsonb_build_array(jsonb_build_object('conta_codigo',_codigo,'conta_padrao_codigo',_destino,'ignorada',false,'observacao','Alocação manual na conferência do Diário')));
END IF;
END $$;
REVOKE ALL ON FUNCTION public.alocar_conta_diario(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.alocar_conta_diario(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.aprovar_contas_diario_empresa(_company_id uuid,_itens jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET statement_timeout='120s' AS $$
DECLARE _tenant uuid; _it record; _dest text; _n int:=0; _rest jsonb:='[]'::jsonb; _r jsonb;
BEGIN
SELECT tenant_id INTO _tenant FROM public.companies WHERE id=_company_id;
IF NOT public.pode_acessar_empresa(_company_id) OR NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
FOR _it IN SELECT value v FROM jsonb_array_elements(_itens) LOOP
 IF public.tipo_participante_diario(_it.v->>'codigo') IS NOT NULL THEN
  SELECT codigo INTO _dest FROM public.plano_contas WHERE tenant_id=_tenant AND company_id IS NULL AND ativo AND classificacao IN (_it.v->>'classificacao_pai',(_it.v->>'classificacao_pai')||'.01') ORDER BY is_sintetica DESC,classificacao LIMIT 1;
  IF _dest IS NULL THEN RAISE EXCEPTION 'Sintética não encontrada'; END IF;
  PERFORM public.alocar_conta_diario(_company_id,_it.v->>'codigo',_dest); _n:=_n+1;
 ELSE _rest:=_rest||jsonb_build_array(_it.v); END IF;
END LOOP;
IF jsonb_array_length(_rest)>0 THEN _r:=public.aprovar_contas_novas_lote(_tenant,_rest); ELSE _r:='{}'::jsonb; END IF;
RETURN jsonb_build_object('inseridas',_n+coalesce((_r->>'inseridas')::int,0),'puladas',coalesce((_r->>'puladas')::int,0));
END $$;
REVOKE ALL ON FUNCTION public.aprovar_contas_diario_empresa(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.aprovar_contas_diario_empresa(uuid,jsonb) TO authenticated;