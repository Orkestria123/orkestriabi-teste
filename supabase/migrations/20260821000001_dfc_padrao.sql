-- ============================================================
-- AJUSTE 11 — estrutura padrão da DFC indireta (da planilha dfc.xlsx)
--
-- A planilha define uma DFC bem mais granular que o modelo anterior
-- (caixa / operacional / investimento / financiamento): são 20 códigos
-- com sub-linha própria, que é o que dá uma DFC legível de verdade —
-- "Variação de Clientes", "Variação de Fornecedores" etc., em vez de um
-- único bloco "capital de giro".
--
-- Modelo:
--   dfc_codigo  = o código granular na conta (C, AOC, POF, FE, D, R...)
--   dfc_catalogo = código -> bloco + rótulo + ordem
--   dfc_padrao   = classificação -> código (o vínculo padrão da planilha)
--
-- dfc_atividade (4 valores) continua existindo e passa a ser DERIVADO
-- do código, para o motor de DFC e as telas atuais não quebrarem.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Catálogo dos códigos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dfc_catalogo (
  codigo text PRIMARY KEY,
  descricao text NOT NULL,
  -- bloco do método indireto
  bloco text NOT NULL CHECK (bloco IN ('caixa','operacional','investimento','financiamento','nao_caixa','resultado')),
  ordem int NOT NULL
);

GRANT SELECT ON public.dfc_catalogo TO authenticated;
GRANT ALL ON public.dfc_catalogo TO service_role;
ALTER TABLE public.dfc_catalogo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dfc_catalogo leitura" ON public.dfc_catalogo;
CREATE POLICY "dfc_catalogo leitura" ON public.dfc_catalogo FOR SELECT TO authenticated USING (true);

INSERT INTO public.dfc_catalogo (codigo, descricao, bloco, ordem) VALUES
  ('C',   'Caixa e Equivalentes',                                    'caixa',          0),
  ('R',   'Resultado do Exercício',                                  'resultado',     10),
  ('D',   'Depreciação e Amortização',                               'nao_caixa',     20),
  ('AOC', 'Variação de Clientes',                                    'operacional',  100),
  ('AOE', 'Variação de Estoques',                                    'operacional',  110),
  ('AOI', 'Variação de Impostos a Recuperar',                        'operacional',  120),
  ('AOA', 'Variação de Adiantamentos',                               'operacional',  130),
  ('AON', 'Variação de Despesas Antecipadas',                        'operacional',  140),
  ('AOO', 'Variação de Outros Créditos',                             'operacional',  150),
  ('AOL', 'Variação de Realizável a Longo Prazo',                    'operacional',  160),
  ('O',   'Variação de Outros Ativos Operacionais',                  'operacional',  170),
  ('POF', 'Variação de Fornecedores',                                'operacional',  200),
  ('POS', 'Variação de Salários e Encargos',                         'operacional',  210),
  ('POT', 'Variação de Tributos a Recolher',                         'operacional',  220),
  ('POO', 'Variação de Outros Passivos',                             'operacional',  230),
  ('I',   'Investimentos (Imobilizado e Participações)',             'investimento', 300),
  ('FE',  'Empréstimos e Financiamentos',                            'financiamento',400),
  ('FO',  'Outras Obrigações',                                       'financiamento',410),
  ('FL',  'Patrimônio Líquido e Dividendos',                         'financiamento',420),
  ('FR',  'Empréstimos a Receber',                                   'financiamento',430),
  ('FC',  'Cisão',                                                   'financiamento',440)
ON CONFLICT (codigo) DO UPDATE
  SET descricao = EXCLUDED.descricao, bloco = EXCLUDED.bloco, ordem = EXCLUDED.ordem;

-- ------------------------------------------------------------
-- 2) Vínculo padrão: classificação -> código
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dfc_padrao (
  classificacao text PRIMARY KEY,
  descricao_referencia text,
  codigo_dfc text NOT NULL REFERENCES public.dfc_catalogo(codigo)
);

GRANT SELECT ON public.dfc_padrao TO authenticated;
GRANT ALL ON public.dfc_padrao TO service_role;
ALTER TABLE public.dfc_padrao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dfc_padrao leitura" ON public.dfc_padrao;
CREATE POLICY "dfc_padrao leitura" ON public.dfc_padrao FOR SELECT TO authenticated USING (true);

