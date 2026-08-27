
-- ============================================================
-- 20260914000001_dre_ggf_e_indicadores_globais.sql
-- ============================================================

-- GGF: Energia ElÃ©trica (4201) e ServiÃ§os de IndustrializaÃ§Ã£o (4239)
-- compartilhavam 3.02.01.10.01 â€” a DRE mostrava o nome errado.
-- Indicadores globais da lista do escritÃ³rio (company_id nulo).

UPDATE public.plano_padrao_referencia
   SET classificacao = '3.02.01.10.39',
       conta_pai_classificacao = '3.02.01.10'
 WHERE codigo = '4239'
   AND classificacao = '3.02.01.10.01';

UPDATE public.plano_contas
   SET classificacao = '3.02.01.10.39',
       conta_pai_classificacao = '3.02.01.10'
 WHERE codigo = '4239'
   AND classificacao = '3.02.01.10.01';

CREATE OR REPLACE FUNCTION public.semear_indicadores_globais(
  _tenant_id uuid,
  _substituir boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _n int := 0;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissÃ£o';
  END IF;

  IF _substituir THEN
    DELETE FROM public.indicadores_empresa
     WHERE tenant_id = _tenant_id AND company_id IS NULL AND is_padrao = true;
  END IF;

  WITH def(nome, categoria, modo, descricao, ordem, vis, expressao, faixas) AS (VALUES
    ('Giro do Ativo','Atividade','numero',
     'Receita LÃ­quida / Ativo Total', 10, 'ambos',
     jsonb_build_array(_termo('RECEITA_LIQUIDA'), _op('/'), _termo('ATIVO_TOTAL')),
     jsonb_build_object('otimo',1.5,'bom',1.0,'atencao',0.5,'direcao','maior_melhor')),
    ('Prazo MÃ©dio de Pagamento','Atividade','numero',
     '(Fornecedores / Custo da mercadoria) Ã— 30 â€” EI + compras âˆ’ deduÃ§Ãµes âˆ’ EF', 20, 'ambos',
     jsonb_build_array(_par('('), _termo('FORNECEDORES'), _op('/'),
                       _par('('), _num(0), _op('-'), _termo('CUSTO_MERCADORIA'), _par(')'), _par(')'),
                       _op('*'), _num(30)),
     jsonb_build_object('otimo',45,'bom',30,'atencao',15,'direcao','maior_melhor')),
    ('Prazo MÃ©dio de Recebimento','Atividade','numero',
     '(Contas a Receber / Receita Bruta) Ã— 30', 30, 'ambos',
     jsonb_build_array(_par('('), _termo('CONTAS_A_RECEBER'), _op('/'), _termo('RECEITA_BRUTA'), _par(')'),
                       _op('*'), _num(30)),
     jsonb_build_object('otimo',30,'bom',45,'atencao',60,'direcao','menor_melhor')),
    ('Endividamento Geral','Endividamento','percentual',
     '(PC + PNC) / Ativo Total Ã— 100', 40, 'ambos',
     jsonb_build_array(_par('('), _termo('PASSIVO_CIRCULANTE'), _op('+'), _termo('PASSIVO_NAO_CIRCULANTE'), _par(')'),
                       _op('/'), _termo('ATIVO_TOTAL'), _op('*'), _num(100)),
     jsonb_build_object('otimo',40,'bom',60,'atencao',75,'direcao','menor_melhor')),
    ('ComposiÃ§Ã£o do Endividamento','Endividamento','percentual',
     'PC / (PC + PNC) Ã— 100', 50, 'ambos',
     jsonb_build_array(_termo('PASSIVO_CIRCULANTE'), _op('/'),
                       _par('('), _termo('PASSIVO_CIRCULANTE'), _op('+'), _termo('PASSIVO_NAO_CIRCULANTE'), _par(')'),
                       _op('*'), _num(100)),
     jsonb_build_object('otimo',40,'bom',60,'atencao',75,'direcao','menor_melhor')),
    ('ImobilizaÃ§Ã£o do PL','Endividamento','percentual',
     'Imobilizado / PatrimÃ´nio LÃ­quido Ã— 100', 60, 'ambos',
     jsonb_build_array(_termo('IMOBILIZADO'), _op('/'), _termo('PATRIMONIO_LIQUIDO'), _op('*'), _num(100)),
     jsonb_build_object('otimo',50,'bom',80,'atencao',100,'direcao','menor_melhor')),
    ('DÃ­vida LÃ­quida / EBITDA','Endividamento','numero',
     '(EmprÃ©stimos âˆ’ DisponÃ­vel) / EBITDA', 70, 'ambos',
     jsonb_build_array(_par('('), _termo('EMPRESTIMOS'), _op('-'), _termo('DISPONIVEL'), _par(')'),
                       _op('/'), _termo('EBITDA')),
     jsonb_build_object('otimo',1.5,'bom',3.0,'atencao',4.5,'direcao','menor_melhor')),
    ('Liquidez Corrente','Liquidez','numero',
     'Ativo Circulante / Passivo Circulante', 80, 'ambos',
     jsonb_build_array(_termo('ATIVO_CIRCULANTE'), _op('/'), _termo('PASSIVO_CIRCULANTE')),
     jsonb_build_object('otimo',1.5,'bom',1.0,'atencao',0.8,'direcao','maior_melhor')),
    ('Liquidez Seca','Liquidez','numero',
     '(Ativo Circulante âˆ’ Estoques) / Passivo Circulante', 90, 'ambos',
     jsonb_build_array(_par('('), _termo('ATIVO_CIRCULANTE'), _op('-'), _termo('ESTOQUES'), _par(')'),
                       _op('/'), _termo('PASSIVO_CIRCULANTE')),
     jsonb_build_object('otimo',1.0,'bom',0.8,'atencao',0.5,'direcao','maior_melhor')),
    ('Liquidez Imediata','Liquidez','numero',
     'DisponÃ­vel / Passivo Circulante', 100, 'ambos',
     jsonb_build_array(_termo('DISPONIVEL'), _op('/'), _termo('PASSIVO_CIRCULANTE')),
     jsonb_build_object('otimo',0.4,'bom',0.2,'atencao',0.1,'direcao','maior_melhor')),
    ('Liquidez Geral','Liquidez','numero',
     '(AC + Realizavel LP) / (PC + PNC)', 110, 'ambos',
     jsonb_build_array(_par('('), _termo('ATIVO_CIRCULANTE'), _op('+'), _termo('REALIZAVEL_LP'), _par(')'),
                       _op('/'),
                       _par('('), _termo('PASSIVO_CIRCULANTE'), _op('+'), _termo('PASSIVO_NAO_CIRCULANTE'), _par(')')),
     jsonb_build_object('otimo',1.2,'bom',1.0,'atencao',0.8,'direcao','maior_melhor')),
    ('Margem Bruta','Rentabilidade','percentual',
     'Lucro Bruto / Receita LÃ­quida Ã— 100', 120, 'ambos',
     jsonb_build_array(_termo('LUCRO_BRUTO'), _op('/'), _termo('RECEITA_LIQUIDA'), _op('*'), _num(100)),
     jsonb_build_object('otimo',30,'bom',20,'atencao',10,'direcao','maior_melhor')),
    ('Margem LÃ­quida','Rentabilidade','percentual',
     'Lucro LÃ­quido / Receita LÃ­quida Ã— 100', 130, 'ambos',
     jsonb_build_array(_termo('LUCRO_LIQUIDO'), _op('/'), _termo('RECEITA_LIQUIDA'), _op('*'), _num(100)),
     jsonb_build_object('otimo',15,'bom',8,'atencao',3,'direcao','maior_melhor')),
    ('Ebit','Rentabilidade','reais',
     'Resultado operacional (EBIT) da DRE', 140, 'ambos',
     jsonb_build_array(_termo('EBIT')),
     NULL::jsonb),
    ('Ebitda','Rentabilidade','reais',
     'EBIT + depreciaÃ§Ã£o/amortizaÃ§Ã£o', 150, 'ambos',
     jsonb_build_array(_termo('EBITDA')),
     NULL::jsonb),
    ('Margem Ebitda','Rentabilidade','percentual',
     'EBITDA / Receita LÃ­quida Ã— 100', 160, 'ambos',
     jsonb_build_array(_termo('EBITDA'), _op('/'), _termo('RECEITA_LIQUIDA'), _op('*'), _num(100)),
     jsonb_build_object('otimo',20,'bom',12,'atencao',5,'direcao','maior_melhor')),
    ('Margem Operacional','Rentabilidade','percentual',
     'EBIT / Receita LÃ­quida Ã— 100', 170, 'ambos',
     jsonb_build_array(_termo('EBIT'), _op('/'), _termo('RECEITA_LIQUIDA'), _op('*'), _num(100)),
     jsonb_build_object('otimo',15,'bom',8,'atencao',3,'direcao','maior_melhor')),
    ('ROA','Rentabilidade','percentual',
     'Lucro LÃ­quido / Ativo Total Ã— 100', 180, 'ambos',
     jsonb_build_array(_termo('LUCRO_LIQUIDO'), _op('/'), _termo('ATIVO_TOTAL'), _op('*'), _num(100)),
     jsonb_build_object('otimo',10,'bom',5,'atencao',2,'direcao','maior_melhor')),
    ('ROE','Rentabilidade','percentual',
     'Lucro LÃ­quido / PatrimÃ´nio LÃ­quido Ã— 100', 190, 'ambos',
     jsonb_build_array(_termo('LUCRO_LIQUIDO'), _op('/'), _termo('PATRIMONIO_LIQUIDO'), _op('*'), _num(100)),
     jsonb_build_object('otimo',15,'bom',10,'atencao',5,'direcao','maior_melhor'))
  ),
  ins AS (
    INSERT INTO public.indicadores_empresa
      (tenant_id, company_id, nome, categoria, formula, modo_analise, faixas,
       descricao, visibilidade, is_padrao, ordem)
    SELECT _tenant_id, NULL, d.nome, d.categoria,
           jsonb_build_object('expressao', d.expressao), d.modo, d.faixas,
           d.descricao, d.vis, true, d.ordem
      FROM def d
     WHERE NOT EXISTS (
       SELECT 1 FROM public.indicadores_empresa e
        WHERE e.tenant_id = _tenant_id AND e.company_id IS NULL
          AND lower(e.nome) = lower(d.nome)
     )
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM ins;

  RETURN jsonb_build_object('indicadores_criados', _n);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.semear_indicadores_globais(uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.semear_indicadores_globais(uuid, boolean) TO authenticated, service_role;

DO $seed$
DECLARE r record; _res jsonb;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    SELECT public.semear_indicadores_globais(r.id, false) INTO _res;
  END LOOP;
END;
$seed$;


-- ============================================================
-- 20260915000001_dre_linhas_config.sql
-- ============================================================

-- ConfiguraÃ§Ã£o das linhas gerenciais EBIT e EBITDA da DRE.
--
-- A DRE jÃ¡ fecha com os acumuladores do plano. EBIT/EBITDA sÃ£o linhas
-- extras no final, e de onde elas puxam valor muda de escritÃ³rio para
-- escritÃ³rio (resultado operacional vs. um conjunto de contas). Isso
-- nÃ£o Ã© fÃ³rmula de indicador â€” senÃ£o o indicador Ebit apontaria para a
-- linha da DRE que aponta de volta para o indicador.
--
-- Uma linha por escritÃ³rio. ClassificaÃ§Ãµes vazias = usar o papel da
-- `estrutura_padrao` (EBIT corrido em 3.10.99; tags de D&A).

CREATE TABLE IF NOT EXISTS public.dre_linhas_config (
  tenant_id              uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  ebit_classificacoes    text[] NOT NULL DEFAULT '{}',
  ebitda_classificacoes  text[] NOT NULL DEFAULT '{}',
  ebitda_sobre_ebit      boolean NOT NULL DEFAULT true,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dre_linhas_config IS
  'AlocaÃ§Ã£o das linhas EBIT e EBITDA da DRE: de quais classificaÃ§Ãµes do plano padrÃ£o puxar os valores.';
COMMENT ON COLUMN public.dre_linhas_config.ebitda_sobre_ebit IS
  'true = EBITDA = EBIT âˆ’ contas de D&A (despesa na DRE). false = EBITDA Ã© sÃ³ a soma das classificaÃ§Ãµes de EBITDA.';

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


-- ============================================================
-- 20260916000001_drilldown_por_codigo_conta.sql
-- ============================================================

-- Folha da DRE/BP passou a guardar o CÃ“DIGO da conta (nÃ£o sÃ³ a classificaÃ§Ã£o).
-- drilldown_contas sÃ³ casava prefixo de classificaÃ§Ã£o e a gaveta abria vazia.

CREATE OR REPLACE FUNCTION public.drilldown_contas(
  _company_id uuid,
  _classificacao text,
  _competencia_min date DEFAULT NULL,
  _competencia_max date DEFAULT NULL
)
RETURNS TABLE (codigo text, descricao text, classificacao text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _scope uuid; _usa_padrao boolean; _usa_depara boolean; _esc jsonb;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissÃ£o';
  END IF;
  _esc := public.escopo_plano_empresa(_company_id);
  _tenant := (_esc->>'tenant_id')::uuid;
  _usa_padrao := COALESCE((_esc->>'usa_plano_padrao')::boolean, false);
  _usa_depara := COALESCE((_esc->>'usa_depara')::boolean, false);
  IF _tenant IS NULL THEN RETURN; END IF;
  _scope := CASE WHEN _usa_padrao THEN NULL ELSE _company_id END;

  IF NOT _usa_depara THEN
    RETURN QUERY
    WITH com_mov AS (
      SELECT DISTINCT l.conta_codigo FROM public.lancamentos_diario l
       WHERE l.company_id = _company_id
         AND (_competencia_min IS NULL OR l.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR l.competencia <= _competencia_max)
      UNION
      SELECT DISTINCT sa.conta_codigo FROM public.saldos_abertura sa
       WHERE sa.company_id = _company_id
      UNION
      SELECT DISTINCT sm.conta_codigo FROM public.saldos_mensais sm
       WHERE sm.company_id = _company_id
         AND (_competencia_min IS NULL OR sm.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR sm.competencia <= _competencia_max)
    )
    SELECT p.codigo, p.descricao, p.classificacao
      FROM com_mov m
      JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _scope
       AND p.codigo = m.conta_codigo
     WHERE p.is_sintetica = false
       AND (p.codigo = _classificacao
            OR p.classificacao = _classificacao
            OR left(p.classificacao, length(_classificacao) + 1) = _classificacao || '.')
     ORDER BY p.classificacao, p.codigo;
  ELSE
    RETURN QUERY
    WITH com_mov AS (
      SELECT DISTINCT l.conta_codigo FROM public.lancamentos_diario l
       WHERE l.company_id = _company_id
         AND (_competencia_min IS NULL OR l.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR l.competencia <= _competencia_max)
      UNION
      SELECT DISTINCT sa.conta_codigo FROM public.saldos_abertura sa
       WHERE sa.company_id = _company_id
      UNION
      SELECT DISTINCT sm.conta_codigo FROM public.saldos_mensais sm
       WHERE sm.company_id = _company_id
         AND (_competencia_min IS NULL OR sm.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR sm.competencia <= _competencia_max)
    ),
    trad AS (
      SELECT t.conta_codigo, t.conta_padrao_codigo
        FROM public.depara_traducao(_company_id) t
       WHERE NOT t.ignorada AND t.conta_padrao_codigo IS NOT NULL
    ),
    resolvido AS (
      SELECT m.conta_codigo AS busca, tr.conta_padrao_codigo AS plano
        FROM com_mov m
        JOIN trad tr ON tr.conta_codigo = m.conta_codigo
      UNION
      SELECT m.conta_codigo, m.conta_codigo
        FROM com_mov m
       WHERE NOT EXISTS (SELECT 1 FROM trad tr WHERE tr.conta_codigo = m.conta_codigo)
         AND EXISTS (
           SELECT 1 FROM public.plano_contas p2
            WHERE p2.tenant_id = _tenant
              AND p2.company_id IS NOT DISTINCT FROM _scope
              AND p2.codigo = m.conta_codigo)
    )
    SELECT r.busca, COALESCE(o.descricao, p.descricao), p.classificacao
      FROM resolvido r
      JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _scope
       AND p.codigo = r.plano
      LEFT JOIN public.plano_contas o
        ON o.tenant_id = _tenant AND o.company_id = _company_id
       AND o.codigo = r.busca
     WHERE p.is_sintetica = false
       AND (p.codigo = _classificacao
            OR p.classificacao = _classificacao
            OR left(p.classificacao, length(_classificacao) + 1) = _classificacao || '.')
     ORDER BY p.classificacao, r.busca;
  END IF;
END;
$fn$;


-- ============================================================
-- 20260917000001_pmp_custo_mercadoria_e_faixas.sql
-- ============================================================

-- PMP: denominador = EI + compras âˆ’ deduÃ§Ãµes âˆ’ EF (sem MOD/GGF).
-- Faixas globais recalibradas para escritÃ³rio (indÃºstria/comÃ©rcio mistos).

INSERT INTO public.estrutura_padrao
  (classificacao, papel, demonstracao, tipo_linha, rotulo, ordem) VALUES
  ('3.02.01.01', 'ESTOQUE_INICIAL',  'DRE', 'detalhe', NULL, 41),
  ('3.02.01.02', 'COMPRAS',          'DRE', 'detalhe', NULL, 42),
  ('3.02.01.05', 'DEDUCOES_COMPRAS', 'DRE', 'detalhe', NULL, 43),
  ('3.02.01.06', 'ESTOQUE_FINAL',    'DRE', 'detalhe', NULL, 44),
  ('3.03.01.01', 'ESTOQUE_INICIAL',  'DRE', 'detalhe', NULL, 61),
  ('3.03.01.02', 'COMPRAS',          'DRE', 'detalhe', NULL, 62),
  ('3.03.01.04', 'DEDUCOES_COMPRAS', 'DRE', 'detalhe', NULL, 63),
  ('3.03.01.05', 'ESTOQUE_FINAL',    'DRE', 'detalhe', NULL, 64)
ON CONFLICT (classificacao, papel) DO UPDATE
  SET demonstracao = EXCLUDED.demonstracao,
      tipo_linha   = EXCLUDED.tipo_linha,
      ordem        = EXCLUDED.ordem;

UPDATE public.indicadores_empresa
   SET descricao = '(Fornecedores / Custo da mercadoria) Ã— 30 â€” EI + compras âˆ’ deduÃ§Ãµes âˆ’ EF, sem mÃ£o de obra/GGF',
       formula = jsonb_build_object(
         'expressao', jsonb_build_array(
           public._par('('), public._termo('FORNECEDORES'), public._op('/'),
           public._par('('), public._num(0), public._op('-'), public._termo('CUSTO_MERCADORIA'), public._par(')'),
           public._par(')'), public._op('*'), public._num(30)
         )
       )
 WHERE company_id IS NULL
   AND nome LIKE 'Prazo M% de Pagamento';

-- Faixas: referÃªncia de escritÃ³rio, editÃ¡veis por indicador.
-- LIKE evita falha de encoding no pipe Windows (acentos).
UPDATE public.indicadores_empresa SET faixas = '{"otimo":1.2,"bom":0.8,"atencao":0.5,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Giro do Ativo';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":45,"bom":30,"atencao":15,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome LIKE 'Prazo M% de Pagamento';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":30,"bom":45,"atencao":60,"direcao":"menor_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome LIKE 'Prazo M% de Recebimento';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":50,"bom":65,"atencao":80,"direcao":"menor_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Endividamento Geral';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":50,"bom":65,"atencao":80,"direcao":"menor_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome LIKE 'Composi% do Endividamento';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":80,"bom":120,"atencao":160,"direcao":"menor_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome LIKE 'Imobiliza% do PL';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":2,"bom":3.5,"atencao":5,"direcao":"menor_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome LIKE 'D%vida L%quida / EBITDA';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":1.3,"bom":1.0,"atencao":0.8,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Liquidez Corrente';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":1.0,"bom":0.7,"atencao":0.5,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Liquidez Seca';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":0.25,"bom":0.10,"atencao":0.05,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Liquidez Imediata';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":1.1,"bom":0.9,"atencao":0.7,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Liquidez Geral';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":25,"bom":15,"atencao":8,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Margem Bruta';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":10,"bom":5,"atencao":2,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome LIKE 'Margem L%quida';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":18,"bom":10,"atencao":4,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Margem Ebitda';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":12,"bom":6,"atencao":2,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'Margem Operacional';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":8,"bom":4,"atencao":1.5,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'ROA';
UPDATE public.indicadores_empresa SET faixas = '{"otimo":15,"bom":8,"atencao":4,"direcao":"maior_melhor"}'::jsonb
 WHERE company_id IS NULL AND nome = 'ROE';


-- ============================================================
-- 20260918000001_liquidez_geral_e_ebit_modos.sql
-- ============================================================

-- Liquidez Geral: (AC + Realizavel LP) / (PC + PNC), sem imobilizado.
-- EBIT/EBITDA: modos explicitos na config da DRE.

ALTER TABLE public.dre_linhas_config
  ADD COLUMN IF NOT EXISTS ebit_modo text NOT NULL DEFAULT 'estrutura',
  ADD COLUMN IF NOT EXISTS ebitda_modo text NOT NULL DEFAULT 'estrutura';

ALTER TABLE public.dre_linhas_config DROP CONSTRAINT IF EXISTS dre_linhas_ebit_modo_chk;
ALTER TABLE public.dre_linhas_config
  ADD CONSTRAINT dre_linhas_ebit_modo_chk
  CHECK (ebit_modo IN ('estrutura', 'soma'));

ALTER TABLE public.dre_linhas_config DROP CONSTRAINT IF EXISTS dre_linhas_ebitda_modo_chk;
ALTER TABLE public.dre_linhas_config
  ADD CONSTRAINT dre_linhas_ebitda_modo_chk
  CHECK (ebitda_modo IN ('estrutura', 'ebit_mais', 'soma'));

UPDATE public.dre_linhas_config
   SET ebit_modo = 'soma'
 WHERE ebit_modo = 'estrutura'
   AND cardinality(ebit_classificacoes) > 0;

UPDATE public.dre_linhas_config
   SET ebitda_modo = CASE
         WHEN cardinality(ebitda_classificacoes) > 0 AND ebitda_sobre_ebit = false THEN 'soma'
         WHEN cardinality(ebitda_classificacoes) > 0 THEN 'ebit_mais'
         ELSE ebitda_modo
       END
 WHERE cardinality(ebitda_classificacoes) > 0;

INSERT INTO public.estrutura_padrao
  (classificacao, papel, demonstracao, tipo_linha, rotulo, ordem)
VALUES
  ('1.03.00', 'REALIZAVEL_LP', 'BP_ATIVO', 'tag', NULL, 55)
ON CONFLICT (classificacao, papel) DO UPDATE
  SET demonstracao = EXCLUDED.demonstracao,
      tipo_linha   = EXCLUDED.tipo_linha,
      ordem        = EXCLUDED.ordem;

UPDATE public.indicadores_empresa
   SET descricao = '(AC + Realizavel LP) / (PC + PNC)',
       formula = jsonb_build_object(
         'expressao', jsonb_build_array(
           public._par('('), public._termo('ATIVO_CIRCULANTE'), public._op('+'),
           public._termo('REALIZAVEL_LP'), public._par(')'),
           public._op('/'),
           public._par('('), public._termo('PASSIVO_CIRCULANTE'), public._op('+'),
           public._termo('PASSIVO_NAO_CIRCULANTE'), public._par(')')
         )
       )
 WHERE company_id IS NULL
   AND nome LIKE 'Liquidez Geral';


-- ============================================================
-- 20260919000001_ebit_formula_e_dashboard_global.sql
-- ============================================================

-- EBIT/EBITDA: formula igual indicador.
-- Dashboard: config global do escritorio (company_id nulo).

ALTER TABLE public.dre_linhas_config
  ADD COLUMN IF NOT EXISTS ebit_expressao jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ebitda_expressao jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.dre_linhas_config
   SET ebit_expressao = jsonb_build_array(
         jsonb_build_object(
           'tipo','termo','origem','conta',
           'contas', ebit_classificacoes,
           'sinais', (
             SELECT COALESCE(jsonb_agg('+'::text), '[]'::jsonb)
               FROM unnest(ebit_classificacoes)
           )
         )
       )
 WHERE cardinality(ebit_classificacoes) > 0
   AND (ebit_expressao = '[]'::jsonb OR ebit_expressao IS NULL);

UPDATE public.dre_linhas_config
   SET ebitda_expressao = jsonb_build_array(
         jsonb_build_object(
           'tipo','termo','origem','conta',
           'contas', ebitda_classificacoes,
           'sinais', (
             SELECT COALESCE(jsonb_agg('+'::text), '[]'::jsonb)
               FROM unnest(ebitda_classificacoes)
           )
         )
       )
 WHERE cardinality(ebitda_classificacoes) > 0
   AND (ebitda_expressao = '[]'::jsonb OR ebitda_expressao IS NULL);

ALTER TABLE public.dashboard_config
  ALTER COLUMN company_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_config_global_uq
  ON public.dashboard_config (tenant_id, bloco)
  WHERE company_id IS NULL;

INSERT INTO public.dashboard_config (tenant_id, company_id, bloco, visivel, ordem, config)
SELECT DISTINCT ON (tenant_id, bloco)
       tenant_id, NULL, bloco, visivel, ordem, config
  FROM public.dashboard_config
 WHERE company_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.dashboard_config g
      WHERE g.tenant_id = dashboard_config.tenant_id
        AND g.bloco = dashboard_config.bloco
        AND g.company_id IS NULL
   )
 ORDER BY tenant_id, bloco, updated_at DESC;

