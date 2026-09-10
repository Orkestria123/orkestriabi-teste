GRANT EXECUTE ON FUNCTION public.plano_padrao_resumo(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dfc_cobertura(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text) TO authenticated, service_role;