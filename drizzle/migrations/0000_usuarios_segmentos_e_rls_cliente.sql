-- 1. Tipos de usuário -------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tipo_usuario text NOT NULL DEFAULT 'admin_escritorio',
  ADD COLUMN IF NOT EXISTS telefone text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_tipo_usuario_chk
    CHECK (tipo_usuario IN ('admin_escritorio','cliente'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Segmentos --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.segmentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nome)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.segmentos TO authenticated;
GRANT ALL ON public.segmentos TO service_role;
ALTER TABLE public.segmentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "segmentos leitura" ON public.segmentos;
CREATE POLICY "segmentos leitura" ON public.segmentos FOR SELECT TO authenticated
  USING (public.pode_tenant(tenant_id));
DROP POLICY IF EXISTS "segmentos escrita" ON public.segmentos;
CREATE POLICY "segmentos escrita" ON public.segmentos FOR ALL TO authenticated
  USING (public.pode_gerenciar_tenant(tenant_id))
  WITH CHECK (public.pode_gerenciar_tenant(tenant_id));

-- 3. Vínculo cliente <-> empresa -------------------------------------------
CREATE TABLE IF NOT EXISTS public.usuario_empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id)
);
CREATE INDEX IF NOT EXISTS usuario_empresas_user_idx ON public.usuario_empresas(user_id);
CREATE INDEX IF NOT EXISTS usuario_empresas_company_idx ON public.usuario_empresas(company_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.usuario_empresas TO authenticated;
GRANT ALL ON public.usuario_empresas TO service_role;
ALTER TABLE public.usuario_empresas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "usuario_empresas leitura" ON public.usuario_empresas;
CREATE POLICY "usuario_empresas leitura" ON public.usuario_empresas FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.pode_gerenciar_tenant(tenant_id));
DROP POLICY IF EXISTS "usuario_empresas escrita" ON public.usuario_empresas;
CREATE POLICY "usuario_empresas escrita" ON public.usuario_empresas FOR ALL TO authenticated
  USING (public.pode_gerenciar_tenant(tenant_id))
  WITH CHECK (public.pode_gerenciar_tenant(tenant_id));

-- 4. Campos novos em empresas ----------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS site text,
  ADD COLUMN IF NOT EXISTS segmento_id uuid REFERENCES public.segmentos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS porte text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS perfil_ia text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- triggers updated_at
DROP TRIGGER IF EXISTS segmentos_updated_at ON public.segmentos;
CREATE TRIGGER segmentos_updated_at BEFORE UPDATE ON public.segmentos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS companies_updated_at ON public.companies;
CREATE TRIGGER companies_updated_at BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Funções de acesso ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sou_cliente()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT tipo_usuario = 'cliente' FROM public.profiles WHERE id = auth.uid()), false)
$$;

