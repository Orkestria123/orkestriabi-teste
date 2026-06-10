-- Tabelas para análise de SPED Fiscal (EFD ICMS/IPI):
-- participantes (fornecedores/clientes), notas fiscais e itens.

CREATE TABLE IF NOT EXISTS public.fiscal_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cnpj_cpf text NOT NULL,
  nome text,
  uf text,
  municipio text,
  ie text,
  tipo text, -- F=fornecedor, C=cliente, A=ambos
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, cnpj_cpf)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fiscal_participants TO authenticated;
GRANT ALL ON public.fiscal_participants TO service_role;

ALTER TABLE public.fiscal_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fiscal_participants tenant access" ON public.fiscal_participants
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = fiscal_participants.company_id
      AND (
        public.is_orkestria_admin()
        OR c.tenant_id = public.get_my_tenant_id()
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = fiscal_participants.company_id
      AND (
        public.is_orkestria_admin()
        OR c.tenant_id = public.get_my_tenant_id()
      )
  )
);

CREATE INDEX idx_fiscal_participants_company ON public.fiscal_participants(company_id);
CREATE INDEX idx_fiscal_participants_cnpj ON public.fiscal_participants(company_id, cnpj_cpf);

-- Notas fiscais (Registro C100 do SPED Fiscal)
CREATE TABLE IF NOT EXISTS public.fiscal_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sped_file_id uuid REFERENCES public.sped_files(id) ON DELETE SET NULL,
  participant_id uuid REFERENCES public.fiscal_participants(id) ON DELETE SET NULL,
  tipo text NOT NULL CHECK (tipo IN ('E','S')), -- E=entrada, S=saída
  modelo text,
  serie text,
  numero text,
  chave_nfe text,
  data_emissao date,
  data_entrada_saida date,
  cancelada boolean NOT NULL DEFAULT false,
  valor_total numeric(18,2),
  valor_produtos numeric(18,2),
  valor_desconto numeric(18,2),
  valor_frete numeric(18,2),
  valor_icms numeric(18,2),
  valor_icms_st numeric(18,2),
  valor_ipi numeric(18,2),
  valor_pis numeric(18,2),
  valor_cofins numeric(18,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, tipo, chave_nfe)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fiscal_invoices TO authenticated;
GRANT ALL ON public.fiscal_invoices TO service_role;

ALTER TABLE public.fiscal_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fiscal_invoices tenant access" ON public.fiscal_invoices
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = fiscal_invoices.company_id
      AND (
        public.is_orkestria_admin()
        OR c.tenant_id = public.get_my_tenant_id()
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = fiscal_invoices.company_id
      AND (
        public.is_orkestria_admin()
        OR c.tenant_id = public.get_my_tenant_id()
      )
  )
);

CREATE INDEX idx_fiscal_invoices_company ON public.fiscal_invoices(company_id);
CREATE INDEX idx_fiscal_invoices_company_data ON public.fiscal_invoices(company_id, data_emissao);
CREATE INDEX idx_fiscal_invoices_participant ON public.fiscal_invoices(participant_id);
CREATE INDEX idx_fiscal_invoices_tipo ON public.fiscal_invoices(company_id, tipo);

-- Itens (Registro C170) — opcional, salvos quando disponíveis
CREATE TABLE IF NOT EXISTS public.fiscal_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.fiscal_invoices(id) ON DELETE CASCADE,
  num_item integer,
  codigo_produto text,
  descricao text,
  quantidade numeric(18,4),
  unidade text,
  valor_total numeric(18,2),
  valor_desconto numeric(18,2),
  cfop text,
  ncm text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fiscal_invoice_items TO authenticated;
GRANT ALL ON public.fiscal_invoice_items TO service_role;

ALTER TABLE public.fiscal_invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fiscal_invoice_items tenant access" ON public.fiscal_invoice_items
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.fiscal_invoices i
    JOIN public.companies c ON c.id = i.company_id
    WHERE i.id = fiscal_invoice_items.invoice_id
      AND (
        public.is_orkestria_admin()
        OR c.tenant_id = public.get_my_tenant_id()
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.fiscal_invoices i
    JOIN public.companies c ON c.id = i.company_id
    WHERE i.id = fiscal_invoice_items.invoice_id
      AND (
        public.is_orkestria_admin()
        OR c.tenant_id = public.get_my_tenant_id()
      )
  )
);

CREATE INDEX idx_fiscal_items_invoice ON public.fiscal_invoice_items(invoice_id);
