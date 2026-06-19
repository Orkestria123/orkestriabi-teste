
-- Adiciona hierarquia ao plano de contas
ALTER TABLE public.plano_contas
  ADD COLUMN IF NOT EXISTS is_sintetica boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conta_pai_classificacao text;

CREATE INDEX IF NOT EXISTS idx_plano_contas_pai_classif
  ON public.plano_contas(tenant_id, company_id, conta_pai_classificacao);

-- Estende saldos_abertura com metadados de origem (auditoria)
ALTER TABLE public.saldos_abertura
  ADD COLUMN IF NOT EXISTS classificacao text,
  ADD COLUMN IF NOT EXISTS valor_origem numeric(18,2),
  ADD COLUMN IF NOT EXISTS is_participante boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS upload_id uuid;

-- Garante chave única para upsert (company_id + conta_codigo + data_referencia)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'saldos_abertura_company_conta_data_key'
  ) THEN
    ALTER TABLE public.saldos_abertura
      ADD CONSTRAINT saldos_abertura_company_conta_data_key
      UNIQUE (company_id, conta_codigo, data_referencia);
  END IF;
END $$;

-- Tabela de uploads de saldo inicial (auditoria + status)
CREATE TABLE IF NOT EXISTS public.saldo_inicial_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  filename text NOT NULL,
  data_referencia date NOT NULL,
  total_contas integer NOT NULL DEFAULT 0,
  total_ativo numeric(18,2) NOT NULL DEFAULT 0,
  total_passivo_pl numeric(18,2) NOT NULL DEFAULT 0,
  diferenca numeric(18,2) NOT NULL DEFAULT 0,
  equilibrado boolean NOT NULL DEFAULT false,
  encoding text,
  status text NOT NULL DEFAULT 'processing',
  erro_detalhe text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saldo_inicial_uploads TO authenticated;
GRANT ALL ON public.saldo_inicial_uploads TO service_role;

ALTER TABLE public.saldo_inicial_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read saldo_inicial_uploads"
  ON public.saldo_inicial_uploads FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());

CREATE POLICY "tenant members write saldo_inicial_uploads"
  ON public.saldo_inicial_uploads FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin())
  WITH CHECK (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());

CREATE TRIGGER update_saldo_inicial_uploads_updated_at
  BEFORE UPDATE ON public.saldo_inicial_uploads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
