CREATE TABLE public.grupos_economicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nome)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.grupos_economicos TO authenticated;
GRANT ALL ON public.grupos_economicos TO service_role;

ALTER TABLE public.grupos_economicos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grupos leitura" ON public.grupos_economicos
  FOR SELECT TO authenticated USING (public.pode_tenant(tenant_id));

CREATE POLICY "grupos escrita" ON public.grupos_economicos
  FOR ALL TO authenticated
  USING (public.pode_gerenciar_tenant(tenant_id))
  WITH CHECK (public.pode_gerenciar_tenant(tenant_id));

ALTER TABLE public.companies ADD COLUMN grupo_id uuid REFERENCES public.grupos_economicos(id) ON DELETE SET NULL;

CREATE INDEX idx_companies_grupo ON public.companies (grupo_id);