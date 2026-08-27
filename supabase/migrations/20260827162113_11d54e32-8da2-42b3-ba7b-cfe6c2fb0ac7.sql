CREATE OR REPLACE FUNCTION public.__apply_pending_sql(_sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  EXECUTE _sql;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.__apply_pending_sql(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.__apply_pending_sql(text) TO sandbox_exec;