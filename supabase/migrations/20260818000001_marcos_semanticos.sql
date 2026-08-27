-- ============================================================
-- AJUSTE 03 — o plano de contas É a estrutura da demonstração.
--
-- Correção de rumo: alocar "1.01 -> Ativo Circulante" era redundante,
-- porque a conta 1.01 JÁ É "ATIVO CIRCULANTE" no plano. A hierarquia
-- do plano (1 > 1.01 > 1.01.01 > ...) já é a árvore da demonstração.
-- O BI passa a renderizar essa árvore direto.
--
-- Some, então:
--   - plano_contas.tipo_demonstracao / linha_demonstracao / ordem_linha
--   - a tabela mapeamento_demonstracao (legado, já sem uso pelo motor)
--
-- Fica o que a hierarquia NÃO consegue dizer sozinha:
--   - dfc_atividade / dfc_nao_caixa  (ajuste 01) — como a conta move o caixa
--   - marco (novo)                   — onde cortar os subtotais
--
-- Por que "marco": um plano dá a árvore, mas não diz onde termina a
-- Receita Bruta nem onde começa o Custo — e é disso que dependem
-- Receita Líquida, Lucro Bruto, EBIT e praticamente todo indicador.
-- São ~10 marcações em contas SINTÉTICAS, uma única vez, no Plano
-- Padrão. Não é alocar conta a conta: é dizer "esta sintética aqui é
-- a Receita Bruta".
-- ============================================================

-- ------------------------------------------------------------
-- 1) Marcos semânticos
-- ------------------------------------------------------------
ALTER TABLE public.plano_contas
  ADD COLUMN IF NOT EXISTS marco text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plano_contas_marco_chk') THEN
    ALTER TABLE public.plano_contas ADD CONSTRAINT plano_contas_marco_chk CHECK (
      marco IS NULL OR marco IN (
        -- DRE
        'receita_bruta','deducoes','custos',
        'despesas_operacionais','despesas_administrativas','despesas_comerciais',
        'despesas_tributarias','outras_receitas','outras_despesas',
        'receitas_financeiras','despesas_financeiras',
        'irpj','csll','distribuicao_lucros',
        -- Balanço
        'ativo_circulante','ativo_nao_circulante','realizavel_longo_prazo',
        'investimentos','imobilizado','intangivel',
        'passivo_circulante','passivo_nao_circulante',
        'patrimonio_liquido','capital_social','reservas','lucros_acumulados'
      )
    );
  END IF;
END $$;

COMMENT ON COLUMN public.plano_contas.marco IS
  'Papel semântico da conta sintética na demonstração. Não define estrutura (a hierarquia do plano faz isso) — define onde os subtotais e os indicadores encontram seus limites.';

-- Um marco não pode se repetir dentro do mesmo plano: duas contas
-- marcadas como "receita_bruta" tornariam o subtotal ambíguo.
CREATE UNIQUE INDEX IF NOT EXISTS plano_contas_marco_unico
  ON public.plano_contas (
    tenant_id,
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    marco
  )
  WHERE marco IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plano_contas_marco
  ON public.plano_contas (tenant_id, company_id, marco)
  WHERE marco IS NOT NULL;

