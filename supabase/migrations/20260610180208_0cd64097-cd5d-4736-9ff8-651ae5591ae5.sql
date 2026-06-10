DROP POLICY IF EXISTS "Orkestria admins view all statements" ON public.financial_statements;
DROP POLICY IF EXISTS "Orkestria admins view all balances" ON public.account_balances;
DROP POLICY IF EXISTS "Orkestria admins view all coa" ON public.chart_of_accounts;
DROP POLICY IF EXISTS "Orkestria admins view all indicators" ON public.indicator_configs;
CREATE POLICY "Orkestria admins view all statements" ON public.financial_statements FOR SELECT TO authenticated USING (is_orkestria_admin());
CREATE POLICY "Orkestria admins view all balances" ON public.account_balances FOR SELECT TO authenticated USING (is_orkestria_admin());
CREATE POLICY "Orkestria admins view all coa" ON public.chart_of_accounts FOR SELECT TO authenticated USING (is_orkestria_admin());
CREATE POLICY "Orkestria admins view all indicators" ON public.indicator_configs FOR SELECT TO authenticated USING (is_orkestria_admin());