-- 71 vínculos extraídos da planilha dfc.xlsx
INSERT INTO public.dfc_padrao (classificacao, descricao_referencia, codigo_dfc) VALUES
  ('1.01.01.01', 'CAIXA GERAL', 'C'),
  ('1.01.01.02', 'BANCOS CONTA MOVIMENTO', 'C'),
  ('1.01.01.03', 'BANCOS CONTA VINCULADA', 'C'),
  ('1.01.01.04', 'BANCOS CONTA APLICACOES', 'C'),
  ('1.01.02.01', 'CLIENTES', 'AOC'),
  ('1.01.02.02', '( - ) DUPLICATAS DESCONTADAS', 'AOC'),
  ('1.01.02.04', 'CHEQUES EM COBRANCA', 'AOC'),
  ('1.01.02.05', 'LUCROS A RECEBER', 'O'),
  ('1.01.02.06', 'JUROS CAPITAL PROPRIO A RECEBER', 'O'),
  ('1.01.02.07', 'ADIANTAMENTO DIVERSOS', 'AOA'),
  ('1.01.02.08', 'ADIANTAMENTO A FUNCIONARIOS', 'AOA'),
  ('1.01.02.09', 'TRIBUTOS A RECUPERAR', 'AOI'),
  ('1.01.02.10', 'CREDITOS DIVERSOS', 'AOO'),
  ('1.01.03.01', 'ESTOQUES', 'AOE'),
  ('1.01.04.01', 'DESPESAS EXERCICIO SEGUINTE', 'AON'),
  ('1.01.05.01', 'ENCARGOS FINANCEIROS', 'AON'),
  ('1.01.06.01', 'CONTAS CORRENTES - MATRIZ E FILIAIS', 'C'),
  ('1.03.00.01', 'DEPOSITOS JUDICIAIS', 'AOL'),
  ('1.03.00.02', 'TRIBUTOS A RECUPERAR LONGO PRAZO', 'AOL'),
  ('1.03.00.03', 'BANCOS CONTAS APLICACOES FINANCEIRAS', 'AOL'),
  ('1.03.00.04', 'OUTROS CRÉDITOS', 'AOL'),
  ('1.03.01.01', 'PARTICIPACAO EM OUTRAS EMPRESAS', 'I'),
  ('1.03.01.02', 'INCENTIVOS FISCAIS', 'I'),
  ('1.03.01.03', 'IMÓVEIS', 'I'),
  ('1.03.01.04', 'EQUIPAMENTOS E INSTALACOES', 'I'),
  ('1.03.01.05', 'VEÍCULOS', 'I'),
  ('1.03.03.01', 'IMOVEIS', 'I'),
  ('1.03.03.02', 'VEICULOS', 'I'),
  ('1.03.03.03', 'EQUIPAMENTOS E INSTALACOES INDUSTRIAIS', 'I'),
  ('1.03.03.04', 'EQUIPAMENTOS E INSTALACOES', 'I'),
  ('1.03.03.05', 'EQUIPAMENTOS DE INFORMATICA', 'I'),
  ('1.03.03.06', 'EQUIPAMENTOS E INSTALACOES AGRICOLAS', 'I'),
  ('1.03.03.07', 'IMOBILIZACOES EM ANDAMENTO', 'I'),
  ('1.03.03.08', 'IMOBILIZACOES FORA DO ESTABELECIMENTO', 'I'),
  ('1.03.03.09', 'EQUIPAMENTOS E INSTALACOES DE SERVICOS', 'I'),
  ('1.03.03.10', '(-)DEPRECIACOES ACUMULADAS', 'D'),
  ('1.03.04.01', 'INTANGIVEL', 'I'),
  ('1.03.04.02', '(-) AMORTIZAÇÕES ACUMULADAS', 'D'),
  ('2.01.01.01', 'FORNECEDORES', 'POF'),
  ('2.01.01.02', 'ENCARGOS SOCIAIS E TRABALHISTAS', 'POS'),
  ('2.01.01.03', 'PROVISOES SOCIAIS', 'POS'),
  ('2.01.01.04', 'REMUNERACOES A PAGAR', 'POS'),
  ('2.01.01.07', 'IMPOSTOS E CONTRIBUICOES A RECOLHER', 'POT'),
  ('2.01.01.08', 'TRIBUTOS S/ RESULTADO', 'POT'),
  ('2.01.01.09', 'OUTROS DEBITOS', 'POO'),
  ('2.01.01.10', 'EMPRESTIMOS E FINANCIAMENTOS', 'FE'),
  ('2.01.01.11', 'OBRIGACOES BANCARIAS', 'FE'),
  ('2.01.01.13', 'CONTAS CORRENTES', 'FO'),
  ('2.01.03.07', 'CONTAS CORRENTES - MATRIZ E FILIAIS', 'C'),
  ('2.02.01.01', 'EMPRESTIMOS E FINANCIAMENTOS BANCARIOS', 'FE'),
  ('2.02.01.02', 'EMPRESTIMOS A PESSOAS LIGADAS/MUTUO', 'FE'),
  ('2.02.01.03', 'TRIBUTOS PARCELADOS', 'POT'),
  ('2.02.01.04', 'OBRIGAÇÕES COM TERCEIROS', 'FO'),
  ('2.02.01.05', 'VENDAS ANTECIPADAS DE IMOVEIS', 'POO'),
  ('2.02.01.06', 'CONTAS CORRENTES', 'FE'),
  ('2.02.01.07', 'RECEITAS DIFERIDAS RENDIMENTOS APLICAÇÃO FINANCEIRA', 'POO'),
  ('2.02.01.08', 'RECEITAS DIFERIDAS', 'FO'),
  ('2.02.02.02', '(-)ENCARGOS FINANCEIROS - LP', 'FE'),
  ('2.04.01.01', 'RESULTADO DE LIQUIDACAO', 'POO'),
  ('2.05.01.01', 'CAPITAL SOCIAL', 'FL'),
  ('2.05.01.02', 'RESERVAS', 'FL'),
  ('2.05.01.03', 'AJUSTES DE AVALIACAO PATRIMONIAL', 'FL'),
  ('2.05.01.04', 'ADIANTAMENTO PARA FUTURO AUMENTO DE CAPITAL', 'FL'),
  ('2.05.01.05', 'RESERVAS DE LUCROS', 'FL'),
  ('2.05.01.06', 'RESERVAS DE CAPITAL', 'FL'),
  ('2.05.01.08', 'LUCROS ACUMULADOS', 'FL'),
  ('2.05.01.09', 'LUCROS (PREJUIZOS) ACUMULADOS', 'FL'),
  ('2.05.01.10', 'CONTA CISÃO', 'FL'),
  ('2.05.01.11', '(-) AÇÕES EM TESOURARIA', 'FL'),
  ('1.01.01', 'DISPONIVEL', 'C'),
  ('3.99', 'RESULTADO LIQUIDO DO EXERCICIO', 'R')
