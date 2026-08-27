-- ============================================================
-- AJUSTE 01 (parte 1/3) — o PLANO DE CONTAS passa a ser a base
-- de alocação de DRE / Balanço / DFC.
--
-- Antes: a alocação vivia em `mapeamento_demonstracao`, uma tabela
-- separada que casava PREFIXO DE CLASSIFICAÇÃO -> linha da
-- demonstração. O plano de contas era só um cadastro descritivo.
--
-- Agora: cada conta do plano carrega a própria alocação. Uma conta
-- SINTÉTICA alocada cascateia para todas as descendentes; qualquer
-- descendente pode sobrescrever com alocação própria (a mais
-- específica vence — mesma semântica do buildMatcher de hoje, só
-- que materializada no plano).
--
-- E a DFC deixa de depender de prefixos fixos no código
-- (1.01.01 = caixa, 1.03 = imobilizado, ...) e de regex em cima da
-- descrição da conta: cada conta ANALÍTICA passa a declarar
-- explicitamente como movimenta o fluxo de caixa.
--
-- Esta migration só cria estrutura. A conversão dos dados que já
-- existem em mapeamento_demonstracao é a parte 2/3, e as RPCs de
-- atualização mensal / de-para / pendências são a parte 3/3.
-- ============================================================

-- ------------------------------------------------------------
-- 1) A empresa usa o Plano Padrão do escritório, ou um plano próprio?
-- ------------------------------------------------------------
-- 'padrao'  = usa o plano do sistema contábil do escritório (o mesmo
--             para todas as empresas; atualizado mensalmente).
-- 'proprio' = plano de um sistema de terceiro; precisa de de-para
--             para as contas do Plano Padrão.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS plano_tipo text NOT NULL DEFAULT 'padrao';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_plano_tipo_chk'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_plano_tipo_chk CHECK (plano_tipo IN ('padrao','proprio'));
  END IF;
END $$;

COMMENT ON COLUMN public.companies.plano_tipo IS
  'padrao = usa o Plano Padrão do escritório; proprio = plano de terceiro, exige de-para (depara_contas).';

-- ------------------------------------------------------------
-- 2) Colunas de alocação no plano de contas
-- ------------------------------------------------------------
ALTER TABLE public.plano_contas
  ADD COLUMN IF NOT EXISTS tipo_demonstracao text,
  ADD COLUMN IF NOT EXISTS linha_demonstracao text,
  ADD COLUMN IF NOT EXISTS ordem_linha int,
  ADD COLUMN IF NOT EXISTS inverter_sinal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tipo_custo text,
  ADD COLUMN IF NOT EXISTS dfc_atividade text,
  ADD COLUMN IF NOT EXISTS dfc_nao_caixa boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.plano_contas.tipo_demonstracao IS
  'DRE | BP_ATIVO | BP_PASSIVO — em qual demonstração esta conta (e suas descendentes) entra.';
COMMENT ON COLUMN public.plano_contas.linha_demonstracao IS
  'Linha da demonstração em que a conta é somada. Herdada pelas descendentes; a alocação mais específica vence.';
COMMENT ON COLUMN public.plano_contas.ordem_linha IS
  'Ordem de exibição da linha na demonstração. Herdada junto com linha_demonstracao.';
COMMENT ON COLUMN public.plano_contas.inverter_sinal IS
  'true = movimento credor deve aparecer positivo (receitas, passivo, PL).';
COMMENT ON COLUMN public.plano_contas.tipo_custo IS
  'fixo | variavel — usado na análise de Ponto de Equilíbrio (apenas linhas de custo/despesa).';
COMMENT ON COLUMN public.plano_contas.dfc_atividade IS
  'caixa | operacional | investimento | financiamento — como a VARIAÇÃO desta conta entra na DFC. Apenas contas analíticas.';
COMMENT ON COLUMN public.plano_contas.dfc_nao_caixa IS
  'true = despesa/receita que NÃO transita por caixa (depreciação, amortização, provisão) e é estornada no bloco operacional da DFC.';

