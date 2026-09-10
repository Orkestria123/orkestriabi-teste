REVOKE EXECUTE ON FUNCTION public.plano_padrao_resumo(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.dfc_cobertura(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public._garantir_sinteticas_interno(uuid, uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.plano_padrao_resumo(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dfc_cobertura(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text) TO authenticated, service_role;