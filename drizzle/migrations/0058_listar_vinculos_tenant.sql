CREATE OR REPLACE FUNCTION public.listar_vinculos_tenant(_tenant_id uuid)
RETURNS TABLE(user_id uuid, full_name text, email text, ativo_aqui boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.pode_gerenciar_tenant(_tenant_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  RETURN QUERY SELECT p.id, p.full_name, p.email, (p.tenant_id = _tenant_id)
  FROM public.tenant_usuarios tu JOIN public.profiles p ON p.id = tu.user_id
  WHERE tu.tenant_id = _tenant_id AND tu.role = 'tenant_admin';
END $$;
GRANT EXECUTE ON FUNCTION public.listar_vinculos_tenant(uuid) TO authenticated;