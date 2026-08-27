-- Configuração das linhas gerenciais EBIT e EBITDA da DRE.
--
-- A DRE já fecha com os acumuladores do plano. EBIT/EBITDA são linhas
-- extras no final, e de onde elas puxam valor muda de escritório para
-- escritório (resultado operacional vs. um conjunto de contas). Isso
-- não é fórmula de indicador — senão o indicador Ebit apontaria para a
-- linha da DRE que aponta de volta para o indicador.
--
-- Uma linha por escritório. Classificações vazias = usar o papel da
-- `estrutura_padrao` (EBIT corrido em 3.10.99; tags de D&A).

CREATE TABLE IF NOT EXISTS public.dre_linhas_config (
  tenant_id              uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  ebit_classificacoes    text[] NOT NULL DEFAULT '{}',
  ebitda_classificacoes  text[] NOT NULL DEFAULT '{}',
  ebitda_sobre_ebit      boolean NOT NULL DEFAULT true,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dre_linhas_config IS
  'Alocação das linhas EBIT e EBITDA da DRE: de quais classificações do plano padrão puxar os valores.';
COMMENT ON COLUMN public.dre_linhas_config.ebitda_sobre_ebit IS
  'true = EBITDA = EBIT − contas de D&A (despesa na DRE). false = EBITDA é só a soma das classificações de EBITDA.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dre_linhas_config TO authenticated;
GRANT ALL ON public.dre_linhas_config TO service_role;

ALTER TABLE public.dre_linhas_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dre_linhas_select" ON public.dre_linhas_config;
CREATE POLICY "dre_linhas_select"
ON public.dre_linhas_config FOR SELECT TO authenticated
USING (public.is_orkestria_admin() OR tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "dre_linhas_escrita" ON public.dre_linhas_config;
CREATE POLICY "dre_linhas_escrita"
ON public.dre_linhas_config FOR ALL TO authenticated
USING (
  public.is_orkestria_admin()
  OR (public.has_role(auth.uid(), 'tenant_admin') AND tenant_id = public.get_my_tenant_id())
)
WITH CHECK (
  public.is_orkestria_admin()
  OR (public.has_role(auth.uid(), 'tenant_admin') AND tenant_id = public.get_my_tenant_id())
);
