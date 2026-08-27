-- ============================================================
-- Orkestria BI: otimizacao de performance de RLS
--
-- Envolve auth.uid() e as funcoes STABLE SECURITY DEFINER
-- (has_role, is_orkestria_admin, get_my_tenant_id, get_my_company_id)
-- em subselects (select ...) nas policies. Sem isso, o Postgres
-- reavalia a funcao uma vez POR LINHA verificada; com o wrap, o
-- planner trata como InitPlan e avalia uma unica vez por consulta.
-- Mesma logica de autorizacao de cada policy é preservada -- so a
-- forma de chamar as funcoes muda. Ver referencia oficial:
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select-statements
-- ============================================================

-- ---------- public.tenants ----------
DROP POLICY IF EXISTS "Orkestria admins manage all tenants" ON public.tenants;
CREATE POLICY "Orkestria admins manage all tenants"
  ON public.tenants FOR ALL TO authenticated
  USING ((select public.is_orkestria_admin()))
  WITH CHECK ((select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "Users view their own tenant" ON public.tenants;
CREATE POLICY "Users view their own tenant"
  ON public.tenants FOR SELECT TO authenticated
  USING (id = (select public.get_my_tenant_id()));

-- ---------- public.companies ----------
DROP POLICY IF EXISTS "Orkestria admins view all companies" ON public.companies;
CREATE POLICY "Orkestria admins view all companies"
  ON public.companies FOR SELECT TO authenticated
  USING ((select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "Tenant admins manage their companies" ON public.companies;
CREATE POLICY "Tenant admins manage their companies"
  ON public.companies FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) AND (select public.has_role(auth.uid(), 'tenant_admin')))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) AND (select public.has_role(auth.uid(), 'tenant_admin')));

DROP POLICY IF EXISTS "Clients view their own company" ON public.companies;
CREATE POLICY "Clients view their own company"
  ON public.companies FOR SELECT TO authenticated
  USING (id = (select public.get_my_company_id()));

-- ---------- public.profiles ----------
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
CREATE POLICY "Users view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = (select auth.uid()));

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = (select auth.uid()))
  WITH CHECK (id = (select auth.uid()));

DROP POLICY IF EXISTS "Tenant admins view tenant profiles" ON public.profiles;
CREATE POLICY "Tenant admins view tenant profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) AND (select public.has_role(auth.uid(), 'tenant_admin')));

DROP POLICY IF EXISTS "Tenant admins manage tenant profiles" ON public.profiles;
CREATE POLICY "Tenant admins manage tenant profiles"
  ON public.profiles FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) AND (select public.has_role(auth.uid(), 'tenant_admin')))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) AND (select public.has_role(auth.uid(), 'tenant_admin')));

DROP POLICY IF EXISTS "Orkestria admins view all profiles" ON public.profiles;
CREATE POLICY "Orkestria admins view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING ((select public.is_orkestria_admin()));

-- ---------- public.user_roles ----------
DROP POLICY IF EXISTS "Users view own roles" ON public.user_roles;
CREATE POLICY "Users view own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Orkestria admins view all roles" ON public.user_roles;
CREATE POLICY "Orkestria admins view all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING ((select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "Orkestria admins manage roles" ON public.user_roles;
CREATE POLICY "Orkestria admins manage roles"
  ON public.user_roles FOR ALL TO authenticated
  USING ((select public.is_orkestria_admin()))
  WITH CHECK ((select public.is_orkestria_admin()));

-- ---------- public.sped_files ----------
DROP POLICY IF EXISTS "Tenant admins manage tenant sped files" ON public.sped_files;
CREATE POLICY "Tenant admins manage tenant sped files"
  ON public.sped_files FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) AND (select public.has_role(auth.uid(), 'tenant_admin')))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) AND (select public.has_role(auth.uid(), 'tenant_admin')));

DROP POLICY IF EXISTS "Clients view own company sped files" ON public.sped_files;
CREATE POLICY "Clients view own company sped files"
  ON public.sped_files FOR SELECT TO authenticated
  USING (company_id = (select public.get_my_company_id()));

