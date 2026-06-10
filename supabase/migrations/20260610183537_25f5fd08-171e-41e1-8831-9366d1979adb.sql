REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, public, authenticated;