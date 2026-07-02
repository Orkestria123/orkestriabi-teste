
CREATE TABLE public.indicador_config_empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  indicador_key text NOT NULL,
  contas_por_termo jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibilidade text NOT NULL DEFAULT 'indicadores' CHECK (visibilidade IN ('indicadores','dashboard','ambos','invisivel')),
  ordem int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, indicador_key)
);

CREATE INDEX idx_indicador_config_empresa_company ON public.indicador_config_empresa(company_id);
CREATE INDEX idx_indicador_config_empresa_tenant ON public.indicador_config_empresa(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.indicador_config_empresa TO authenticated;
GRANT ALL ON public.indicador_config_empresa TO service_role;

ALTER TABLE public.indicador_config_empresa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read indicador_config"
  ON public.indicador_config_empresa FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

CREATE POLICY "tenant admins manage indicador_config"
  ON public.indicador_config_empresa FOR ALL
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND (public.has_role(auth.uid(), 'tenant_admin') OR public.has_role(auth.uid(), 'orkestria_admin'))
  )
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND (public.has_role(auth.uid(), 'tenant_admin') OR public.has_role(auth.uid(), 'orkestria_admin'))
  );

CREATE TRIGGER update_indicador_config_empresa_updated_at
  BEFORE UPDATE ON public.indicador_config_empresa
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