DROP POLICY IF EXISTS "Orkestria admins view all sped files" ON public.sped_files;
CREATE POLICY "Orkestria admins view all sped files"
  ON public.sped_files FOR SELECT TO authenticated
  USING ((select public.is_orkestria_admin()));

-- ---------- public.chart_of_accounts ----------
DROP POLICY IF EXISTS "Tenant admins manage tenant coa" ON public.chart_of_accounts;
CREATE POLICY "Tenant admins manage tenant coa"
  ON public.chart_of_accounts FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) AND (select public.has_role(auth.uid(), 'tenant_admin')))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) AND (select public.has_role(auth.uid(), 'tenant_admin')));

DROP POLICY IF EXISTS "Clients view own company coa" ON public.chart_of_accounts;
CREATE POLICY "Clients view own company coa"
  ON public.chart_of_accounts FOR SELECT TO authenticated
  USING (company_id = (select public.get_my_company_id()));

DROP POLICY IF EXISTS "Orkestria admins view all coa" ON public.chart_of_accounts;
CREATE POLICY "Orkestria admins view all coa"
  ON public.chart_of_accounts FOR SELECT TO authenticated
  USING ((select public.is_orkestria_admin()));

-- ---------- public.account_balances ----------
DROP POLICY IF EXISTS "Tenant admins manage tenant balances" ON public.account_balances;
CREATE POLICY "Tenant admins manage tenant balances"
  ON public.account_balances FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) AND (select public.has_role(auth.uid(), 'tenant_admin')))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) AND (select public.has_role(auth.uid(), 'tenant_admin')));

DROP POLICY IF EXISTS "Clients view own company balances" ON public.account_balances;
CREATE POLICY "Clients view own company balances"
  ON public.account_balances FOR SELECT TO authenticated
  USING (company_id = (select public.get_my_company_id()));

DROP POLICY IF EXISTS "Orkestria admins view all balances" ON public.account_balances;
CREATE POLICY "Orkestria admins view all balances"
  ON public.account_balances FOR SELECT TO authenticated
  USING ((select public.is_orkestria_admin()));

-- ---------- public.financial_statements ----------
DROP POLICY IF EXISTS "Tenant admins manage tenant statements" ON public.financial_statements;
CREATE POLICY "Tenant admins manage tenant statements"
  ON public.financial_statements FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) AND (select public.has_role(auth.uid(), 'tenant_admin')))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) AND (select public.has_role(auth.uid(), 'tenant_admin')));

DROP POLICY IF EXISTS "Clients view own company statements" ON public.financial_statements;
CREATE POLICY "Clients view own company statements"
  ON public.financial_statements FOR SELECT TO authenticated
  USING (company_id = (select public.get_my_company_id()));

DROP POLICY IF EXISTS "Orkestria admins view all statements" ON public.financial_statements;
CREATE POLICY "Orkestria admins view all statements"
  ON public.financial_statements FOR SELECT TO authenticated
  USING ((select public.is_orkestria_admin()));

-- ---------- public.indicator_configs ----------
DROP POLICY IF EXISTS "Tenant admins manage indicators" ON public.indicator_configs;
CREATE POLICY "Tenant admins manage indicators"
  ON public.indicator_configs FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) AND (select public.has_role(auth.uid(), 'tenant_admin')))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) AND (select public.has_role(auth.uid(), 'tenant_admin')));

DROP POLICY IF EXISTS "Clients view tenant indicators" ON public.indicator_configs;
CREATE POLICY "Clients view tenant indicators"
  ON public.indicator_configs FOR SELECT TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()));

DROP POLICY IF EXISTS "Orkestria admins view all indicators" ON public.indicator_configs;
CREATE POLICY "Orkestria admins view all indicators"
  ON public.indicator_configs FOR SELECT TO authenticated
  USING ((select public.is_orkestria_admin()));

