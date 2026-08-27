-- Tirar do dashboard não pode gravar ordem NULL por cima da ordem existente.

CREATE OR REPLACE FUNCTION public.indicador_alocar(_company_id uuid, _itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _tenant uuid; _n int := 0;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para alocar indicadores desta empresa';
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;

  WITH entrada AS (
    SELECT DISTINCT ON (x.indicador_id) x.*
      FROM jsonb_to_recordset(_itens)
        AS x(indicador_id uuid, visibilidade text, ordem int)
     WHERE x.indicador_id IS NOT NULL
     ORDER BY x.indicador_id
  ),
  gravadas AS (
    INSERT INTO public.indicador_alocacao
      (tenant_id, company_id, indicador_id, visibilidade, ordem)
    SELECT _tenant, _company_id, e.indicador_id,
           COALESCE(e.visibilidade, 'indicadores'), e.ordem
      FROM entrada e
      JOIN public.indicadores_empresa i ON i.id = e.indicador_id
     WHERE i.tenant_id = _tenant
       AND (i.company_id IS NULL OR i.company_id = _company_id)
    ON CONFLICT (company_id, indicador_id) DO UPDATE SET
      visibilidade = EXCLUDED.visibilidade,
      ordem        = COALESCE(EXCLUDED.ordem, public.indicador_alocacao.ordem),
      updated_at   = now()
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM gravadas;

  RETURN jsonb_build_object('gravadas', _n);
END;
$fn$;