-- Coerência: ou a conta tem alocação completa (tipo + linha), ou não tem nenhuma.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'plano_contas_alocacao_chk'
  ) THEN
    ALTER TABLE public.plano_contas
      ADD CONSTRAINT plano_contas_alocacao_chk CHECK (
        (tipo_demonstracao IS NULL AND linha_demonstracao IS NULL)
        OR (tipo_demonstracao IN ('DRE','BP_ATIVO','BP_PASSIVO') AND linha_demonstracao IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'plano_contas_tipo_custo_chk'
  ) THEN
    ALTER TABLE public.plano_contas
      ADD CONSTRAINT plano_contas_tipo_custo_chk
      CHECK (tipo_custo IS NULL OR tipo_custo IN ('fixo','variavel'));
  END IF;

  -- Regra pedida: flag de DFC só faz sentido em conta ANALÍTICA — é nela
  -- que o movimento acontece. Numa sintética, o valor é só a soma das filhas;
  -- marcar a sintética duplicaria o efeito na DFC.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'plano_contas_dfc_chk'
  ) THEN
    ALTER TABLE public.plano_contas
      ADD CONSTRAINT plano_contas_dfc_chk CHECK (
        dfc_atividade IS NULL
        OR (is_sintetica = false AND dfc_atividade IN ('caixa','operacional','investimento','financiamento'))
      );
  END IF;
END $$;

-- Índices para as duas leituras quentes: montar demonstração e montar DFC.
CREATE INDEX IF NOT EXISTS idx_plano_contas_alocacao
  ON public.plano_contas (tenant_id, company_id, tipo_demonstracao)
  WHERE linha_demonstracao IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plano_contas_dfc
  ON public.plano_contas (tenant_id, company_id, dfc_atividade)
  WHERE dfc_atividade IS NOT NULL;

-- ------------------------------------------------------------
-- 3) DE-PARA — plano de terceiro -> Plano Padrão do escritório
-- ------------------------------------------------------------
-- Configuração única por empresa. Só entram na fila as contas que
-- realmente têm movimento (ver RPC depara_pendentes na parte 3/3).
CREATE TABLE IF NOT EXISTS public.depara_contas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- código da conta no plano PRÓPRIO da empresa (o que vem nos lançamentos)
  conta_codigo text NOT NULL,
  -- código correspondente no Plano Padrão do tenant (company_id IS NULL)
  conta_padrao_codigo text,
  -- conta que conscientemente não entra em demonstração (ex.: conta de
  -- controle interno). Sai da lista de pendências sem virar alocação.
  ignorada boolean NOT NULL DEFAULT false,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT depara_contas_unica UNIQUE (company_id, conta_codigo),
  CONSTRAINT depara_contas_destino_chk CHECK (
    ignorada = true OR conta_padrao_codigo IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_depara_company ON public.depara_contas (company_id);
CREATE INDEX IF NOT EXISTS idx_depara_padrao ON public.depara_contas (company_id, conta_padrao_codigo);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.depara_contas TO authenticated;
GRANT ALL ON public.depara_contas TO service_role;

ALTER TABLE public.depara_contas ENABLE ROW LEVEL SECURITY;

-- Policies já na forma otimizada ((select fn()) em vez de fn()) —
-- mesmo padrão da migration de performance de RLS deste pacote.
DROP POLICY IF EXISTS "depara tenant read" ON public.depara_contas;
CREATE POLICY "depara tenant read"
  ON public.depara_contas FOR SELECT TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "depara tenant write" ON public.depara_contas;
CREATE POLICY "depara tenant write"
  ON public.depara_contas FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

DROP TRIGGER IF EXISTS trg_depara_contas_updated ON public.depara_contas;
CREATE TRIGGER trg_depara_contas_updated
  BEFORE UPDATE ON public.depara_contas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- 4) Controle das atualizações mensais do Plano Padrão
-- ------------------------------------------------------------
-- Histórico de cada carga: quantas contas entraram, quantas foram
-- atualizadas. Regra do negócio: conta NUNCA some e NUNCA é inativada —
-- o plano só cresce (novos clientes/fornecedores todo mês).
CREATE TABLE IF NOT EXISTS public.plano_atualizacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, -- NULL = Plano Padrão do tenant
  filename text,
  total_arquivo int NOT NULL DEFAULT 0,
  novas int NOT NULL DEFAULT 0,
  atualizadas int NOT NULL DEFAULT 0,
  inalteradas int NOT NULL DEFAULT 0,
  executado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plano_atualizacoes_escopo
  ON public.plano_atualizacoes (tenant_id, company_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plano_atualizacoes TO authenticated;
GRANT ALL ON public.plano_atualizacoes TO service_role;

ALTER TABLE public.plano_atualizacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plano_atualizacoes tenant read" ON public.plano_atualizacoes;
CREATE POLICY "plano_atualizacoes tenant read"
  ON public.plano_atualizacoes FOR SELECT TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "plano_atualizacoes tenant write" ON public.plano_atualizacoes;
CREATE POLICY "plano_atualizacoes tenant write"
  ON public.plano_atualizacoes FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));