-- ---------- public.fiscal_participants ----------
DROP POLICY IF EXISTS "fiscal_participants tenant access" ON public.fiscal_participants;
CREATE POLICY "fiscal_participants tenant access"
  ON public.fiscal_participants FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.companies c WHERE c.id = fiscal_participants.company_id AND ((select public.is_orkestria_admin()) OR c.tenant_id = (select public.get_my_tenant_id()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.companies c WHERE c.id = fiscal_participants.company_id AND ((select public.is_orkestria_admin()) OR c.tenant_id = (select public.get_my_tenant_id()))));

-- ---------- public.fiscal_invoices ----------
DROP POLICY IF EXISTS "fiscal_invoices tenant access" ON public.fiscal_invoices;
CREATE POLICY "fiscal_invoices tenant access"
  ON public.fiscal_invoices FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.companies c WHERE c.id = fiscal_invoices.company_id AND ((select public.is_orkestria_admin()) OR c.tenant_id = (select public.get_my_tenant_id()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.companies c WHERE c.id = fiscal_invoices.company_id AND ((select public.is_orkestria_admin()) OR c.tenant_id = (select public.get_my_tenant_id()))));

DROP POLICY IF EXISTS "Clients view own company fiscal invoices" ON public.fiscal_invoices;
CREATE POLICY "Clients view own company fiscal invoices"
  ON public.fiscal_invoices FOR SELECT TO authenticated
  USING (company_id = (select public.get_my_company_id()));

-- ---------- public.fiscal_invoice_items ----------
DROP POLICY IF EXISTS "fiscal_invoice_items tenant access" ON public.fiscal_invoice_items;
CREATE POLICY "fiscal_invoice_items tenant access"
  ON public.fiscal_invoice_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.fiscal_invoices i JOIN public.companies c ON c.id = i.company_id WHERE i.id = fiscal_invoice_items.invoice_id AND ((select public.is_orkestria_admin()) OR c.tenant_id = (select public.get_my_tenant_id()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.fiscal_invoices i JOIN public.companies c ON c.id = i.company_id WHERE i.id = fiscal_invoice_items.invoice_id AND ((select public.is_orkestria_admin()) OR c.tenant_id = (select public.get_my_tenant_id()))));

DROP POLICY IF EXISTS "Clients view own company fiscal invoice items" ON public.fiscal_invoice_items;
CREATE POLICY "Clients view own company fiscal invoice items"
  ON public.fiscal_invoice_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.fiscal_invoices i WHERE i.id = fiscal_invoice_items.invoice_id AND i.company_id = (select public.get_my_company_id())));

-- ---------- public.plano_contas ----------
DROP POLICY IF EXISTS "plano_contas tenant read" ON public.plano_contas;
CREATE POLICY "plano_contas tenant read"
  ON public.plano_contas FOR SELECT TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "plano_contas tenant write" ON public.plano_contas;
CREATE POLICY "plano_contas tenant write"
  ON public.plano_contas FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

-- ---------- public.diario_uploads ----------
DROP POLICY IF EXISTS "diario_uploads tenant access" ON public.diario_uploads;
CREATE POLICY "diario_uploads tenant access"
  ON public.diario_uploads FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

-- ---------- public.lancamentos_diario ----------
DROP POLICY IF EXISTS "lancamentos tenant access" ON public.lancamentos_diario;
CREATE POLICY "lancamentos tenant access"
  ON public.lancamentos_diario FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

-- ---------- public.saldos_mensais ----------
DROP POLICY IF EXISTS "saldos_mensais tenant access" ON public.saldos_mensais;
CREATE POLICY "saldos_mensais tenant access"
  ON public.saldos_mensais FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

-- ---------- public.saldos_abertura ----------
DROP POLICY IF EXISTS "saldos_abertura tenant access" ON public.saldos_abertura;
CREATE POLICY "saldos_abertura tenant access"
  ON public.saldos_abertura FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

