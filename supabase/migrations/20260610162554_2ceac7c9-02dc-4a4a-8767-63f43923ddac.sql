
-- Role enum
CREATE TYPE public.app_role AS ENUM ('orkestria_admin', 'tenant_admin', 'client');

-- TENANTS
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  plan text NOT NULL DEFAULT 'starter',
  max_companies int NOT NULL DEFAULT 5,
  max_users int NOT NULL DEFAULT 10,
  logo_url text,
  primary_color text NOT NULL DEFAULT '#6366F1',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- COMPANIES
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  cnpj text,
  razao_social text,
  regime_tributario text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_companies_tenant ON public.companies(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  full_name text,
  email text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_profiles_tenant ON public.profiles(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- USER ROLES (separate table for security)
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  UNIQUE(user_id, role)
);
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER helpers (avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_orkestria_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'orkestria_admin')
$$;

CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1
$$;

-- RLS POLICIES
-- Tenants
CREATE POLICY "Orkestria admins manage all tenants" ON public.tenants FOR ALL TO authenticated
  USING (public.is_orkestria_admin()) WITH CHECK (public.is_orkestria_admin());
CREATE POLICY "Users view their own tenant" ON public.tenants FOR SELECT TO authenticated
  USING (id = public.get_my_tenant_id());

-- Companies
CREATE POLICY "Orkestria admins view all companies" ON public.companies FOR SELECT TO authenticated
  USING (public.is_orkestria_admin());
CREATE POLICY "Tenant admins manage their companies" ON public.companies FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'tenant_admin'))
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'tenant_admin'));
CREATE POLICY "Clients view their own company" ON public.companies FOR SELECT TO authenticated
  USING (id = public.get_my_company_id());

-- Profiles
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Tenant admins view tenant profiles" ON public.profiles FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'tenant_admin'));
CREATE POLICY "Tenant admins manage tenant profiles" ON public.profiles FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'tenant_admin'))
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'tenant_admin'));
CREATE POLICY "Orkestria admins view all profiles" ON public.profiles FOR SELECT TO authenticated
  USING (public.is_orkestria_admin());

-- User roles
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Orkestria admins view all roles" ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_orkestria_admin());

-- SPED FILES
CREATE TABLE public.sped_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  filename text NOT NULL,
  file_url text,
  competencia_inicio date,
  competencia_fim date,
  status text NOT NULL DEFAULT 'processing',
  error_message text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX idx_sped_files_company ON public.sped_files(company_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sped_files TO authenticated;
GRANT ALL ON public.sped_files TO service_role;
ALTER TABLE public.sped_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant admins manage tenant sped files" ON public.sped_files FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'tenant_admin'))
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'tenant_admin'));
CREATE POLICY "Clients view own company sped files" ON public.sped_files FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());
CREATE POLICY "Orkestria admins view all sped files" ON public.sped_files FOR SELECT TO authenticated
  USING (public.is_orkestria_admin());

-- CHART OF ACCOUNTS
CREATE TABLE public.chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sped_file_id uuid REFERENCES public.sped_files(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  codigo_conta text NOT NULL,
  nome_conta text,
  nivel int,
  tipo_conta text,
  natureza text,
  parent_codigo text
);
CREATE INDEX idx_coa_company ON public.chart_of_accounts(company_id);
CREATE INDEX idx_coa_codigo ON public.chart_of_accounts(company_id, codigo_conta);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chart_of_accounts TO authenticated;
GRANT ALL ON public.chart_of_accounts TO service_role;
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant admins manage tenant coa" ON public.chart_of_accounts FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'tenant_admin'))
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'tenant_admin'));
CREATE POLICY "Clients view own company coa" ON public.chart_of_accounts FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

-- ACCOUNT BALANCES
CREATE TABLE public.account_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sped_file_id uuid REFERENCES public.sped_files(id) ON DELETE CASCADE,
  codigo_conta text NOT NULL,
  periodo date NOT NULL,
  saldo_inicial numeric DEFAULT 0,
  debitos numeric DEFAULT 0,
  creditos numeric DEFAULT 0,
  saldo_final numeric DEFAULT 0
);
CREATE INDEX idx_balances_company_periodo ON public.account_balances(company_id, periodo);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_balances TO authenticated;
GRANT ALL ON public.account_balances TO service_role;
ALTER TABLE public.account_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant admins manage tenant balances" ON public.account_balances FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'tenant_admin'))
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'tenant_admin'));
CREATE POLICY "Clients view own company balances" ON public.account_balances FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

-- FINANCIAL STATEMENTS
CREATE TABLE public.financial_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sped_file_id uuid REFERENCES public.sped_files(id) ON DELETE CASCADE,
  tipo_demonstracao text NOT NULL,
  periodo date NOT NULL,
  linha_ordem int,
  descricao text,
  codigo_conta text,
  valor numeric DEFAULT 0,
  nivel int DEFAULT 0,
  is_subtotal boolean DEFAULT false
);
CREATE INDEX idx_fs_company_period ON public.financial_statements(company_id, tipo_demonstracao, periodo);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_statements TO authenticated;
GRANT ALL ON public.financial_statements TO service_role;
ALTER TABLE public.financial_statements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant admins manage tenant statements" ON public.financial_statements FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'tenant_admin'))
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'tenant_admin'));
CREATE POLICY "Clients view own company statements" ON public.financial_statements FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

-- INDICATOR CONFIGS
CREATE TABLE public.indicator_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  nome text NOT NULL,
  formula text,
  categoria text,
  formato text DEFAULT 'percentual',
  meta_valor numeric,
  exibir_dashboard boolean DEFAULT true,
  ordem int DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.indicator_configs TO authenticated;
GRANT ALL ON public.indicator_configs TO service_role;
ALTER TABLE public.indicator_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant admins manage indicators" ON public.indicator_configs FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'tenant_admin'))
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'tenant_admin'));
CREATE POLICY "Clients view tenant indicators" ON public.indicator_configs FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

-- Auto-create profile trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
