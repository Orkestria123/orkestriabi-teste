CREATE TABLE public.logs_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_nome text,
  user_tipo text,
  acao text NOT NULL,
  entidade text,
  entidade_id uuid,
  entidade_nome text,
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.logs_auditoria TO authenticated;
GRANT ALL ON public.logs_auditoria TO service_role;

ALTER TABLE public.logs_auditoria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins leem logs do tenant"
ON public.logs_auditoria
FOR SELECT
TO authenticated
USING (
  public.is_orkestria_admin()
  OR (
    tenant_id = public.get_my_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.tipo_usuario = 'admin_escritorio'
    )
  )
);

CREATE INDEX idx_logs_auditoria_tenant_created ON public.logs_auditoria (tenant_id, created_at DESC);
CREATE INDEX idx_logs_auditoria_acao ON public.logs_auditoria (tenant_id, acao);