-- ---------- public.mapeamento_demonstracao ----------
DROP POLICY IF EXISTS "mapeamento tenant access" ON public.mapeamento_demonstracao;
CREATE POLICY "mapeamento tenant access"
  ON public.mapeamento_demonstracao FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

-- ---------- public.saldo_inicial_uploads ----------
DROP POLICY IF EXISTS "tenant members read saldo_inicial_uploads" ON public.saldo_inicial_uploads;
CREATE POLICY "tenant members read saldo_inicial_uploads"
  ON public.saldo_inicial_uploads FOR SELECT TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "tenant members write saldo_inicial_uploads" ON public.saldo_inicial_uploads;
CREATE POLICY "tenant members write saldo_inicial_uploads"
  ON public.saldo_inicial_uploads FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

-- ---------- public.mascara_classificacao ----------
DROP POLICY IF EXISTS "mascara tenant access" ON public.mascara_classificacao;
CREATE POLICY "mascara tenant access"
  ON public.mascara_classificacao FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

-- ---------- public.indicador_config_empresa ----------
DROP POLICY IF EXISTS "tenant members read indicador_config" ON public.indicador_config_empresa;
CREATE POLICY "tenant members read indicador_config"
  ON public.indicador_config_empresa FOR SELECT TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()));

DROP POLICY IF EXISTS "tenant admins manage indicador_config" ON public.indicador_config_empresa;
CREATE POLICY "tenant admins manage indicador_config"
  ON public.indicador_config_empresa FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) AND ((select public.has_role(auth.uid(), 'tenant_admin')) OR (select public.has_role(auth.uid(), 'orkestria_admin'))))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) AND ((select public.has_role(auth.uid(), 'tenant_admin')) OR (select public.has_role(auth.uid(), 'orkestria_admin'))));

-- ---------- public.indicadores_empresa ----------
DROP POLICY IF EXISTS "indic_emp_select" ON public.indicadores_empresa;
CREATE POLICY "indic_emp_select"
  ON public.indicadores_empresa FOR SELECT TO authenticated
  USING ((select public.is_orkestria_admin()) OR tenant_id = (select public.get_my_tenant_id()));

DROP POLICY IF EXISTS "indic_emp_insert" ON public.indicadores_empresa;
CREATE POLICY "indic_emp_insert"
  ON public.indicadores_empresa FOR INSERT TO authenticated
  WITH CHECK ((select public.is_orkestria_admin()) OR ((select public.has_role(auth.uid(), 'tenant_admin')) AND tenant_id = (select public.get_my_tenant_id())));

DROP POLICY IF EXISTS "indic_emp_update" ON public.indicadores_empresa;
CREATE POLICY "indic_emp_update"
  ON public.indicadores_empresa FOR UPDATE TO authenticated
  USING ((select public.is_orkestria_admin()) OR ((select public.has_role(auth.uid(), 'tenant_admin')) AND tenant_id = (select public.get_my_tenant_id())))
  WITH CHECK ((select public.is_orkestria_admin()) OR ((select public.has_role(auth.uid(), 'tenant_admin')) AND tenant_id = (select public.get_my_tenant_id())));

DROP POLICY IF EXISTS "indic_emp_delete" ON public.indicadores_empresa;
CREATE POLICY "indic_emp_delete"
  ON public.indicadores_empresa FOR DELETE TO authenticated
  USING ((select public.is_orkestria_admin()) OR ((select public.has_role(auth.uid(), 'tenant_admin')) AND tenant_id = (select public.get_my_tenant_id())));

