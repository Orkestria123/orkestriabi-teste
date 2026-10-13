CREATE TABLE public.tenant_usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'tenant_admin',
  tipo_usuario text NOT NULL DEFAULT 'admin_escritorio',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id)
);
GRANT SELECT ON public.tenant_usuarios TO authenticated;
GRANT ALL ON public.tenant_usuarios TO service_role;
ALTER TABLE public.tenant_usuarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuario ve seus vinculos" ON public.tenant_usuarios FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_orkestria_admin() OR public.pode_gerenciar_tenant(tenant_id));

INSERT INTO public.tenant_usuarios (user_id, tenant_id, role, tipo_usuario)
SELECT p.id, p.tenant_id, COALESCE(ur.role, 'client'), p.tipo_usuario
FROM public.profiles p
LEFT JOIN LATERAL (SELECT role FROM public.user_roles r WHERE r.user_id = p.id AND r.role <> 'orkestria_admin' LIMIT 1) ur ON true
WHERE p.tenant_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE POLICY "Usuarios veem escritorios vinculados" ON public.tenants FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_usuarios tu WHERE tu.tenant_id = tenants.id AND tu.user_id = auth.uid()));

-- Novos usuários entram automaticamente na lista de vínculos.
CREATE OR REPLACE FUNCTION public.tg_registrar_vinculo_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role <> 'orkestria_admin' AND NEW.tenant_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.user_id) THEN
    INSERT INTO public.tenant_usuarios (user_id, tenant_id, role, tipo_usuario)
    VALUES (NEW.user_id, NEW.tenant_id, NEW.role,
      CASE WHEN NEW.role = 'client' THEN 'cliente' ELSE 'admin_escritorio' END)
    ON CONFLICT (user_id, tenant_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER registrar_vinculo_tenant AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.tg_registrar_vinculo_tenant();

-- Troca o escritório ativo do usuário logado (só para escritórios vinculados).
CREATE OR REPLACE FUNCTION public.alternar_tenant_ativo(_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.tenant_usuarios;
BEGIN
  SELECT * INTO v FROM public.tenant_usuarios WHERE user_id = auth.uid() AND tenant_id = _tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sem acesso a este escritório'; END IF;
  UPDATE public.profiles SET tenant_id = _tenant_id, tipo_usuario = v.tipo_usuario,
    company_id = CASE WHEN tenant_id = _tenant_id THEN company_id ELSE NULL END, updated_at = now()
  WHERE id = auth.uid();
  UPDATE public.user_roles SET tenant_id = _tenant_id, role = v.role
  WHERE user_id = auth.uid() AND role <> 'orkestria_admin';
END $$;
GRANT EXECUTE ON FUNCTION public.alternar_tenant_ativo(uuid) TO authenticated;

-- Admin do escritório (ou Orkestria) vincula um colaborador já existente, pelo e-mail.
CREATE OR REPLACE FUNCTION public.vincular_colaborador_tenant(_email text, _tenant_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid;
BEGIN
  IF NOT public.pode_gerenciar_tenant(_tenant_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT id INTO uid FROM public.profiles WHERE lower(email) = lower(trim(_email)) LIMIT 1;
  IF uid IS NULL THEN RAISE EXCEPTION 'Nenhum usuário com este e-mail'; END IF;
  INSERT INTO public.tenant_usuarios (user_id, tenant_id, role, tipo_usuario)
  VALUES (uid, _tenant_id, 'tenant_admin', 'admin_escritorio')
  ON CONFLICT (user_id, tenant_id) DO NOTHING;
  RETURN uid;
END $$;
GRANT EXECUTE ON FUNCTION public.vincular_colaborador_tenant(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.desvincular_colaborador_tenant(_user_id uuid, _tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.pode_gerenciar_tenant(_tenant_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND tenant_id = _tenant_id) THEN
    RAISE EXCEPTION 'Este é o escritório ativo do usuário; ele precisa trocar antes';
  END IF;
  DELETE FROM public.tenant_usuarios WHERE user_id = _user_id AND tenant_id = _tenant_id;
END $$;
GRANT EXECUTE ON FUNCTION public.desvincular_colaborador_tenant(uuid, uuid) TO authenticated;