CREATE OR REPLACE FUNCTION public.filtrar_contas_diario(_company_id uuid, _inicio date DEFAULT NULL, _fim date DEFAULT NULL, _busca text DEFAULT '', _offset integer DEFAULT 0, _tipo text DEFAULT '', _divergentes boolean DEFAULT false) RETURNS TABLE(codigo text, nome text, debitos numeric, creditos numeric, lancamentos bigint, tipo_esperado text, destino_codigo text, destino_classificacao text, destino_nome text, ignorada boolean, total bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET statement_timeout='60s' AS $$
DECLARE _tenant uuid;
BEGIN
IF NOT public.pode_acessar_empresa(_company_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
SELECT tenant_id INTO _tenant FROM public.companies WHERE id=_company_id;
RETURN QUERY WITH mov AS (
SELECT l.conta_codigo, max(nullif(btrim(l.conta_nome),'')) nome, sum(l.debito) d, sum(l.credito) c, count(*) n FROM public.lancamentos_diario l JOIN public.diario_uploads u ON u.id=l.upload_id WHERE l.company_id=_company_id AND u.filename NOT LIKE 'ECD:%' AND (_inicio IS NULL OR l.competencia>=_inicio) AND (_fim IS NULL OR l.competencia<=_fim) GROUP BY l.conta_codigo
), resolvido AS (
SELECT m.*, dc.ignorada ign, coalesce(dc.conta_padrao_codigo,reg.conta_padrao_codigo,m.conta_codigo) dest FROM mov m LEFT JOIN public.depara_contas dc ON dc.company_id=_company_id AND dc.conta_codigo=m.conta_codigo
LEFT JOIN LATERAL (SELECT r.conta_padrao_codigo FROM public.depara_regras r JOIN public.plano_contas po ON po.company_id=_company_id AND po.codigo=m.conta_codigo WHERE r.company_id=_company_id AND (r.tipo_conta IS NULL OR r.tipo_conta=po.tipo) AND (r.classificacao_prefixo IS NULL OR public.cls_no_prefixo(po.classificacao,r.classificacao_prefixo)) ORDER BY length(r.classificacao_prefixo) DESC NULLS LAST LIMIT 1) reg ON dc.conta_padrao_codigo IS NULL
), linhas AS (
SELECT m.conta_codigo cod,coalesce(m.nome,p.descricao,m.conta_codigo) nm,m.d,m.c,m.n,public.tipo_participante_diario(m.conta_codigo) esperado,p.codigo pd,p.classificacao cls,p.descricao descr,coalesce(m.ign,false) ign FROM resolvido m LEFT JOIN LATERAL (SELECT p0.* FROM public.plano_contas p0 WHERE p0.tenant_id=_tenant AND (p0.company_id IS NULL OR p0.company_id=_company_id) AND p0.codigo=m.dest AND p0.ativo ORDER BY p0.company_id NULLS LAST LIMIT 1) p ON true
)
SELECT l.cod,l.nm,l.d,l.c,l.n,l.esperado,l.pd,l.cls,l.descr,l.ign,count(*) OVER() FROM linhas l WHERE (coalesce(_busca,'')='' OR l.cod ILIKE '%'||_busca||'%' OR l.nm ILIKE '%'||_busca||'%') AND (coalesce(_tipo,'')='' OR (_tipo='cliente' AND l.esperado='4-Cli. Nac.') OR (_tipo='fornecedor' AND l.esperado='5-For. Nac.')) AND (NOT coalesce(_divergentes,false) OR (l.esperado IS NOT NULL AND NOT l.ign AND (l.cls IS NULL OR NOT public.cls_no_prefixo(l.cls, CASE WHEN l.esperado='4-Cli. Nac.' THEN '1.01.02.01' ELSE '2.01.01.01' END)))) ORDER BY l.cod LIMIT 100 OFFSET greatest(0,coalesce(_offset,0));
END $$;
REVOKE ALL ON FUNCTION public.filtrar_contas_diario(uuid,date,date,text,integer,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.filtrar_contas_diario(uuid,date,date,text,integer,text,boolean) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.alocar_conta_diario(_company_id uuid, _codigo text, _destino text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _tenant uuid;
BEGIN
SELECT tenant_id INTO _tenant FROM public.companies WHERE id=_company_id;
IF NOT public.pode_acessar_empresa(_company_id) OR NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
IF NOT EXISTS(SELECT 1 FROM public.lancamentos_diario l JOIN public.diario_uploads u ON u.id=l.upload_id WHERE l.company_id=_company_id AND l.conta_codigo=_codigo AND u.filename NOT LIKE 'ECD:%') THEN RAISE EXCEPTION 'Conta não encontrada no diário'; END IF;
IF NOT EXISTS(SELECT 1 FROM public.plano_contas WHERE tenant_id=_tenant AND (company_id IS NULL OR company_id=_company_id) AND codigo=_destino AND ativo AND NOT is_sintetica AND NOT is_participante) THEN RAISE EXCEPTION 'Destino inválido'; END IF;
PERFORM public.aplicar_depara_em_lote(_company_id,jsonb_build_array(jsonb_build_object('conta_codigo',_codigo,'conta_padrao_codigo',_destino,'ignorada',false,'observacao','Alocação manual na conferência do Diário')));
END $$;
REVOKE ALL ON FUNCTION public.alocar_conta_diario(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.alocar_conta_diario(uuid,text,text) TO authenticated;