-- ---------- public.contas_gerenciais ----------
DROP POLICY IF EXISTS "orkestria_admin manages all contas_gerenciais" ON public.contas_gerenciais;
CREATE POLICY "orkestria_admin manages all contas_gerenciais"
  ON public.contas_gerenciais FOR ALL TO authenticated
  USING ((select public.is_orkestria_admin()))
  WITH CHECK ((select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "tenant_admin manages contas_gerenciais of own tenant" ON public.contas_gerenciais;
CREATE POLICY "tenant_admin manages contas_gerenciais of own tenant"
  ON public.contas_gerenciais FOR ALL TO authenticated
  USING ((select public.has_role(auth.uid(), 'tenant_admin')) AND tenant_id = (select public.get_my_tenant_id()))
  WITH CHECK ((select public.has_role(auth.uid(), 'tenant_admin')) AND tenant_id = (select public.get_my_tenant_id()));

DROP POLICY IF EXISTS "clients read contas_gerenciais of own company" ON public.contas_gerenciais;
CREATE POLICY "clients read contas_gerenciais of own company"
  ON public.contas_gerenciais FOR SELECT TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) AND company_id = (select public.get_my_company_id()));

-- ---------- public.ajustes_gerenciais ----------
DROP POLICY IF EXISTS "orkestria_admin manages all ajustes_gerenciais" ON public.ajustes_gerenciais;
CREATE POLICY "orkestria_admin manages all ajustes_gerenciais"
  ON public.ajustes_gerenciais FOR ALL TO authenticated
  USING ((select public.is_orkestria_admin()))
  WITH CHECK ((select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "tenant_admin manages ajustes_gerenciais of own tenant" ON public.ajustes_gerenciais;
CREATE POLICY "tenant_admin manages ajustes_gerenciais of own tenant"
  ON public.ajustes_gerenciais FOR ALL TO authenticated
  USING ((select public.has_role(auth.uid(), 'tenant_admin')) AND tenant_id = (select public.get_my_tenant_id()))
  WITH CHECK ((select public.has_role(auth.uid(), 'tenant_admin')) AND tenant_id = (select public.get_my_tenant_id()));

DROP POLICY IF EXISTS "clients read ajustes_gerenciais of own company" ON public.ajustes_gerenciais;
CREATE POLICY "clients read ajustes_gerenciais of own company"
  ON public.ajustes_gerenciais FOR SELECT TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) AND company_id = (select public.get_my_company_id()));

-- ---------- public.orcamentos ----------
DROP POLICY IF EXISTS "orkestria_admin manages all orcamentos" ON public.orcamentos;
CREATE POLICY "orkestria_admin manages all orcamentos"
  ON public.orcamentos FOR ALL TO authenticated
  USING ((select public.is_orkestria_admin()))
  WITH CHECK ((select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "tenant_admin manages orcamentos of own tenant" ON public.orcamentos;
CREATE POLICY "tenant_admin manages orcamentos of own tenant"
  ON public.orcamentos FOR ALL TO authenticated
  USING ((select public.has_role(auth.uid(), 'tenant_admin')) AND tenant_id = (select public.get_my_tenant_id()))
  WITH CHECK ((select public.has_role(auth.uid(), 'tenant_admin')) AND tenant_id = (select public.get_my_tenant_id()));

DROP POLICY IF EXISTS "clients read orcamentos of own company" ON public.orcamentos;
CREATE POLICY "clients read orcamentos of own company"
  ON public.orcamentos FOR SELECT TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) AND company_id = (select public.get_my_company_id()));

-- ---------- public.orcamento_itens ----------
DROP POLICY IF EXISTS "orkestria_admin manages all orcamento_itens" ON public.orcamento_itens;
CREATE POLICY "orkestria_admin manages all orcamento_itens"
  ON public.orcamento_itens FOR ALL TO authenticated
  USING ((select public.is_orkestria_admin()))
  WITH CHECK ((select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "tenant_admin manages orcamento_itens of own tenant" ON public.orcamento_itens;
CREATE POLICY "tenant_admin manages orcamento_itens of own tenant"
  ON public.orcamento_itens FOR ALL TO authenticated
  USING ((select public.has_role(auth.uid(), 'tenant_admin')) AND tenant_id = (select public.get_my_tenant_id()))
  WITH CHECK ((select public.has_role(auth.uid(), 'tenant_admin')) AND tenant_id = (select public.get_my_tenant_id()));

DROP POLICY IF EXISTS "clients read orcamento_itens of own company" ON public.orcamento_itens;
CREATE POLICY "clients read orcamento_itens of own company"
  ON public.orcamento_itens FOR SELECT TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) AND company_id = (select public.get_my_company_id()));

