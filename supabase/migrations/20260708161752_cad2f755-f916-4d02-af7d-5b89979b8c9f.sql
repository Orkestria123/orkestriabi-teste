
-- Orcamentos header
CREATE TABLE public.orcamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nome text NOT NULL,
  ano int NOT NULL,
  tipo_base text NOT NULL DEFAULT 'zero' CHECK (tipo_base IN ('zero','historico')),
  periodo_base_inicio date,
  periodo_base_fim date,
  realizado_visao text NOT NULL DEFAULT 'gerencial' CHECK (realizado_visao IN ('contabil','gerencial')),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','ativo','fechado')),
  criado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, ano)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orcamentos TO authenticated;
GRANT ALL ON public.orcamentos TO service_role;
ALTER TABLE public.orcamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orkestria_admin manages all orcamentos" ON public.orcamentos
  FOR ALL USING (is_orkestria_admin()) WITH CHECK (is_orkestria_admin());
CREATE POLICY "tenant_admin manages orcamentos of own tenant" ON public.orcamentos
  FOR ALL USING (has_role(auth.uid(), 'tenant_admin'::app_role) AND tenant_id = get_my_tenant_id())
  WITH CHECK (has_role(auth.uid(), 'tenant_admin'::app_role) AND tenant_id = get_my_tenant_id());
CREATE POLICY "clients read orcamentos of own company" ON public.orcamentos
  FOR SELECT USING (tenant_id = get_my_tenant_id() AND company_id = get_my_company_id());

CREATE TRIGGER update_orcamentos_updated_at BEFORE UPDATE ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Itens
CREATE TABLE public.orcamento_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  orcamento_id uuid NOT NULL REFERENCES public.orcamentos(id) ON DELETE CASCADE,
  rotulo text NOT NULL,
  contas jsonb NOT NULL DEFAULT '[]'::jsonb,
  tipo_conta text CHECK (tipo_conta IN ('receita','despesa','custo','ativo','passivo')),
  ordem int,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orcamento_itens TO authenticated;
GRANT ALL ON public.orcamento_itens TO service_role;
ALTER TABLE public.orcamento_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orkestria_admin manages all orcamento_itens" ON public.orcamento_itens
  FOR ALL USING (is_orkestria_admin()) WITH CHECK (is_orkestria_admin());
CREATE POLICY "tenant_admin manages orcamento_itens of own tenant" ON public.orcamento_itens
  FOR ALL USING (has_role(auth.uid(), 'tenant_admin'::app_role) AND tenant_id = get_my_tenant_id())
  WITH CHECK (has_role(auth.uid(), 'tenant_admin'::app_role) AND tenant_id = get_my_tenant_id());
CREATE POLICY "clients read orcamento_itens of own company" ON public.orcamento_itens
  FOR SELECT USING (tenant_id = get_my_tenant_id() AND company_id = get_my_company_id());

CREATE INDEX idx_orcamento_itens_orcamento ON public.orcamento_itens(orcamento_id);

-- Valores
CREATE TABLE public.orcamento_valores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  orcamento_id uuid NOT NULL REFERENCES public.orcamentos(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.orcamento_itens(id) ON DELETE CASCADE,
  competencia date NOT NULL,
  valor_orcado numeric(15,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, competencia)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orcamento_valores TO authenticated;
GRANT ALL ON public.orcamento_valores TO service_role;
ALTER TABLE public.orcamento_valores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orkestria_admin manages all orcamento_valores" ON public.orcamento_valores
  FOR ALL USING (is_orkestria_admin()) WITH CHECK (is_orkestria_admin());
CREATE POLICY "tenant_admin manages orcamento_valores of own tenant" ON public.orcamento_valores
  FOR ALL USING (has_role(auth.uid(), 'tenant_admin'::app_role) AND tenant_id = get_my_tenant_id())
  WITH CHECK (has_role(auth.uid(), 'tenant_admin'::app_role) AND tenant_id = get_my_tenant_id());
CREATE POLICY "clients read orcamento_valores of own company" ON public.orcamento_valores
  FOR SELECT USING (tenant_id = get_my_tenant_id() AND company_id = get_my_company_id());

CREATE TRIGGER update_orcamento_valores_updated_at BEFORE UPDATE ON public.orcamento_valores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_orcamento_valores_orcamento_comp ON public.orcamento_valores(orcamento_id, competencia);
