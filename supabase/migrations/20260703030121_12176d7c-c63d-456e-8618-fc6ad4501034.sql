
CREATE TABLE public.indicadores_empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nome text NOT NULL,
  categoria text NOT NULL DEFAULT 'Personalizado',
  formula jsonb NOT NULL DEFAULT '{"expressao":[]}'::jsonb,
  modo_analise text NOT NULL DEFAULT 'numero',
  faixas jsonb,
  descricao text,
  visibilidade text NOT NULL DEFAULT 'indicadores',
  is_padrao boolean NOT NULL DEFAULT false,
  revisar_contas boolean NOT NULL DEFAULT false,
  ordem int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT indicadores_empresa_modo_chk CHECK (modo_analise IN ('numero','reais','percentual','ah_percent','ah_valor')),
  CONSTRAINT indicadores_empresa_vis_chk CHECK (visibilidade IN ('invisivel','indicadores','dashboard','ambos'))
);

CREATE INDEX idx_indicadores_empresa_company ON public.indicadores_empresa(company_id, ordem);
CREATE INDEX idx_indicadores_empresa_tenant ON public.indicadores_empresa(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.indicadores_empresa TO authenticated;
GRANT ALL ON public.indicadores_empresa TO service_role;

ALTER TABLE public.indicadores_empresa ENABLE ROW LEVEL SECURITY;

-- Leitura: Orkestria admin vê tudo; usuários do tenant veem os do próprio tenant.
CREATE POLICY "indic_emp_select"
ON public.indicadores_empresa FOR SELECT
TO authenticated
USING (
  public.is_orkestria_admin()
  OR tenant_id = public.get_my_tenant_id()
);

-- Escrita: Orkestria admin e tenant_admin do mesmo tenant.
CREATE POLICY "indic_emp_insert"
ON public.indicadores_empresa FOR INSERT
TO authenticated
WITH CHECK (
  public.is_orkestria_admin()
  OR (public.has_role(auth.uid(), 'tenant_admin') AND tenant_id = public.get_my_tenant_id())
);

CREATE POLICY "indic_emp_update"
ON public.indicadores_empresa FOR UPDATE
TO authenticated
USING (
  public.is_orkestria_admin()
  OR (public.has_role(auth.uid(), 'tenant_admin') AND tenant_id = public.get_my_tenant_id())
)
WITH CHECK (
  public.is_orkestria_admin()
  OR (public.has_role(auth.uid(), 'tenant_admin') AND tenant_id = public.get_my_tenant_id())
);

CREATE POLICY "indic_emp_delete"
ON public.indicadores_empresa FOR DELETE
TO authenticated
USING (
  public.is_orkestria_admin()
  OR (public.has_role(auth.uid(), 'tenant_admin') AND tenant_id = public.get_my_tenant_id())
);

CREATE TRIGGER trg_indicadores_empresa_updated
BEFORE UPDATE ON public.indicadores_empresa
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