-- ---------- public.orcamento_valores ----------
DROP POLICY IF EXISTS "orkestria_admin manages all orcamento_valores" ON public.orcamento_valores;
CREATE POLICY "orkestria_admin manages all orcamento_valores"
  ON public.orcamento_valores FOR ALL TO authenticated
  USING ((select public.is_orkestria_admin()))
  WITH CHECK ((select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "tenant_admin manages orcamento_valores of own tenant" ON public.orcamento_valores;
CREATE POLICY "tenant_admin manages orcamento_valores of own tenant"
  ON public.orcamento_valores FOR ALL TO authenticated
  USING ((select public.has_role(auth.uid(), 'tenant_admin')) AND tenant_id = (select public.get_my_tenant_id()))
  WITH CHECK ((select public.has_role(auth.uid(), 'tenant_admin')) AND tenant_id = (select public.get_my_tenant_id()));

DROP POLICY IF EXISTS "clients read orcamento_valores of own company" ON public.orcamento_valores;
CREATE POLICY "clients read orcamento_valores of own company"
  ON public.orcamento_valores FOR SELECT TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) AND company_id = (select public.get_my_company_id()));

-- ---------- public.orcamento_cenarios ----------
DROP POLICY IF EXISTS "Cenarios: select por tenant/empresa" ON public.orcamento_cenarios;
CREATE POLICY "Cenarios: select por tenant/empresa"
  ON public.orcamento_cenarios FOR SELECT TO authenticated
  USING ((select public.is_orkestria_admin()) OR (tenant_id = (select public.get_my_tenant_id()) AND ((select public.get_my_company_id()) IS NULL OR company_id = (select public.get_my_company_id()))));

DROP POLICY IF EXISTS "Cenarios: insert por tenant/empresa" ON public.orcamento_cenarios;
CREATE POLICY "Cenarios: insert por tenant/empresa"
  ON public.orcamento_cenarios FOR INSERT TO authenticated
  WITH CHECK ((select public.is_orkestria_admin()) OR (tenant_id = (select public.get_my_tenant_id()) AND ((select public.get_my_company_id()) IS NULL OR company_id = (select public.get_my_company_id()))));

DROP POLICY IF EXISTS "Cenarios: update por tenant/empresa" ON public.orcamento_cenarios;
CREATE POLICY "Cenarios: update por tenant/empresa"
  ON public.orcamento_cenarios FOR UPDATE TO authenticated
  USING ((select public.is_orkestria_admin()) OR (tenant_id = (select public.get_my_tenant_id()) AND ((select public.get_my_company_id()) IS NULL OR company_id = (select public.get_my_company_id()))))
  WITH CHECK ((select public.is_orkestria_admin()) OR (tenant_id = (select public.get_my_tenant_id()) AND ((select public.get_my_company_id()) IS NULL OR company_id = (select public.get_my_company_id()))));

DROP POLICY IF EXISTS "Cenarios: delete por tenant/empresa" ON public.orcamento_cenarios;
CREATE POLICY "Cenarios: delete por tenant/empresa"
  ON public.orcamento_cenarios FOR DELETE TO authenticated
  USING ((select public.is_orkestria_admin()) OR (tenant_id = (select public.get_my_tenant_id()) AND ((select public.get_my_company_id()) IS NULL OR company_id = (select public.get_my_company_id()))));

-- ---------- public.orcamento_cenario_valores ----------
DROP POLICY IF EXISTS "Cenario valores: select por tenant/empresa" ON public.orcamento_cenario_valores;
CREATE POLICY "Cenario valores: select por tenant/empresa"
  ON public.orcamento_cenario_valores FOR SELECT TO authenticated
  USING ((select public.is_orkestria_admin()) OR (tenant_id = (select public.get_my_tenant_id()) AND ((select public.get_my_company_id()) IS NULL OR company_id = (select public.get_my_company_id()))));

