CREATE TABLE public.dfc_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metodo_padrao text NOT NULL DEFAULT 'indireto',
  conta_caixa jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dfc_config TO authenticated;
GRANT ALL ON public.dfc_config TO service_role;
ALTER TABLE public.dfc_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dfc_config orkestria admin" ON public.dfc_config FOR ALL TO authenticated
  USING (public.is_orkestria_admin()) WITH CHECK (public.is_orkestria_admin());
CREATE POLICY "dfc_config tenant admin" ON public.dfc_config FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.get_my_role() = 'tenant_admin')
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.get_my_role() = 'tenant_admin');
CREATE POLICY "dfc_config client read" ON public.dfc_config FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

CREATE TABLE public.dfc_linha_contas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metodo text NOT NULL,
  linha text NOT NULL,
  contas jsonb NOT NULL DEFAULT '[]'::jsonb,
  operacao text NOT NULL DEFAULT 'soma',
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, metodo, linha)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dfc_linha_contas TO authenticated;
GRANT ALL ON public.dfc_linha_contas TO service_role;
ALTER TABLE public.dfc_linha_contas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dfc_linhas orkestria admin" ON public.dfc_linha_contas FOR ALL TO authenticated
  USING (public.is_orkestria_admin()) WITH CHECK (public.is_orkestria_admin());
CREATE POLICY "dfc_linhas tenant admin" ON public.dfc_linha_contas FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.get_my_role() = 'tenant_admin')
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.get_my_role() = 'tenant_admin');
CREATE POLICY "dfc_linhas client read" ON public.dfc_linha_contas FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

CREATE TRIGGER trg_dfc_config_updated BEFORE UPDATE ON public.dfc_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_dfc_linha_contas_updated BEFORE UPDATE ON public.dfc_linha_contas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();