
-- 1) user_roles: bloqueia escrita por usuários comuns; só orkestria_admin pode gerenciar
CREATE POLICY "Orkestria admins manage roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.is_orkestria_admin())
WITH CHECK (public.is_orkestria_admin());

-- 2) fiscal_invoices: SELECT explícito para clientes da própria empresa
CREATE POLICY "Clients view own company fiscal invoices"
ON public.fiscal_invoices
FOR SELECT
TO authenticated
USING (company_id = public.get_my_company_id());

-- 3) fiscal_invoice_items: SELECT explícito para clientes da própria empresa
CREATE POLICY "Clients view own company fiscal invoice items"
ON public.fiscal_invoice_items
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.fiscal_invoices i
  WHERE i.id = fiscal_invoice_items.invoice_id
    AND i.company_id = public.get_my_company_id()
));

-- 4) Storage: força validar tenant E company nas pastas do bucket sped-files
DROP POLICY IF EXISTS "Clients read own company sped objects" ON storage.objects;
CREATE POLICY "Clients read own company sped objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'sped-files'
  AND (storage.foldername(name))[1] = (public.get_my_tenant_id())::text
  AND (storage.foldername(name))[2] = (public.get_my_company_id())::text
);

DROP POLICY IF EXISTS "Tenant admins manage own sped objects" ON storage.objects;
CREATE POLICY "Tenant admins manage own sped objects"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'sped-files'
  AND (storage.foldername(name))[1] = (public.get_my_tenant_id())::text
  AND public.has_role(auth.uid(), 'tenant_admin'::public.app_role)
)
WITH CHECK (
  bucket_id = 'sped-files'
  AND (storage.foldername(name))[1] = (public.get_my_tenant_id())::text
  AND public.has_role(auth.uid(), 'tenant_admin'::public.app_role)
);

-- 5) Revoga EXECUTE de funções SECURITY DEFINER do papel anon
REVOKE EXECUTE ON FUNCTION public.is_orkestria_admin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_my_tenant_id() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_my_company_id() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.agregar_saldos_mensais(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.reverter_upload_diario(uuid) FROM anon, public;

-- Garante que o papel authenticated mantém EXECUTE no que precisa (RLS helpers e RPCs)
GRANT EXECUTE ON FUNCTION public.is_orkestria_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agregar_saldos_mensais(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverter_upload_diario(uuid) TO authenticated;