ON CONFLICT (classificacao) DO UPDATE SET codigo_dfc = EXCLUDED.codigo_dfc, descricao_referencia = EXCLUDED.descricao_referencia;

-- ------------------------------------------------------------
-- 3) Coluna do código na conta + derivação de dfc_atividade
-- ------------------------------------------------------------
ALTER TABLE public.plano_contas
  ADD COLUMN IF NOT EXISTS dfc_codigo text REFERENCES public.dfc_catalogo(codigo);

-- A regra antiga era "flag de DFC só em conta analítica", porque a flag
-- era o que o cálculo somava. Agora a SINTÉTICA também carrega o código:
-- é assim que um cliente novo herda "Variação de Clientes" sem estar
-- listado na planilha. O cálculo continua somando apenas analíticas
-- (buildDFC filtra is_sintetica = false), então não há dupla contagem.
ALTER TABLE public.plano_contas DROP CONSTRAINT IF EXISTS plano_contas_dfc_chk;
ALTER TABLE public.plano_contas
  ADD CONSTRAINT plano_contas_dfc_chk CHECK (
    dfc_atividade IS NULL
    OR dfc_atividade IN ('caixa','operacional','investimento','financiamento')
  );

CREATE INDEX IF NOT EXISTS idx_plano_contas_dfc_codigo
  ON public.plano_contas (tenant_id, company_id, dfc_codigo)
  WHERE dfc_codigo IS NOT NULL;

