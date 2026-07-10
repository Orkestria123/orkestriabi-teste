
CREATE TABLE public.dashboard_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bloco text NOT NULL,
  visivel boolean NOT NULL DEFAULT true,
  ordem int NOT NULL DEFAULT 0,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, bloco)
);

CREATE INDEX idx_dashboard_config_company ON public.dashboard_config(company_id, ordem);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_config TO authenticated;
GRANT ALL ON public.dashboard_config TO service_role;

ALTER TABLE public.dashboard_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dashboard_config tenant read"
  ON public.dashboard_config FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());

CREATE POLICY "dashboard_config tenant insert"
  ON public.dashboard_config FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());

CREATE POLICY "dashboard_config tenant update"
  ON public.dashboard_config FOR UPDATE
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin())
  WITH CHECK (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());

CREATE POLICY "dashboard_config tenant delete"
  ON public.dashboard_config FOR DELETE
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());

CREATE TRIGGER update_dashboard_config_updated_at
  BEFORE UPDATE ON public.dashboard_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
