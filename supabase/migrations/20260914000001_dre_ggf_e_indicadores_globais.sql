-- GGF: Energia Elétrica (4201) e Serviços de Industrialização (4239)
-- compartilhavam 3.02.01.10.01 — a DRE mostrava o nome errado.
-- Indicadores globais da lista do escritório (company_id nulo).

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
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  IF _substituir THEN
    DELETE FROM public.indicadores_empresa
     WHERE tenant_id = _tenant_id AND company_id IS NULL AND is_padrao = true;
  END IF;

  WITH def(nome, categoria, modo, descricao, ordem, vis, expressao, faixas) AS (VALUES
    ('Giro do Ativo','Atividade','numero',
     'Receita Líquida / Ativo Total', 10, 'ambos',
     jsonb_build_array(_termo('RECEITA_LIQUIDA'), _op('/'), _termo('ATIVO_TOTAL')),
     jsonb_build_object('otimo',1.5,'bom',1.0,'atencao',0.5,'direcao','maior_melhor')),
    ('Prazo Médio de Pagamento','Atividade','numero',
     '(Fornecedores / Custo da mercadoria) × 30 — EI + compras − deduções − EF', 20, 'ambos',
     jsonb_build_array(_par('('), _termo('FORNECEDORES'), _op('/'),
                       _par('('), _num(0), _op('-'), _termo('CUSTO_MERCADORIA'), _par(')'), _par(')'),
                       _op('*'), _num(30)),
     jsonb_build_object('otimo',45,'bom',30,'atencao',15,'direcao','maior_melhor')),
    ('Prazo Médio de Recebimento','Atividade','numero',
     '(Contas a Receber / Receita Bruta) × 30', 30, 'ambos',
     jsonb_build_array(_par('('), _termo('CONTAS_A_RECEBER'), _op('/'), _termo('RECEITA_BRUTA'), _par(')'),
                       _op('*'), _num(30)),
     jsonb_build_object('otimo',30,'bom',45,'atencao',60,'direcao','menor_melhor')),
    ('Endividamento Geral','Endividamento','percentual',
     '(PC + PNC) / Ativo Total × 100', 40, 'ambos',
     jsonb_build_array(_par('('), _termo('PASSIVO_CIRCULANTE'), _op('+'), _termo('PASSIVO_NAO_CIRCULANTE'), _par(')'),
                       _op('/'), _termo('ATIVO_TOTAL'), _op('*'), _num(100)),
     jsonb_build_object('otimo',40,'bom',60,'atencao',75,'direcao','menor_melhor')),
    ('Composição do Endividamento','Endividamento','percentual',
     'PC / (PC + PNC) × 100', 50, 'ambos',
     jsonb_build_array(_termo('PASSIVO_CIRCULANTE'), _op('/'),
                       _par('('), _termo('PASSIVO_CIRCULANTE'), _op('+'), _termo('PASSIVO_NAO_CIRCULANTE'), _par(')'),
                       _op('*'), _num(100)),
     jsonb_build_object('otimo',40,'bom',60,'atencao',75,'direcao','menor_melhor')),
    ('Imobilização do PL','Endividamento','percentual',
     'Imobilizado / Patrimônio Líquido × 100', 60, 'ambos',
     jsonb_build_array(_termo('IMOBILIZADO'), _op('/'), _termo('PATRIMONIO_LIQUIDO'), _op('*'), _num(100)),
     jsonb_build_object('otimo',50,'bom',80,'atencao',100,'direcao','menor_melhor')),
    ('Dívida Líquida / EBITDA','Endividamento','numero',
     '(Empréstimos − Disponível) / EBITDA', 70, 'ambos',
     jsonb_build_array(_par('('), _termo('EMPRESTIMOS'), _op('-'), _termo('DISPONIVEL'), _par(')'),
                       _op('/'), _termo('EBITDA')),
     jsonb_build_object('otimo',1.5,'bom',3.0,'atencao',4.5,'direcao','menor_melhor')),
    ('Liquidez Corrente','Liquidez','numero',
     'Ativo Circulante / Passivo Circulante', 80, 'ambos',
     jsonb_build_array(_termo('ATIVO_CIRCULANTE'), _op('/'), _termo('PASSIVO_CIRCULANTE')),
     jsonb_build_object('otimo',1.5,'bom',1.0,'atencao',0.8,'direcao','maior_melhor')),
    ('Liquidez Seca','Liquidez','numero',
     '(Ativo Circulante − Estoques) / Passivo Circulante', 90, 'ambos',
     jsonb_build_array(_par('('), _termo('ATIVO_CIRCULANTE'), _op('-'), _termo('ESTOQUES'), _par(')'),
                       _op('/'), _termo('PASSIVO_CIRCULANTE')),
     jsonb_build_object('otimo',1.0,'bom',0.8,'atencao',0.5,'direcao','maior_melhor')),
    ('Liquidez Imediata','Liquidez','numero',
     'Disponível / Passivo Circulante', 100, 'ambos',
     jsonb_build_array(_termo('DISPONIVEL'), _op('/'), _termo('PASSIVO_CIRCULANTE')),
     jsonb_build_object('otimo',0.4,'bom',0.2,'atencao',0.1,'direcao','maior_melhor')),
    ('Liquidez Geral','Liquidez','numero',
     '(AC + Realizavel LP) / (PC + PNC)', 110, 'ambos',
     jsonb_build_array(_par('('), _termo('ATIVO_CIRCULANTE'), _op('+'), _termo('REALIZAVEL_LP'), _par(')'),
                       _op('/'),
                       _par('('), _termo('PASSIVO_CIRCULANTE'), _op('+'), _termo('PASSIVO_NAO_CIRCULANTE'), _par(')')),
     jsonb_build_object('otimo',1.2,'bom',1.0,'atencao',0.8,'direcao','maior_melhor')),
    ('Margem Bruta','Rentabilidade','percentual',
     'Lucro Bruto / Receita Líquida × 100', 120, 'ambos',
     jsonb_build_array(_termo('LUCRO_BRUTO'), _op('/'), _termo('RECEITA_LIQUIDA'), _op('*'), _num(100)),
     jsonb_build_object('otimo',30,'bom',20,'atencao',10,'direcao','maior_melhor')),
    ('Margem Líquida','Rentabilidade','percentual',
     'Lucro Líquido / Receita Líquida × 100', 130, 'ambos',
     jsonb_build_array(_termo('LUCRO_LIQUIDO'), _op('/'), _termo('RECEITA_LIQUIDA'), _op('*'), _num(100)),
     jsonb_build_object('otimo',15,'bom',8,'atencao',3,'direcao','maior_melhor')),
    ('Ebit','Rentabilidade','reais',
     'Resultado operacional (EBIT) da DRE', 140, 'ambos',
     jsonb_build_array(_termo('EBIT')),
     NULL::jsonb),
    ('Ebitda','Rentabilidade','reais',
     'EBIT + depreciação/amortização', 150, 'ambos',
     jsonb_build_array(_termo('EBITDA')),
     NULL::jsonb),
    ('Margem Ebitda','Rentabilidade','percentual',
     'EBITDA / Receita Líquida × 100', 160, 'ambos',
     jsonb_build_array(_termo('EBITDA'), _op('/'), _termo('RECEITA_LIQUIDA'), _op('*'), _num(100)),
     jsonb_build_object('otimo',20,'bom',12,'atencao',5,'direcao','maior_melhor')),
    ('Margem Operacional','Rentabilidade','percentual',
     'EBIT / Receita Líquida × 100', 170, 'ambos',
     jsonb_build_array(_termo('EBIT'), _op('/'), _termo('RECEITA_LIQUIDA'), _op('*'), _num(100)),
     jsonb_build_object('otimo',15,'bom',8,'atencao',3,'direcao','maior_melhor')),
    ('ROA','Rentabilidade','percentual',
     'Lucro Líquido / Ativo Total × 100', 180, 'ambos',
     jsonb_build_array(_termo('LUCRO_LIQUIDO'), _op('/'), _termo('ATIVO_TOTAL'), _op('*'), _num(100)),
     jsonb_build_object('otimo',10,'bom',5,'atencao',2,'direcao','maior_melhor')),
    ('ROE','Rentabilidade','percentual',
     'Lucro Líquido / Patrimônio Líquido × 100', 190, 'ambos',
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
