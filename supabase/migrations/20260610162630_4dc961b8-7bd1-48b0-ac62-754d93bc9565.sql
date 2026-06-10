
CREATE POLICY "Tenant admins manage own sped objects" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'sped-files'
    AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text
    AND public.has_role(auth.uid(), 'tenant_admin')
  )
  WITH CHECK (
    bucket_id = 'sped-files'
    AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text
    AND public.has_role(auth.uid(), 'tenant_admin')
  );

CREATE POLICY "Clients read own company sped objects" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'sped-files'
    AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text
  );
