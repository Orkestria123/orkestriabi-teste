
-- =====================================================
-- ORCAMENTO_CENARIOS (cabeçalho)
-- =====================================================
CREATE TABLE public.orcamento_cenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  orcamento_id uuid NOT NULL REFERENCES public.orcamentos(id) ON DELETE CASCADE,
  nome text NOT NULL,
  descricao text,
  origem text NOT NULL DEFAULT 'orcamento' CHECK (origem IN ('orcamento','cenario','realizado')),
  cenario_origem_id uuid REFERENCES public.orcamento_cenarios(id) ON DELETE SET NULL,
  criado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orcamento_cenarios_nome_nao_vazio CHECK (length(btrim(nome)) > 0)
);

CREATE INDEX idx_orcamento_cenarios_orcamento ON public.orcamento_cenarios(orcamento_id);
CREATE INDEX idx_orcamento_cenarios_company ON public.orcamento_cenarios(company_id);
CREATE INDEX idx_orcamento_cenarios_tenant ON public.orcamento_cenarios(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orcamento_cenarios TO authenticated;
GRANT ALL ON public.orcamento_cenarios TO service_role;

ALTER TABLE public.orcamento_cenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cenarios: select por tenant/empresa"
  ON public.orcamento_cenarios FOR SELECT TO authenticated
  USING (
    public.is_orkestria_admin()
    OR (tenant_id = public.get_my_tenant_id()
        AND (public.get_my_company_id() IS NULL OR company_id = public.get_my_company_id()))
  );

CREATE POLICY "Cenarios: insert por tenant/empresa"
  ON public.orcamento_cenarios FOR INSERT TO authenticated
  WITH CHECK (
    public.is_orkestria_admin()
    OR (tenant_id = public.get_my_tenant_id()
        AND (public.get_my_company_id() IS NULL OR company_id = public.get_my_company_id()))
  );

CREATE POLICY "Cenarios: update por tenant/empresa"
  ON public.orcamento_cenarios FOR UPDATE TO authenticated
  USING (
    public.is_orkestria_admin()
    OR (tenant_id = public.get_my_tenant_id()
        AND (public.get_my_company_id() IS NULL OR company_id = public.get_my_company_id()))
  )
  WITH CHECK (
    public.is_orkestria_admin()
    OR (tenant_id = public.get_my_tenant_id()
        AND (public.get_my_company_id() IS NULL OR company_id = public.get_my_company_id()))
  );

CREATE POLICY "Cenarios: delete por tenant/empresa"
  ON public.orcamento_cenarios FOR DELETE TO authenticated
  USING (
    public.is_orkestria_admin()
    OR (tenant_id = public.get_my_tenant_id()
        AND (public.get_my_company_id() IS NULL OR company_id = public.get_my_company_id()))
  );

CREATE TRIGGER trg_orcamento_cenarios_updated_at
  BEFORE UPDATE ON public.orcamento_cenarios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- ORCAMENTO_CENARIO_VALORES
-- =====================================================
CREATE TABLE public.orcamento_cenario_valores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cenario_id uuid NOT NULL REFERENCES public.orcamento_cenarios(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.orcamento_itens(id) ON DELETE CASCADE,
  competencia date NOT NULL,
  valor_orcado numeric(15,2) NOT NULL DEFAULT 0 CHECK (valor_orcado >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cenario_id, item_id, competencia)
);

CREATE INDEX idx_ocv_cenario ON public.orcamento_cenario_valores(cenario_id);
CREATE INDEX idx_ocv_item ON public.orcamento_cenario_valores(item_id);
CREATE INDEX idx_ocv_company ON public.orcamento_cenario_valores(company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orcamento_cenario_valores TO authenticated;
GRANT ALL ON public.orcamento_cenario_valores TO service_role;

ALTER TABLE public.orcamento_cenario_valores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cenario valores: select por tenant/empresa"
  ON public.orcamento_cenario_valores FOR SELECT TO authenticated
  USING (
    public.is_orkestria_admin()
    OR (tenant_id = public.get_my_tenant_id()
        AND (public.get_my_company_id() IS NULL OR company_id = public.get_my_company_id()))
  );

CREATE POLICY "Cenario valores: insert por tenant/empresa"
  ON public.orcamento_cenario_valores FOR INSERT TO authenticated
  WITH CHECK (
    public.is_orkestria_admin()
    OR (tenant_id = public.get_my_tenant_id()
        AND (public.get_my_company_id() IS NULL OR company_id = public.get_my_company_id()))
  );

CREATE POLICY "Cenario valores: update por tenant/empresa"
  ON public.orcamento_cenario_valores FOR UPDATE TO authenticated
  USING (
    public.is_orkestria_admin()
    OR (tenant_id = public.get_my_tenant_id()
        AND (public.get_my_company_id() IS NULL OR company_id = public.get_my_company_id()))
  )
  WITH CHECK (
    public.is_orkestria_admin()
    OR (tenant_id = public.get_my_tenant_id()
        AND (public.get_my_company_id() IS NULL OR company_id = public.get_my_company_id()))
  );

CREATE POLICY "Cenario valores: delete por tenant/empresa"
  ON public.orcamento_cenario_valores FOR DELETE TO authenticated
  USING (
    public.is_orkestria_admin()
    OR (tenant_id = public.get_my_tenant_id()
        AND (public.get_my_company_id() IS NULL OR company_id = public.get_my_company_id()))
  );

CREATE TRIGGER trg_orcamento_cenario_valores_updated_at
  BEFORE UPDATE ON public.orcamento_cenario_valores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
