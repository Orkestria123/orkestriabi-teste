CREATE TABLE public.relatorio_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  secoes jsonb NOT NULL DEFAULT '[]'::jsonb,
  textos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relatorio_modelos TO authenticated;
GRANT ALL ON public.relatorio_modelos TO service_role;
ALTER TABLE public.relatorio_modelos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "escritorio gerencia modelo" ON public.relatorio_modelos FOR ALL TO authenticated
  USING (public.is_orkestria_admin() OR (tenant_id = public.get_my_tenant_id() AND NOT public.sou_cliente()))
  WITH CHECK (public.is_orkestria_admin() OR (tenant_id = public.get_my_tenant_id() AND NOT public.sou_cliente()));

CREATE TABLE public.relatorios_executivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  competencia date NOT NULL,
  titulo text NOT NULL DEFAULT 'Relatório Executivo',
  conteudo jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'rascunho',
  pdf_path text,
  disponibilizado_em timestamptz,
  disponibilizado_por uuid,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_relatorios_exec_company ON public.relatorios_executivos(company_id, competencia DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relatorios_executivos TO authenticated;
GRANT ALL ON public.relatorios_executivos TO service_role;
ALTER TABLE public.relatorios_executivos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "escritorio gerencia relatorios" ON public.relatorios_executivos FOR ALL TO authenticated
  USING (public.is_orkestria_admin() OR (tenant_id = public.get_my_tenant_id() AND NOT public.sou_cliente()))
  WITH CHECK (public.is_orkestria_admin() OR (tenant_id = public.get_my_tenant_id() AND NOT public.sou_cliente()));
CREATE POLICY "cliente le relatorios disponibilizados" ON public.relatorios_executivos FOR SELECT TO authenticated
  USING (status = 'disponibilizado' AND public.pode_ler_empresa(company_id));

CREATE TABLE public.relatorio_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  relatorio_id uuid NOT NULL REFERENCES public.relatorios_executivos(id) ON DELETE CASCADE,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  detalhe text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relatorio_envios TO authenticated;
GRANT ALL ON public.relatorio_envios TO service_role;
ALTER TABLE public.relatorio_envios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "escritorio gerencia envios" ON public.relatorio_envios FOR ALL TO authenticated
  USING (public.is_orkestria_admin() OR (tenant_id = public.get_my_tenant_id() AND NOT public.sou_cliente()))
  WITH CHECK (public.is_orkestria_admin() OR (tenant_id = public.get_my_tenant_id() AND NOT public.sou_cliente()));

CREATE TRIGGER trg_relatorio_modelos_upd BEFORE UPDATE ON public.relatorio_modelos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_relatorios_exec_upd BEFORE UPDATE ON public.relatorios_executivos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- E-mails dos usuários com acesso à empresa (para a tela de confirmação)
CREATE OR REPLACE FUNCTION public.emails_com_acesso_empresa(_company_id uuid)
RETURNS TABLE(user_id uuid, nome text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT p.id, p.full_name, p.email
  FROM public.profiles p
  JOIN public.companies c ON c.id = _company_id
  WHERE (public.is_orkestria_admin() OR (c.tenant_id = public.get_my_tenant_id() AND NOT public.sou_cliente()))
    AND p.tenant_id = c.tenant_id
    AND p.email IS NOT NULL
    AND p.tipo_usuario = 'cliente'
    AND (p.company_id = _company_id OR EXISTS (
      SELECT 1 FROM public.usuario_empresas ue WHERE ue.user_id = p.id AND ue.company_id = _company_id))
$$;
GRANT EXECUTE ON FUNCTION public.emails_com_acesso_empresa(uuid) TO authenticated;

-- Storage: PDFs em relatorios/{tenant}/{company}/{arquivo}.pdf
CREATE POLICY "relatorios escritorio escreve" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'relatorios' AND (public.is_orkestria_admin() OR ((storage.foldername(name))[1] = public.get_my_tenant_id()::text AND NOT public.sou_cliente())))
  WITH CHECK (bucket_id = 'relatorios' AND (public.is_orkestria_admin() OR ((storage.foldername(name))[1] = public.get_my_tenant_id()::text AND NOT public.sou_cliente())));
CREATE POLICY "relatorios cliente le" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'relatorios' AND public.pode_ler_empresa(((storage.foldername(name))[2])::uuid));