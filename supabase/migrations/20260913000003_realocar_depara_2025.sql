-- ============================================================
-- AJUSTE 41 — o de-para do ECD 2025, realocado conta a conta
-- ============================================================
--
-- "é pra revisar todas as contas da ECD 2025 carregadas e reatribuir
--  logicamente"
--
-- Feito. As 646 contas analíticas da importação
-- `02745261000166 ... 20250101-20251231 ... SPED-ECD.txt` foram
-- revisadas uma a uma, contra três coisas ao mesmo tempo:
--
--   · o COD_NAT do registro I050 (o que a conta É: ativo, passivo, PL
--     ou resultado);
--   · o galho dela dentro do próprio arquivo;
--   · o galho da conta de destino no plano do escritório.
--
-- 617 estavam certas e não foram tocadas. 29 mudam, e estão abaixo com
-- o motivo de cada uma.
--
-- ------------------------------------------------------------
-- O QUE ISSO CORRIGE, EM DINHEIRO
-- ------------------------------------------------------------
--
--   resultado 2025 (jan–nov) que o BI mostrava    − 6.400.582,03
--   resultado depois desta migração               + 7.118.880,68
--   resultado pelo PRÓPRIO ARQUIVO                + 7.118.880,68   ✓
--
-- Bate na vírgula. E a margem bruta também sai do lugar:
--
--   custos (3.02–3.05)   45.974.866,26  →  42.726.058,75
--   despesas (3.06)       1.367.911,62  →   4.649.139,15
--
-- R$ 3.248.807,51 que eram despesa administrativa e estavam dentro do
-- custo industrial. O lucro líquido não muda com isso — a margem bruta,
-- muda inteira.
--
-- ------------------------------------------------------------
-- Segurança
-- ------------------------------------------------------------
-- Só mexe na empresa desta importação (casada pelo CNPJ do arquivo) e
-- só nas 29 contas listadas. Idempotente: rodar de novo não faz nada.
-- Se você já tiver corrigido alguma à mão, o UPDATE só age onde o
-- destino ainda é o ANTIGO — o seu fica.