-- Mantém dfc_atividade / dfc_nao_caixa em sincronia com o código, para
-- o motor de DFC e as telas existentes continuarem funcionando sem
-- precisarem conhecer os 20 códigos.
CREATE OR REPLACE FUNCTION public.sincronizar_dfc_atividade()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _bloco text;
BEGIN
  IF NEW.dfc_codigo IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT bloco INTO _bloco FROM public.dfc_catalogo WHERE codigo = NEW.dfc_codigo;
  IF _bloco IN ('caixa','operacional','investimento','financiamento') THEN
    NEW.dfc_atividade := _bloco;
    NEW.dfc_nao_caixa := false;
  ELSIF _bloco = 'nao_caixa' THEN
    NEW.dfc_atividade := NULL;
    NEW.dfc_nao_caixa := true;
  ELSE -- 'resultado': já entra pelo lucro líquido, fica fora dos blocos
    NEW.dfc_atividade := NULL;
    NEW.dfc_nao_caixa := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sincronizar_dfc ON public.plano_contas;
CREATE TRIGGER trg_sincronizar_dfc
  BEFORE INSERT OR UPDATE OF dfc_codigo ON public.plano_contas
  FOR EACH ROW EXECUTE FUNCTION public.sincronizar_dfc_atividade();

-- ------------------------------------------------------------
-- 4) Aplicar o padrão a um plano
-- ------------------------------------------------------------
-- Casa por classificação: exata primeiro, senão o prefixo mais longo
-- do padrão que seja ancestral da conta. Assim uma conta analítica
-- nova (cliente/fornecedor) herda o código do grupo dela sem precisar
-- estar listada na planilha.
CREATE OR REPLACE FUNCTION public.aplicar_dfc_padrao(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _sobrescrever boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int := 0;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  WITH alvo AS (
    SELECT p.id, p.classificacao
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM _company_id
       AND (_sobrescrever OR p.dfc_codigo IS NULL)
  ),
  casado AS (
    SELECT a.id,
           (SELECT d.codigo_dfc
              FROM public.dfc_padrao d
             WHERE a.classificacao = d.classificacao
                OR left(a.classificacao, length(d.classificacao) + 1) = d.classificacao || '.'
             ORDER BY length(d.classificacao) DESC
             LIMIT 1) AS codigo
      FROM alvo a
  ),
  upd AS (
    UPDATE public.plano_contas p
       SET dfc_codigo = c.codigo
      FROM casado c
     WHERE p.id = c.id AND c.codigo IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM upd;

  RETURN jsonb_build_object('contas_vinculadas', _n);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.aplicar_dfc_padrao(uuid, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.aplicar_dfc_padrao(uuid, uuid, boolean) TO authenticated, service_role;

-- Aplica automaticamente nos planos que já existem
DO $$
DECLARE r record; _res jsonb; _t int := 0;
BEGIN
  FOR r IN SELECT DISTINCT tenant_id, company_id FROM public.plano_contas LOOP
    WITH alvo AS (
      SELECT p.id, p.classificacao FROM public.plano_contas p
       WHERE p.tenant_id = r.tenant_id
         AND p.company_id IS NOT DISTINCT FROM r.company_id
         AND p.dfc_codigo IS NULL
    ), casado AS (
      SELECT a.id,
             (SELECT d.codigo_dfc FROM public.dfc_padrao d
               WHERE a.classificacao = d.classificacao
                  OR left(a.classificacao, length(d.classificacao) + 1) = d.classificacao || '.'
               ORDER BY length(d.classificacao) DESC LIMIT 1) AS codigo
        FROM alvo a
    ), upd AS (
      UPDATE public.plano_contas p SET dfc_codigo = c.codigo
        FROM casado c WHERE p.id = c.id AND c.codigo IS NOT NULL
      RETURNING 1
    ) SELECT count(*) INTO _t FROM upd;
    RAISE NOTICE 'DFC padrão aplicado: % contas (tenant %, company %)', _t, r.tenant_id, r.company_id;
  END LOOP;
END $$;
