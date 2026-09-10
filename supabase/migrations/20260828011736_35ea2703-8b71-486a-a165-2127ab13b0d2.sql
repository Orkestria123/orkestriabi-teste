ALTER FUNCTION public.plano_padrao_resumo(uuid) SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.plano_padrao_resumo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plano_padrao_resumo(uuid) TO authenticated, service_role;