CREATE OR REPLACE FUNCTION public.carimbo_dados_empresa(_company_id uuid)
RETURNS TABLE(linhas bigint, atualizado_em timestamp with time zone)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    COUNT(s.*)::bigint AS linhas,
    GREATEST(
      MAX(s.updated_at),
      (
        SELECT MAX(i.updated_at)
        FROM public.indicadores_empresa i
        JOIN public.companies c ON c.id = _company_id
        WHERE i.tenant_id = c.tenant_id
          AND i.company_id IS NULL
          AND lower(regexp_replace(i.nome, '[^[:alnum:]]', '', 'g')) IN ('ebit', 'ebitda')
      )
    ) AS atualizado_em
  FROM public.saldos_mensais s
  WHERE s.company_id = _company_id
$function$;