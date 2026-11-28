DO $migration$
DECLARE definicao text;
BEGIN
 SELECT pg_get_functiondef(oid) INTO definicao FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='ecd_criar_participantes';
 definicao:=replace(definicao,'pc.company_id destino_empresa',$new$pc.company_id destino_empresa,
 (pc.is_participante AND EXISTS (
 SELECT 1 FROM public.depara_contas d2 WHERE d2.company_id=_company
 AND d2.conta_padrao_codigo=d.conta_padrao_codigo AND d2.conta_codigo<>c.codigo AND NOT d2.ignorada
 AND EXISTS (SELECT 1 FROM public.ecd_conta e2 JOIN public.ecd_importacao i2 ON i2.id=e2.importacao_id
 WHERE i2.company_id=_company AND e2.codigo=d2.conta_codigo AND e2.tipo='A'))) colisao$new$);
 definicao:=replace(definicao,'FROM base b WHERE NOT b.ignorada AND b.destino_empresa IS NULL','FROM base b WHERE NOT b.ignorada AND (b.destino_empresa IS NULL OR b.colisao)');
 definicao:=replace(definicao,'OR public.ecd_vinculo_do_robo(b.observacao))','OR public.ecd_vinculo_do_robo(b.observacao) OR b.colisao)');
 definicao:=replace(definicao,$old$AND (upper(p.descricao) LIKE ANY(ARRAY['%CLIENTE%','%FORNECEDOR%']) OR (pc.codigo LIKE 'AGG-%' AND upper(pc.descricao) LIKE ANY(ARRAY['%CLIENTE%','%FORNECEDOR%'])))$old$,$new$AND (pc.is_participante OR upper(p.descricao) LIKE ANY(ARRAY['%CLIENTE%','%FORNECEDOR%']) OR (pc.codigo LIKE 'AGG-%' AND upper(pc.descricao) LIKE ANY(ARRAY['%CLIENTE%','%FORNECEDOR%'])))$new$);
 IF position('OR b.colisao' in definicao)=0 THEN RAISE EXCEPTION 'Definição inesperada'; END IF;
 EXECUTE definicao;
END;
$migration$;