
-- ============================================================
-- ORKESTRIA BI — Plano de Contas + Livro Diário (Fase 1: Schema)
-- ============================================================

-- 1) Tenant: modo do plano de contas (global vs por empresa)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS plano_contas_modo text NOT NULL DEFAULT 'empresa'
  CHECK (plano_contas_modo IN ('global','empresa'));

-- 2) Company: fonte de dados (legado SPED vs novo diário)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS fonte_dados text NOT NULL DEFAULT 'diario'
  CHECK (fonte_dados IN ('sped','diario'));

-- 3) updated_at helper (idempotente)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============================================================
-- PLANO DE CONTAS
-- ============================================================
CREATE TABLE public.plano_contas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  classificacao text NOT NULL,
  descricao text NOT NULL,
  tipo text NOT NULL,
  natureza text NOT NULL CHECK (natureza IN ('S','A')),
  nivel int NOT NULL DEFAULT 1,
  is_participante boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX plano_contas_unique
  ON public.plano_contas (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo);
CREATE INDEX plano_contas_lookup ON public.plano_contas (tenant_id, company_id, codigo);
CREATE INDEX plano_contas_classif ON public.plano_contas (tenant_id, company_id, classificacao);
CREATE INDEX plano_contas_estrutural ON public.plano_contas (tenant_id, company_id, is_participante);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plano_contas TO authenticated;
GRANT ALL ON public.plano_contas TO service_role;
ALTER TABLE public.plano_contas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plano_contas tenant read"
  ON public.plano_contas FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());
CREATE POLICY "plano_contas tenant write"
  ON public.plano_contas FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin())
  WITH CHECK (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());

CREATE TRIGGER trg_plano_contas_updated
  BEFORE UPDATE ON public.plano_contas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- DIARIO UPLOADS (controle)
-- ============================================================
CREATE TABLE public.diario_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  filename text NOT NULL,
  competencia_inicio date,
  competencia_fim date,
  total_lancamentos int NOT NULL DEFAULT 0,
  total_debitos numeric(15,2) NOT NULL DEFAULT 0,
  total_creditos numeric(15,2) NOT NULL DEFAULT 0,
  partidas_fechadas boolean,
  contas_desconhecidas int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','done','error')),
  erro_detalhe text,
  uploaded_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX diario_uploads_company ON public.diario_uploads (company_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.diario_uploads TO authenticated;
GRANT ALL ON public.diario_uploads TO service_role;
ALTER TABLE public.diario_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "diario_uploads tenant access"
  ON public.diario_uploads FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin())
  WITH CHECK (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());

CREATE TRIGGER trg_diario_uploads_updated
  BEFORE UPDATE ON public.diario_uploads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- LANCAMENTOS DIARIO (fonte da verdade)
-- ============================================================
CREATE TABLE public.lancamentos_diario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL REFERENCES public.diario_uploads(id) ON DELETE CASCADE,
  conta_codigo text NOT NULL,
  subconta_codigo text,
  data date NOT NULL,
  competencia date NOT NULL,
  historico text,
  debito numeric(15,2) NOT NULL DEFAULT 0,
  credito numeric(15,2) NOT NULL DEFAULT 0,
  grupo_lancamento text,
  lote text,
  numero_lancamento text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lanc_company_comp ON public.lancamentos_diario (company_id, competencia);
CREATE INDEX lanc_company_conta ON public.lancamentos_diario (company_id, conta_codigo, competencia);
CREATE INDEX lanc_upload ON public.lancamentos_diario (upload_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lancamentos_diario TO authenticated;
GRANT ALL ON public.lancamentos_diario TO service_role;
ALTER TABLE public.lancamentos_diario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lancamentos tenant access"
  ON public.lancamentos_diario FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin())
  WITH CHECK (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());

-- ============================================================
-- SALDOS MENSAIS (agregação para performance)
-- ============================================================
CREATE TABLE public.saldos_mensais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conta_codigo text NOT NULL,
  competencia date NOT NULL,
  total_debitos numeric(15,2) NOT NULL DEFAULT 0,
  total_creditos numeric(15,2) NOT NULL DEFAULT 0,
  movimento numeric(15,2) GENERATED ALWAYS AS (total_debitos - total_creditos) STORED,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, conta_codigo, competencia)
);
CREATE INDEX saldos_company_comp ON public.saldos_mensais (company_id, competencia);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saldos_mensais TO authenticated;
GRANT ALL ON public.saldos_mensais TO service_role;
ALTER TABLE public.saldos_mensais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saldos_mensais tenant access"
  ON public.saldos_mensais FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin())
  WITH CHECK (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());

