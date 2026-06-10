REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_orkestria_admin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_my_tenant_id() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_my_company_id() FROM anon, public;