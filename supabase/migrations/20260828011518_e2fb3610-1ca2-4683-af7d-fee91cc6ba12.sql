REVOKE ALL ON FUNCTION public._garantir_sinteticas_interno(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._garantir_sinteticas_interno(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public._garantir_sinteticas_interno(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._garantir_sinteticas_interno(uuid, uuid, text) TO service_role;