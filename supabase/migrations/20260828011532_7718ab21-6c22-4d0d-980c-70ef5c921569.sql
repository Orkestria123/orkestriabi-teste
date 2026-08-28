REVOKE ALL ON FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text) TO authenticated, service_role;