DROP POLICY IF EXISTS "Cenario valores: insert por tenant/empresa" ON public.orcamento_cenario_valores;
CREATE POLICY "Cenario valores: insert por tenant/empresa"
  ON public.orcamento_cenario_valores FOR INSERT TO authenticated
  WITH CHECK ((select public.is_orkestria_admin()) OR (tenant_id = (select public.get_my_tenant_id()) AND ((select public.get_my_company_id()) IS NULL OR company_id = (select public.get_my_company_id()))));

DROP POLICY IF EXISTS "Cenario valores: update por tenant/empresa" ON public.orcamento_cenario_valores;
CREATE POLICY "Cenario valores: update por tenant/empresa"
  ON public.orcamento_cenario_valores FOR UPDATE TO authenticated
  USING ((select public.is_orkestria_admin()) OR (tenant_id = (select public.get_my_tenant_id()) AND ((select public.get_my_company_id()) IS NULL OR company_id = (select public.get_my_company_id()))))
  WITH CHECK ((select public.is_orkestria_admin()) OR (tenant_id = (select public.get_my_tenant_id()) AND ((select public.get_my_company_id()) IS NULL OR company_id = (select public.get_my_company_id()))));

DROP POLICY IF EXISTS "Cenario valores: delete por tenant/empresa" ON public.orcamento_cenario_valores;
CREATE POLICY "Cenario valores: delete por tenant/empresa"
  ON public.orcamento_cenario_valores FOR DELETE TO authenticated
  USING ((select public.is_orkestria_admin()) OR (tenant_id = (select public.get_my_tenant_id()) AND ((select public.get_my_company_id()) IS NULL OR company_id = (select public.get_my_company_id()))));

-- ---------- public.dashboard_config ----------
DROP POLICY IF EXISTS "dashboard_config tenant read" ON public.dashboard_config;
CREATE POLICY "dashboard_config tenant read"
  ON public.dashboard_config FOR SELECT TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "dashboard_config tenant insert" ON public.dashboard_config;
CREATE POLICY "dashboard_config tenant insert"
  ON public.dashboard_config FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "dashboard_config tenant update" ON public.dashboard_config;
CREATE POLICY "dashboard_config tenant update"
  ON public.dashboard_config FOR UPDATE TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "dashboard_config tenant delete" ON public.dashboard_config;
CREATE POLICY "dashboard_config tenant delete"
  ON public.dashboard_config FOR DELETE TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

-- ---------- storage.objects ----------
DROP POLICY IF EXISTS "Tenant admins manage own sped objects" ON storage.objects;
CREATE POLICY "Tenant admins manage own sped objects"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'sped-files' AND (storage.foldername(name))[1] = ((select public.get_my_tenant_id()))::text AND (select public.has_role(auth.uid(), 'tenant_admin'::public.app_role)))
  WITH CHECK (bucket_id = 'sped-files' AND (storage.foldername(name))[1] = ((select public.get_my_tenant_id()))::text AND (select public.has_role(auth.uid(), 'tenant_admin'::public.app_role)));

DROP POLICY IF EXISTS "Clients read own company sped objects" ON storage.objects;
CREATE POLICY "Clients read own company sped objects"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sped-files' AND (storage.foldername(name))[1] = ((select public.get_my_tenant_id()))::text AND (storage.foldername(name))[2] = ((select public.get_my_company_id()))::text);

DROP POLICY IF EXISTS "tenant_logos_admin_insert" ON storage.objects;
CREATE POLICY "tenant_logos_admin_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tenant-logos' AND (select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "tenant_logos_admin_update" ON storage.objects;
CREATE POLICY "tenant_logos_admin_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'tenant-logos' AND (select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "tenant_logos_admin_delete" ON storage.objects;
CREATE POLICY "tenant_logos_admin_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'tenant-logos' AND (select public.is_orkestria_admin()));

