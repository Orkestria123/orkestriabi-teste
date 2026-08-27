-- Sistemas de origem (ERP/contábil) e layout de colunas do arquivo.
-- O layout é do SISTEMA. O de-para continua por EMPRESA, para o Plano Padrão.

CREATE TABLE IF NOT EXISTS public.sistemas_contabeis (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  layout     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sistema_contabil_nome
  ON public.sistemas_contabeis (tenant_id, lower(nome));

COMMENT ON TABLE public.sistemas_contabeis IS
  'Sistema contábil de terceiro. O JSON layout diz como o arquivo dele vem '
  '(quais colunas são Classificação, Conta, Sub, Nome, Tipo, Nível, Cta. título, Estab., Valor). '
  'O de-para conta a conta é por empresa, não aqui.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sistemas_contabeis TO authenticated;
GRANT ALL ON public.sistemas_contabeis TO service_role;

ALTER TABLE public.sistemas_contabeis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sistemas_select" ON public.sistemas_contabeis;
CREATE POLICY "sistemas_select"
ON public.sistemas_contabeis FOR SELECT TO authenticated
USING (public.is_orkestria_admin() OR tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "sistemas_escrita" ON public.sistemas_contabeis;
CREATE POLICY "sistemas_escrita"
ON public.sistemas_contabeis FOR ALL TO authenticated
USING (
  public.is_orkestria_admin()
  OR (public.has_role(auth.uid(), 'tenant_admin') AND tenant_id = public.get_my_tenant_id())
)
WITH CHECK (
  public.is_orkestria_admin()
  OR (public.has_role(auth.uid(), 'tenant_admin') AND tenant_id = public.get_my_tenant_id())
);

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS sistema_id uuid REFERENCES public.sistemas_contabeis(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_companies_sistema ON public.companies(sistema_id);