CREATE OR REPLACE FUNCTION public.pode_ler_empresa(_company_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _tenant_da_empresa uuid;
BEGIN
  IF _company_id IS NULL THEN RETURN false; END IF;
  IF public.is_orkestria_admin() THEN RETURN true; END IF;
  SELECT tenant_id INTO _tenant_da_empresa FROM public.companies WHERE id = _company_id;
  IF _tenant_da_empresa IS NULL OR _tenant_da_empresa IS DISTINCT FROM public.get_my_tenant_id() THEN
    RETURN false;
  END IF;
  IF public.sou_cliente() THEN
    RETURN EXISTS (
      SELECT 1 FROM public.usuario_empresas ue
      WHERE ue.user_id = auth.uid() AND ue.company_id = _company_id
    );
  END IF;
  -- compatibilidade: perfil preso a uma única empresa
  IF public.get_my_company_id() IS NOT NULL
     AND public.get_my_company_id() IS DISTINCT FROM _company_id THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.pode_acessar_empresa(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.pode_ler_empresa(_company_id)
$$;

CREATE OR REPLACE FUNCTION public.pode_gerenciar_empresa(_company_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _t uuid;
BEGIN
  IF _company_id IS NULL THEN RETURN false; END IF;
  IF public.is_orkestria_admin() THEN RETURN true; END IF;
  SELECT tenant_id INTO _t FROM public.companies WHERE id = _company_id;
  RETURN public.pode_gerenciar_tenant(_t);
END;
$$;

-- leitura de config de nível tenant (sem empresa): cliente também pode ler
CREATE OR REPLACE FUNCTION public.pode_ler_tenant(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.pode_tenant(_tenant_id)
$$;

-- 6. Backfill: usuários com papel 'client' viram tipo 'cliente' -------------
UPDATE public.profiles p SET tipo_usuario = 'cliente'
WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'client');

INSERT INTO public.usuario_empresas (tenant_id, user_id, company_id)
SELECT p.tenant_id, p.id, p.company_id
FROM public.profiles p
WHERE p.tipo_usuario = 'cliente' AND p.company_id IS NOT NULL AND p.tenant_id IS NOT NULL
ON CONFLICT (user_id, company_id) DO NOTHING;

-- 7. RLS uniforme nas tabelas de dados por empresa --------------------------
DO $$
DECLARE
  t text;
  pol record;
  tem_tenant boolean;
  tem_company boolean;
  leitura text;
  escrita text;
  tabelas text[] := ARRAY[
    'account_balances','ajustes_gerenciais','chart_of_accounts','contas_gerenciais',
    'dashboard_config','depara_contas','depara_regras','dfc_config','dfc_linha_contas',
    'dfc_vinculo','diario_uploads','ecd_importacao','financial_statements',
    'fiscal_invoices','fiscal_participants','indicador_alocacao','indicador_config_empresa',
    'indicadores_empresa','indicator_configs','lancamentos_diario','mascara_classificacao',
    'orcamento_cenario_valores','orcamento_cenarios','orcamento_itens','orcamento_valores',
    'orcamentos','plano_atualizacoes','plano_contas','saldo_inicial_uploads',
    'saldos_abertura','saldos_mensais','sped_files'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name=t AND column_name='tenant_id'),
           EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name=t AND column_name='company_id')
      INTO tem_tenant, tem_company;

    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;

    IF tem_company AND tem_tenant THEN
      leitura := 'public.pode_ler_empresa(company_id) OR (company_id IS NULL AND public.pode_ler_tenant(tenant_id))';
    ELSIF tem_company THEN
      leitura := 'public.pode_ler_empresa(company_id)';
    ELSE
      leitura := 'public.pode_ler_tenant(tenant_id)';
    END IF;

    IF tem_tenant THEN
      escrita := 'public.pode_gerenciar_tenant(tenant_id)';
    ELSE
      escrita := 'public.pode_gerenciar_empresa(company_id)';
    END IF;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',
      t||'_leitura', t, leitura);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
      t||'_escrita', t, escrita, escrita);

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- companies: leitura por vínculo, escrita por tenant_admin
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='companies' LOOP
    EXECUTE format('DROP POLICY %I ON public.companies', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY companies_leitura ON public.companies FOR SELECT TO authenticated
  USING (public.pode_ler_empresa(id));
CREATE POLICY companies_escrita ON public.companies FOR ALL TO authenticated
  USING (public.pode_gerenciar_tenant(tenant_id))
  WITH CHECK (public.pode_gerenciar_tenant(tenant_id));

-- tabelas filhas (sem company_id próprio)
DO $$
DECLARE pol record; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ecd_conta','ecd_lancamento','ecd_saldo','fiscal_invoice_items'] LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;
  END LOOP;
END $$;

CREATE POLICY ecd_conta_leitura ON public.ecd_conta FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ecd_importacao i WHERE i.id = importacao_id AND public.pode_ler_empresa(i.company_id)));
CREATE POLICY ecd_conta_escrita ON public.ecd_conta FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ecd_importacao i WHERE i.id = importacao_id AND public.pode_gerenciar_tenant(i.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ecd_importacao i WHERE i.id = importacao_id AND public.pode_gerenciar_tenant(i.tenant_id)));

CREATE POLICY ecd_lancamento_leitura ON public.ecd_lancamento FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ecd_importacao i WHERE i.id = importacao_id AND public.pode_ler_empresa(i.company_id)));
CREATE POLICY ecd_lancamento_escrita ON public.ecd_lancamento FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ecd_importacao i WHERE i.id = importacao_id AND public.pode_gerenciar_tenant(i.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ecd_importacao i WHERE i.id = importacao_id AND public.pode_gerenciar_tenant(i.tenant_id)));

CREATE POLICY ecd_saldo_leitura ON public.ecd_saldo FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ecd_importacao i WHERE i.id = importacao_id AND public.pode_ler_empresa(i.company_id)));
CREATE POLICY ecd_saldo_escrita ON public.ecd_saldo FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ecd_importacao i WHERE i.id = importacao_id AND public.pode_gerenciar_tenant(i.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ecd_importacao i WHERE i.id = importacao_id AND public.pode_gerenciar_tenant(i.tenant_id)));

CREATE POLICY fiscal_invoice_items_leitura ON public.fiscal_invoice_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.fiscal_invoices f WHERE f.id = invoice_id AND public.pode_ler_empresa(f.company_id)));
CREATE POLICY fiscal_invoice_items_escrita ON public.fiscal_invoice_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.fiscal_invoices f WHERE f.id = invoice_id AND public.pode_gerenciar_empresa(f.company_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.fiscal_invoices f WHERE f.id = invoice_id AND public.pode_gerenciar_empresa(f.company_id)));
