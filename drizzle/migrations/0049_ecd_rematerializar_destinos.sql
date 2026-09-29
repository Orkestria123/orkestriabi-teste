CREATE OR REPLACE FUNCTION public.ecd_rematerializar_destinos(_importacao_id uuid, _destinos text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '300s'
AS $function$
DECLARE
  _tenant uuid; _company uuid; _arquivo text; _upload uuid;
  _apagadas int := 0; _gravadas int := 0; _total int := 0;
BEGIN
  SELECT i.tenant_id, i.company_id, i.arquivo_nome INTO _tenant, _company, _arquivo
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT id INTO _upload FROM public.diario_uploads
   WHERE company_id = _company AND filename = 'ECD: ' || _arquivo LIMIT 1;
  IF _upload IS NULL OR COALESCE(array_length(_destinos, 1), 0) = 0 THEN
    RETURN jsonb_build_object('apagadas', 0, 'gravadas', 0, 'total', 0, 'upload_id', _upload);
  END IF;

  DELETE FROM public.lancamentos_diario l
   WHERE l.upload_id = _upload AND l.conta_codigo = ANY(_destinos);
  GET DIAGNOSTICS _apagadas = ROW_COUNT;

  INSERT INTO public.lancamentos_diario
    (tenant_id, company_id, upload_id, conta_codigo, data, competencia,
     historico, debito, credito, numero_lancamento)
  SELECT _tenant, _company, _upload, d.conta_padrao_codigo, l.data, l.competencia,
         nullif(btrim(l.historico), ''), l.debito, l.credito, l.numero
    FROM public.ecd_lancamento l
    JOIN public.depara_contas d
      ON d.tenant_id = _tenant AND d.company_id = _company
     AND d.conta_codigo = l.codigo
     AND d.conta_padrao_codigo = ANY(_destinos)
     AND NOT COALESCE(d.ignorada, false)
   WHERE l.importacao_id = _importacao_id
     AND (NOT COALESCE(l.encerramento, false)
      OR NOT EXISTS (
        SELECT 1 FROM public.plano_contas pa
         WHERE pa.tenant_id = _tenant AND pa.codigo = d.conta_padrao_codigo
           AND (pa.company_id IS NULL OR pa.company_id = _company)
           AND pa.tipo = '3-DRE'));
  GET DIAGNOSTICS _gravadas = ROW_COUNT;

  SELECT count(*) INTO _total FROM public.lancamentos_diario WHERE upload_id = _upload;

  RETURN jsonb_build_object('apagadas', _apagadas, 'gravadas', _gravadas,
                            'total', _total, 'upload_id', _upload);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ecd_rematerializar_destinos(uuid, text[]) TO authenticated;