-- ------------------------------------------------------------
-- 2) Semente dos marcos a partir da descrição das sintéticas
-- ------------------------------------------------------------
-- Reaproveita as mesmas expressões que viviam em suggest-mapping.ts
-- (que ficou sem uso desde o ajuste 01). Ordem importa: específico
-- antes de genérico — "deduções da receita bruta" tem que casar como
-- dedução, não como receita.
-- Interna: SEM checagem de permissão, para poder rodar durante a
-- migration (onde não existe sessão e auth.uid() é NULL). Não recebe
-- GRANT para `authenticated` — só a wrapper pública abaixo é chamável.
CREATE OR REPLACE FUNCTION public._semear_marcos_interno(_tenant_id uuid, _company_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _regras text[][] := ARRAY[
    -- DRE (a ordem deste array É a precedência)
    ARRAY['deduc',                                          'deducoes'],
    ARRAY['receita.*bruta|receita de venda|receita de prestac','receita_bruta'],
    ARRAY['custo',                                          'custos'],
    ARRAY['despesa.*administra',                            'despesas_administrativas'],
    ARRAY['despesa.*(vend|comerci)',                        'despesas_comerciais'],
    ARRAY['despesa.*tribut',                                'despesas_tributarias'],
    ARRAY['despesa.*financ',                                'despesas_financeiras'],
    ARRAY['receita.*financ',                                'receitas_financeiras'],
    ARRAY['despesa.*operac',                                'despesas_operacionais'],
    ARRAY['outras receitas',                                'outras_receitas'],
    ARRAY['outras despesas',                                'outras_despesas'],
    ARRAY['provis.*contribuic|csll|contribuic.*social',     'csll'],
    ARRAY['provis.*imposto.*renda|imposto.*renda|provis.*ir\\M','irpj'],
    ARRAY['distribuic.*lucro',                              'distribuicao_lucros'],
    -- Balanço
    ARRAY['ativo.*nao circulante|nao circulante.*ativo',    'ativo_nao_circulante'],
    ARRAY['realizavel.*longo',                              'realizavel_longo_prazo'],
    ARRAY['investiment',                                    'investimentos'],
    ARRAY['imobiliz',                                       'imobilizado'],
    ARRAY['intang',                                         'intangivel'],
    ARRAY['ativo.*circulante|circulante.*ativo',            'ativo_circulante'],
    ARRAY['passivo.*nao circulante|exigivel.*longo',        'passivo_nao_circulante'],
    ARRAY['capital social',                                 'capital_social'],
    ARRAY['reserva',                                        'reservas'],
    ARRAY['lucros?.*acumulad|prejuizos?.*acumulad',         'lucros_acumulados'],
    ARRAY['patrimonio liquido',                             'patrimonio_liquido'],
    ARRAY['passivo.*circulante|circulante.*passivo',        'passivo_circulante']
  ];
  _i int;
  _rx text;
  _marco text;
  _n int;
  _total int := 0;
  _tipos text[];
BEGIN
  FOR _i IN 1 .. array_length(_regras, 1) LOOP
    _rx := _regras[_i][1];
    _marco := _regras[_i][2];

    -- restringe o tipo de conta compatível com o marco
    _tipos := CASE
      WHEN _marco IN ('ativo_circulante','ativo_nao_circulante','realizavel_longo_prazo',
                      'investimentos','imobilizado','intangivel') THEN ARRAY['1-Ativo']
      WHEN _marco IN ('passivo_circulante','passivo_nao_circulante','patrimonio_liquido',
                      'capital_social','reservas','lucros_acumulados') THEN ARRAY['2-Passivo']
      ELSE ARRAY['3-DRE']
    END;

    -- Só marca se o marco ainda não existe neste plano (não sobrescreve
    -- decisão manual) e escolhe a conta MAIS RASA que casa — a sintética
    -- que representa o grupo, não uma folha qualquer.
    UPDATE public.plano_contas p
       SET marco = _marco
     WHERE p.id = (
       SELECT p2.id
         FROM public.plano_contas p2
        WHERE p2.tenant_id = _tenant_id
          AND p2.company_id IS NOT DISTINCT FROM _company_id
          AND p2.is_sintetica = true
          AND p2.marco IS NULL
          AND p2.tipo = ANY(_tipos)
          AND unaccent_simples(p2.descricao) ~ _rx
        ORDER BY p2.nivel ASC, length(p2.classificacao) ASC, p2.classificacao ASC
        LIMIT 1
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.plano_contas p3
        WHERE p3.tenant_id = _tenant_id
          AND p3.company_id IS NOT DISTINCT FROM _company_id
          AND p3.marco = _marco
     );
    GET DIAGNOSTICS _n = ROW_COUNT;
    _total := _total + _n;
  END LOOP;

  RETURN jsonb_build_object('marcos_definidos', _total);
END;
$$;

-- Normalização sem depender da extensão unaccent (pode não estar
-- habilitada no projeto): minúsculas + remoção de acentos comuns em pt-BR.
CREATE OR REPLACE FUNCTION public.unaccent_simples(_s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT translate(
    lower(COALESCE(_s, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
  );
$$;

-- Pública: valida permissão e delega. É esta que a tela chama.
CREATE OR REPLACE FUNCTION public.semear_marcos(_tenant_id uuid, _company_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.pode_gerenciar_tenant(_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o plano deste escritório';
  END IF;
  RETURN public._semear_marcos_interno(_tenant_id, _company_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._semear_marcos_interno(uuid, uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.semear_marcos(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.semear_marcos(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unaccent_simples(text) TO authenticated, service_role;

-- Aplica nos planos existentes (Plano Padrão de cada tenant + planos próprios)
-- Semeia todos os planos existentes. Chama a INTERNA de propósito:
-- durante a migration não há sessão autenticada, então a wrapper
-- pública bloquearia e o plano ficaria sem marcos silenciosamente.
DO $$
DECLARE r record; _res jsonb; _total int := 0;
BEGIN
  FOR r IN SELECT DISTINCT tenant_id, company_id FROM public.plano_contas LOOP
    _res := public._semear_marcos_interno(r.tenant_id, r.company_id);
    _total := _total + COALESCE((_res->>'marcos_definidos')::int, 0);
  END LOOP;
  RAISE NOTICE 'Marcos semeados: %', _total;
END $$;

-- ------------------------------------------------------------
-- FIM DA PARTE ADITIVA
-- ------------------------------------------------------------
-- A remoção das colunas de alocação (tipo_demonstracao,
-- linha_demonstracao, ordem_linha) e da tabela mapeamento_demonstracao
-- está no arquivo 20260818000002, que só pode ser aplicado DEPOIS que
-- o motor passar a montar as demonstrações pela hierarquia do plano.
-- Enquanto isso, esta migration é segura: só ACRESCENTA os marcos e
-- não tira nada de quem está lendo.
-- ------------------------------------------------------------
