CREATE OR REPLACE FUNCTION public.ecd_materializar_lote(_importacao_id uuid, _depois bigint DEFAULT 0, _limite integer DEFAULT 2000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  _tenant uuid; _company uuid; _arquivo text; _upload uuid;
  _n int := 0; _ultimo bigint;
BEGIN
  SELECT i.tenant_id, i.company_id, i.arquivo_nome
    INTO _tenant, _company, _arquivo
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT id INTO _upload FROM public.diario_uploads
   WHERE company_id = _company AND filename = 'ECD: ' || _arquivo
   LIMIT 1;
  IF _upload IS NULL THEN
    RAISE EXCEPTION 'Diário do ECD ainda não foi preparado';
  END IF;

  WITH lote AS (
    SELECT l.seq, l.numero, l.data, l.competencia, l.codigo, l.debito, l.credito, l.historico,
           l.encerramento
      FROM public.ecd_lancamento l
     WHERE l.importacao_id = _importacao_id
       AND l.seq > COALESCE(_depois, 0)
     ORDER BY l.seq
     LIMIT GREATEST(1, LEAST(COALESCE(_limite, 2000), 5000))
  ),
  gravadas AS (
    INSERT INTO public.lancamentos_diario
      (tenant_id, company_id, upload_id, conta_codigo, data, competencia,
       historico, debito, credito, numero_lancamento)
    SELECT _tenant, _company, _upload, d.conta_padrao_codigo, l.data, l.competencia,
           nullif(btrim(l.historico), ''), l.debito, l.credito, l.numero
      FROM lote l
      JOIN public.depara_contas d
        ON d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_codigo = l.codigo
       AND d.conta_padrao_codigo IS NOT NULL
       AND NOT COALESCE(d.ignorada, false)
     WHERE NOT COALESCE(l.encerramento, false)
        OR NOT EXISTS (
          SELECT 1 FROM public.plano_contas pa
           WHERE pa.tenant_id = _tenant AND pa.codigo = d.conta_padrao_codigo
             AND (pa.company_id IS NULL OR pa.company_id = _company)
             AND pa.tipo = '3-DRE')
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM gravadas), (SELECT max(seq) FROM lote)
    INTO _n, _ultimo;

  RETURN jsonb_build_object(
    'gravadas', COALESCE(_n, 0),
    'ultimo_seq', COALESCE(_ultimo, _depois),
    'upload_id', _upload);
END;
$function$;