-- ============================================================
-- SALDOS DE ABERTURA
-- ============================================================
CREATE TABLE public.saldos_abertura (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conta_codigo text NOT NULL,
  data_referencia date NOT NULL,
  saldo numeric(15,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, conta_codigo, data_referencia)
);
CREATE INDEX saldos_abertura_company ON public.saldos_abertura (company_id, data_referencia);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saldos_abertura TO authenticated;
GRANT ALL ON public.saldos_abertura TO service_role;
ALTER TABLE public.saldos_abertura ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saldos_abertura tenant access"
  ON public.saldos_abertura FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin())
  WITH CHECK (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());

-- ============================================================
-- MAPEAMENTO DEMONSTRACAO (DRE/BP/DFC)
-- ============================================================
CREATE TABLE public.mapeamento_demonstracao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  classificacao_prefixo text NOT NULL,
  tipo_demonstracao text NOT NULL CHECK (tipo_demonstracao IN ('DRE','BP_ATIVO','BP_PASSIVO','DFC')),
  linha_demonstracao text NOT NULL,
  ordem int NOT NULL DEFAULT 0,
  inverter_sinal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mapeamento_lookup ON public.mapeamento_demonstracao (tenant_id, company_id, tipo_demonstracao, ordem);
CREATE UNIQUE INDEX mapeamento_unique
  ON public.mapeamento_demonstracao (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), tipo_demonstracao, classificacao_prefixo);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mapeamento_demonstracao TO authenticated;
GRANT ALL ON public.mapeamento_demonstracao TO service_role;
ALTER TABLE public.mapeamento_demonstracao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mapeamento tenant access"
  ON public.mapeamento_demonstracao FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin())
  WITH CHECK (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());

CREATE TRIGGER trg_mapeamento_updated
  BEFORE UPDATE ON public.mapeamento_demonstracao
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- RPC: agregar saldos mensais após upload
-- ============================================================
CREATE OR REPLACE FUNCTION public.agregar_saldos_mensais(_upload_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.saldos_mensais (tenant_id, company_id, conta_codigo, competencia, total_debitos, total_creditos)
  SELECT tenant_id, company_id, conta_codigo, competencia,
         SUM(debito), SUM(credito)
  FROM public.lancamentos_diario
  WHERE upload_id = _upload_id
  GROUP BY tenant_id, company_id, conta_codigo, competencia
  ON CONFLICT (company_id, conta_codigo, competencia) DO UPDATE
    SET total_debitos = public.saldos_mensais.total_debitos + EXCLUDED.total_debitos,
        total_creditos = public.saldos_mensais.total_creditos + EXCLUDED.total_creditos,
        updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.agregar_saldos_mensais(uuid) TO authenticated, service_role;

-- ============================================================
-- RPC: limpar tudo de um upload (re-upload)
-- ============================================================
CREATE OR REPLACE FUNCTION public.reverter_upload_diario(_upload_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company uuid;
BEGIN
  SELECT company_id INTO _company FROM public.diario_uploads WHERE id = _upload_id;
  IF _company IS NULL THEN RETURN; END IF;

  -- subtrai do agregado o que este upload contribuiu
  WITH agg AS (
    SELECT conta_codigo, competencia, SUM(debito) d, SUM(credito) c
    FROM public.lancamentos_diario
    WHERE upload_id = _upload_id
    GROUP BY conta_codigo, competencia
  )
  UPDATE public.saldos_mensais s
     SET total_debitos = s.total_debitos - agg.d,
         total_creditos = s.total_creditos - agg.c,
         updated_at = now()
    FROM agg
   WHERE s.company_id = _company
     AND s.conta_codigo = agg.conta_codigo
     AND s.competencia = agg.competencia;

  DELETE FROM public.saldos_mensais
   WHERE company_id = _company
     AND total_debitos = 0 AND total_creditos = 0;

  DELETE FROM public.lancamentos_diario WHERE upload_id = _upload_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reverter_upload_diario(uuid) TO authenticated, service_role;