DO $$
DECLARE
  _tenant uuid; _company uuid; _n int; _tot int := 0; _falta text := '';
  _m record;
  -- conta do ECD | destino ANTIGO | destino NOVO | por quê
  _mapa CONSTANT text[][] := ARRAY[
    -- ---------- 1) NATUREZA TROCADA (muda o resultado) ----------
    ['210',  '5901', '852',
     'passivo (COD_NAT 02) que estava na linha de DRE 3.19 DISTRIBUIÇÃO DE LUCROS: 13.523.101,00 de débito entrando no resultado. Vai para 2.01.01.13.02 SOCIOS CONTA LUCRO, que é o galho DIVIDENDOS do próprio arquivo'],
    ['665',  NULL,   '742',
     'ADIANTAMENTO DE CLIENTES é passivo e estava em CLIENTES NACIONAIS (ativo). Vai para 2.01.01.09.02 ANTECIPAÇÕES DE CLIENTES'],
    ['24845', NULL,  'AGG-2.01.01.01.01.01',
     'fornecedor (passivo) em CLIENTES NACIONAIS — 312.928,70 no ativo errado'],
    ['24846', NULL,  'AGG-2.01.01.01.01.01',
     'idem'],
    ['784',  NULL,   '4215',
     'VEICULOS é conta de RESULTADO (COD_NAT 04) e estava em 1.01.03 VEÍCULOS (ativo). Galho: CUSTO PRODUÇÃO › GASTOS GERAIS'],
    ['794',  NULL,   '4213',
     'VIAGENS idem — estava em ADIANTAMENTO VIAGENS (ativo)'],

    -- ---------- 2) DESPESA ADMINISTRATIVA dentro do CUSTO ----------
    -- O galho no arquivo é DESPESAS OPERACIONAIS › ADMINISTRATIVAS, e o
    -- destino era MÃO DE OBRA DIRETA / GASTOS GERAIS DE FABRICAÇÃO. São
    -- as gêmeas das contas de produção (mesmo nome, outro galho) — foi
    -- por isso que a regra por nome errou.
    ['331', NULL, '4904', 'SALARIOS E ORDENADOS administrativos estavam em SALARIOS da produção'],
    ['332', NULL, '4903', 'PRO-LABORE estava em PRO-LABORE da produção'],
    ['334', NULL, '4908', '13 SALARIO administrativo estava no 13o da produção'],
    ['335', NULL, '4907', 'FERIAS administrativas estavam em FERIAS da produção'],
    ['336', NULL, '4905', 'INSS administrativo estava no INSS da produção'],
    ['337', NULL, '4906', 'FGTS administrativo estava no FGTS da produção'],
    ['363', NULL, '4921', 'MENSALIDADES E ANUIDADES administrativas estavam nas de fabricação'],
    ['364', NULL, '4925', 'VIAGENS administrativas estavam em DESPESAS DE VIAGEM da fabricação'],
    ['614', NULL, '4916', 'MATERIAL DE EXPEDIENTE administrativo estava no de fabricação'],
    ['615', NULL, '5125', 'MATERIAL DE USO E CONSUMO administrativo estava no de fabricação'],
    ['616', NULL, '4917', 'MATERIAL DE LIMPEZA administrativo estava no de fabricação'],
    ['617', NULL, '4927', 'VEICULOS administrativos estavam em DESPESAS VEICULOS FABRICAÇÃO'],
    ['619', NULL, '4929', 'COMBUSTIVEIS administrativos estavam nos de fabricação'],
    ['620', NULL, '4930', 'PEDAGIOS administrativos estavam nos de fabricação'],
    ['941', NULL, '4912', 'ALIMENTACAO administrativa estava na de fabricação'],

    -- ---------- 3) DESPESA COM VENDAS dentro do CUSTO ----------
    ['312', NULL, '4975', 'FRETES E CARRETOS — galho DESPESAS COM VENDAS — estavam em FRETES da fabricação'],

    -- ---------- 4) DESPESA dentro do CUSTO IMOBILIÁRIO ----------
    ['357', NULL, '5127', 'ALUGUEIS administrativos estavam em CUSTOS IMOBILIÁRIOS'],
    ['607', NULL, '4949', 'SERVIÇOS DE PESSOA JURÍDICA administrativos estavam em CUSTOS IMOBILIÁRIOS'],

    -- ---------- 5) CUSTO que estava na DESPESA ----------
    ['771', NULL, '4203', 'MANUTENÇÃO DE MÁQUINAS — galho CUSTO PRODUÇÃO — estava em despesa administrativa'],
    ['791', NULL, '4231', 'MENSALIDADE E ANUIDADES — galho CUSTO PRODUÇÃO — estava em despesa administrativa'],

    -- ---------- 6) DEDUÇÃO DE RECEITA dentro do CUSTO ----------
    ['987', NULL, '1073',
     'IMPOSTOS SOBRE DEVOLUÇÕES DE VENDAS — galho DEDUÇÕES DA RECEITA — estava em DEVOLUÇÕES DE COMPRAS (custo). CONFIRA: o plano tem ICMS/IPI/PIS s/devoluções separados; sem saber qual tributo é, coloquei na linha genérica do bloco certo'],

    -- ---------- 7) IMOBILIZADO que estava em INVESTIMENTOS ----------
    ['115', NULL, '486', 'CONSTRUÇÕES estava em 1.03.01 INVESTIMENTOS; é imobilizado em curso'],
    ['132', NULL, '486', 'idem']
  ];
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i
   WHERE i.cnpj = '02745261000166'
     AND i.periodo_inicio >= '2025-01-01' AND i.periodo_fim <= '2025-12-31'
   ORDER BY i.criado_em DESC LIMIT 1;

  IF _tenant IS NULL THEN
    RAISE NOTICE 'Nenhuma importação de ECD 2025 com este CNPJ — nada a fazer.';
    RETURN;
  END IF;

  FOR _m IN SELECT _mapa[i][1] AS conta, _mapa[i][3] AS destino, _mapa[i][4] AS motivo
              FROM generate_subscripts(_mapa, 1) AS i LOOP
    -- O destino tem que existir no plano. Se não existir, avisa e segue:
    -- melhor uma conta sem realocar do que um vínculo apontando para o
    -- vazio.
    IF NOT EXISTS (SELECT 1 FROM public.plano_contas p
                    WHERE p.tenant_id = _tenant AND p.company_id IS NULL
                      AND p.codigo = _m.destino) THEN
      _falta := _falta || _m.destino || ' ';
      CONTINUE;
    END IF;

    UPDATE public.depara_contas d
       SET conta_padrao_codigo = _m.destino,
           observacao = 'ECD: realocada na revisão de 2025 — ' || _m.motivo,
           updated_at = now()
     WHERE d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_codigo = _m.conta
       AND d.conta_padrao_codigo IS DISTINCT FROM _m.destino;
    GET DIAGNOSTICS _n = ROW_COUNT;
    _tot := _tot + _n;
  END LOOP;

  RAISE NOTICE 'de-para 2025: % conta(s) realocada(s)', _tot;
  IF _falta <> '' THEN
    RAISE NOTICE 'destinos não encontrados no plano (ignorados): %', _falta;
  END IF;
