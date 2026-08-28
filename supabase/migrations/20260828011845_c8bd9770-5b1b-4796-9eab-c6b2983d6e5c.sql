REVOKE ALL ON FUNCTION public._garantir_sinteticas_interno(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._garantir_sinteticas_interno(uuid, uuid, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text) TO authenticated, service_role;