ALTER FUNCTION public._garantir_sinteticas_interno(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._garantir_sinteticas_interno(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._garantir_sinteticas_interno(uuid, uuid, text) TO service_role;