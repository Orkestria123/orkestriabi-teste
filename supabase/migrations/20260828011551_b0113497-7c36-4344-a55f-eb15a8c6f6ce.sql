REVOKE ALL ON FUNCTION public.plano_padrao_resumo(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dfc_cobertura(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plano_padrao_resumo(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dfc_cobertura(uuid, uuid) TO authenticated, service_role;