ALTER FUNCTION public.dfc_cobertura(uuid, uuid) SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.dfc_cobertura(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dfc_cobertura(uuid, uuid) TO authenticated, service_role;