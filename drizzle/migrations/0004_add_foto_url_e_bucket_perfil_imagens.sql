ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS foto_url text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS foto_url text;

CREATE POLICY "perfil_imagens_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'perfil-imagens'
    AND (
      (select public.is_orkestria_admin())
      OR (storage.foldername(name))[1] = ((select public.get_my_tenant_id()))::text
    )
  );

CREATE POLICY "perfil_imagens_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'perfil-imagens'
    AND (
      (select public.is_orkestria_admin())
      OR (
        (storage.foldername(name))[1] = ((select public.get_my_tenant_id()))::text
        AND (select public.has_role(auth.uid(), 'tenant_admin'::public.app_role))
      )
    )
  );

CREATE POLICY "perfil_imagens_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'perfil-imagens'
    AND (
      (select public.is_orkestria_admin())
      OR (
        (storage.foldername(name))[1] = ((select public.get_my_tenant_id()))::text
        AND (select public.has_role(auth.uid(), 'tenant_admin'::public.app_role))
      )
    )
  );

CREATE POLICY "perfil_imagens_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'perfil-imagens'
    AND (
      (select public.is_orkestria_admin())
      OR (
        (storage.foldername(name))[1] = ((select public.get_my_tenant_id()))::text
        AND (select public.has_role(auth.uid(), 'tenant_admin'::public.app_role))
      )
    )
  );
