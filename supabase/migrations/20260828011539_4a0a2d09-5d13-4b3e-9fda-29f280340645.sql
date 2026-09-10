CREATE OR REPLACE FUNCTION public.garantir_sinteticas_faltantes(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _separador text DEFAULT '.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $fn$
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.pode_gerenciar_tenant(_tenant_id)) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  RETURN public._garantir_sinteticas_interno(_tenant_id, _company_id, _separador);
END;
$fn$;
REVOKE ALL ON FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text) TO authenticated, service_role;