END $$;

-- ------------------------------------------------------------
-- Reaplicar o ECD com os vínculos novos
-- ------------------------------------------------------------
-- Sem isto, `saldos_mensais` continua com a tradução ANTIGA e o número
-- na tela não muda.
--
-- Não dá para chamar `ecd_aplicar` daqui: ela cobra permissão de sessão
-- (`pode_gerenciar_tenant`) e migração roda sem sessão. Então a
-- retradução é feita aqui, com a mesma regra que ela usa — e mexendo
-- SÓ nas linhas que vieram deste ECD (`origem_ecd`). O que veio do
-- diário não é tocado.
DO $$
DECLARE _imp uuid; _tenant uuid; _company uuid; _primeiro date; _n int; _a int;
BEGIN
  SELECT i.id, i.tenant_id, i.company_id INTO _imp, _tenant, _company
    FROM public.ecd_importacao i
   WHERE i.cnpj = '02745261000166'
     AND i.periodo_inicio >= '2025-01-01' AND i.periodo_fim <= '2025-12-31'
   ORDER BY i.criado_em DESC LIMIT 1;
  IF _imp IS NULL THEN RETURN; END IF;

  DELETE FROM public.saldos_mensais WHERE origem_ecd = _imp;
  INSERT INTO public.saldos_mensais
    (tenant_id, company_id, conta_codigo, competencia,
     total_debitos, total_creditos, origem_ecd)
  SELECT _tenant, _company, d.conta_padrao_codigo, s.competencia,
         sum(s.debitos), sum(s.creditos), _imp
    FROM public.ecd_saldo s
    JOIN public.depara_contas d
      ON d.tenant_id = _tenant AND d.company_id = _company
     AND d.conta_codigo = s.codigo
     AND d.conta_padrao_codigo IS NOT NULL
     AND NOT COALESCE(d.ignorada, false)
   WHERE s.importacao_id = _imp
   GROUP BY d.conta_padrao_codigo, s.competencia
  ON CONFLICT (company_id, conta_codigo, competencia)
    DO UPDATE SET total_debitos = EXCLUDED.total_debitos,
                  total_creditos = EXCLUDED.total_creditos,
                  origem_ecd = EXCLUDED.origem_ecd,
                  updated_at = now();
  GET DIAGNOSTICS _n = ROW_COUNT;

  SELECT min(competencia) INTO _primeiro FROM public.ecd_saldo WHERE importacao_id = _imp;
  DELETE FROM public.saldos_abertura WHERE origem_ecd = _imp;
  INSERT INTO public.saldos_abertura
    (tenant_id, company_id, conta_codigo, data_referencia, saldo, origem_ecd)
  SELECT _tenant, _company, d.conta_padrao_codigo,
         (_primeiro - INTERVAL '1 day')::date, sum(s.saldo_inicial), _imp
    FROM public.ecd_saldo s
    JOIN public.depara_contas d
      ON d.tenant_id = _tenant AND d.company_id = _company
     AND d.conta_codigo = s.codigo
     AND d.conta_padrao_codigo IS NOT NULL
     AND NOT COALESCE(d.ignorada, false)
   WHERE s.importacao_id = _imp AND s.competencia = _primeiro
   GROUP BY d.conta_padrao_codigo
  HAVING sum(s.saldo_inicial) <> 0
  ON CONFLICT (company_id, conta_codigo, data_referencia)
    DO UPDATE SET saldo = EXCLUDED.saldo, origem_ecd = EXCLUDED.origem_ecd;
  GET DIAGNOSTICS _a = ROW_COUNT;

  RAISE NOTICE 'ECD retraduzido: % saldo(s) mensal(is), % abertura(s)', _n, _a;
END $$;

NOTIFY pgrst, 'reload schema';
