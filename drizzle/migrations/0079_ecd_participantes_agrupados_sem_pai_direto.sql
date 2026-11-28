DO $migration$
DECLARE definicao text;
BEGIN
 SELECT pg_get_functiondef(oid) INTO definicao FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='ecd_criar_participantes';
 IF position('JOIN public.ecd_conta p ON' in definicao)=0 THEN RAISE EXCEPTION 'Definição inesperada'; END IF;
 definicao:=replace(definicao,'JOIN public.ecd_conta p ON p.importacao_id=c.importacao_id AND p.codigo=c.cod_superior','LEFT JOIN public.ecd_conta p ON p.importacao_id=c.importacao_id AND p.codigo=c.cod_superior');
 definicao:=replace(definicao,$old$AND upper(p.descricao) LIKE ANY(ARRAY['%CLIENTE%','%FORNECEDOR%'])$old$,$new$AND (upper(p.descricao) LIKE ANY(ARRAY['%CLIENTE%','%FORNECEDOR%']) OR (pc.codigo LIKE 'AGG-%' AND upper(pc.descricao) LIKE ANY(ARRAY['%CLIENTE%','%FORNECEDOR%'])))$new$);
 EXECUTE definicao;
 SELECT pg_get_functiondef(oid) INTO definicao FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='ecd_rematerializar_destinos';
 IF position('OR NOT EXISTS (' in definicao)=0 THEN RAISE EXCEPTION 'Definição inesperada do diário'; END IF;
 definicao:=replace(definicao,$old$(NOT COALESCE(l.encerramento, false)
      OR NOT EXISTS (
        SELECT 1 FROM public.plano_contas pa
         WHERE pa.tenant_id = _tenant AND pa.codigo = d.conta_padrao_codigo
           AND (pa.company_id IS NULL OR pa.company_id = _company)
           AND pa.tipo = '3-DRE'))$old$,$new$NOT COALESCE(l.encerramento, false)$new$);
 EXECUTE definicao;
END;
$migration$;