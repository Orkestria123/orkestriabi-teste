
-- ============================================================
-- contas_gerenciais
-- ============================================================
CREATE TABLE public.contas_gerenciais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  descricao text NOT NULL,
  classificacao text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, codigo)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contas_gerenciais TO authenticated;
GRANT ALL ON public.contas_gerenciais TO service_role;

ALTER TABLE public.contas_gerenciais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orkestria_admin manages all contas_gerenciais"
  ON public.contas_gerenciais FOR ALL TO authenticated
  USING (public.is_orkestria_admin())
  WITH CHECK (public.is_orkestria_admin());

CREATE POLICY "tenant_admin manages contas_gerenciais of own tenant"
  ON public.contas_gerenciais FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'tenant_admin') AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (public.has_role(auth.uid(), 'tenant_admin') AND tenant_id = public.get_my_tenant_id());

CREATE POLICY "clients read contas_gerenciais of own company"
  ON public.contas_gerenciais FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND company_id = public.get_my_company_id()
  );

CREATE TRIGGER update_contas_gerenciais_updated_at
  BEFORE UPDATE ON public.contas_gerenciais
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_contas_gerenciais_company ON public.contas_gerenciais(company_id);

-- ============================================================
-- ajustes_gerenciais
-- ============================================================
CREATE TABLE public.ajustes_gerenciais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  competencia date NOT NULL,
  descricao text NOT NULL,
  justificativa text,
  conta_debito text NOT NULL,
  conta_credito text NOT NULL,
  valor numeric(15,2) NOT NULL,
  criado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ajustes_gerenciais_valor_positivo CHECK (valor > 0),
  CONSTRAINT ajustes_gerenciais_contas_distintas CHECK (conta_debito <> conta_credito)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ajustes_gerenciais TO authenticated;
GRANT ALL ON public.ajustes_gerenciais TO service_role;

ALTER TABLE public.ajustes_gerenciais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orkestria_admin manages all ajustes_gerenciais"
  ON public.ajustes_gerenciais FOR ALL TO authenticated
  USING (public.is_orkestria_admin())
  WITH CHECK (public.is_orkestria_admin());

CREATE POLICY "tenant_admin manages ajustes_gerenciais of own tenant"
  ON public.ajustes_gerenciais FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'tenant_admin') AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (public.has_role(auth.uid(), 'tenant_admin') AND tenant_id = public.get_my_tenant_id());

CREATE POLICY "clients read ajustes_gerenciais of own company"
  ON public.ajustes_gerenciais FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND company_id = public.get_my_company_id()
  );

CREATE TRIGGER update_ajustes_gerenciais_updated_at
  BEFORE UPDATE ON public.ajustes_gerenciais
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_ajustes_gerenciais_company_comp
  ON public.ajustes_gerenciais(company_id, competencia);
