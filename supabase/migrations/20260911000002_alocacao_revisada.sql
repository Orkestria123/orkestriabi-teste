-- ============================================================
-- AJUSTE 38 — a revisão das alocações, conta a conta
-- ============================================================
--
-- Revisão feita contra o SEU plano (`plano_padrao_referencia`, as 1.143
-- contas estruturais do escritório) E contra o motor que consome a
-- alocação. A diferença entre as duas coisas é o assunto desta migração:
-- metade do que eu tinha te mandado no ajuste 37 era intuição contábil
-- sem conferir o que o motor faz com o dado. Três daqueles achados eram
-- falsos. Estão desfeitos aqui, com o motivo.
--
-- ------------------------------------------------------------
-- O QUE EU DISSE ANTES E ESTAVA ERRADO
-- ------------------------------------------------------------
--
-- 1. "As 455 analíticas de resultado estão sem código DFC — a DFC parte
--    de lucro ZERO." FALSO, e era a manchete. O motor faz isto:
--
--        if (f.tipo === "3-DRE") {
--          // o resultado já entra pelo Lucro Líquido da DRE
--          if (bloco === "nao_caixa") { ... }
--          continue;                       // ← de propósito
--        }
--        ...
--        if (bloco === "resultado") continue;   // "ponto de partida"
--
--    O lucro entra pela linha da DRE (`lucroLiq`), não por vínculo de
--    conta. Conta de resultado sem código DFC é o desenho, não um furo.
--    Vincular as 455 não mudaria um centavo — o `continue` come tudo.
--
-- 2. "Contas correntes matriz e filiais estão como caixa e não são
--    caixa." FALSO. Matriz e filial são o MESMO CNPJ, a mesma ECD, e os
--    dois lados estão nos mesmos livros: 1.01.06.01 (ativo) e 2.01.03.07
--    (passivo) estão ambos em `C`. Transferir dinheiro para a filial
--    debita um e credita o outro — os dois se anulam dentro do caixa, que
--    é justamente o certo: mover dinheiro entre estabelecimentos não muda
--    o caixa da entidade. Tirar do `C` é que quebraria.
--
-- 3. "1.01.01.01.02 CAIXA GERAL está tipada como cliente." FALSO no seu
--    plano — não existe uma única conta 1.x/2.x com tipo de participante
--    ali. Aquilo era da minha fixture de teste. (A tipagem errada existe,
--    mas em outro lugar, e é minha: item 11 abaixo.)
--
-- Confirmei também o que NÃO precisa mexer:
--   · Buracos de DFC: ZERO. Todas as 449 analíticas de balanço resolvem
--     um código por prefixo. A identidade do CPC 03 fecha.
--   · 2.02.01.03 TRIBUTOS PARCELADOS em `POT` (operacional): tributo é
--     operacional; parcelar não muda a natureza dele. Fica.
--
-- ------------------------------------------------------------
-- O QUE MUDA AQUI (e por quê)
-- ------------------------------------------------------------
-- Só o que é erro de classificação demonstrável. Nada que mexa no lucro
-- que o seu sistema contábil reporta — o que faz isso está listado no
-- fim, para você decidir.

-- ------------------------------------------------------------
-- 1) DFC — bloco errado
-- ------------------------------------------------------------
-- `dfc_padrao` é a referência (semeia); `dfc_vinculo` é o que a leitura
-- resolve. Mudar só a referência não teria efeito nenhum no seu banco:
-- os vínculos já estão gravados. Então os dois mudam — e o vínculo só
-- onde ele ainda está no valor ANTIGO e não foi marcado 'manual'. Se
-- você já corrigiu algum à mão, o seu valor fica.
DO $$
DECLARE
  _mudancas jsonb := jsonb_build_array(
    -- classificação | de | para | motivo
    jsonb_build_array('1.01.02.02', 'AOC', 'FE',
      'Duplicata descontada é empréstimo com garantia de recebível: o risco continua na empresa e o dinheiro veio do banco, não do cliente. Em AOC entrava como se o cliente tivesse pagado, inflando o caixa operacional e sumindo da captação.'),
    jsonb_build_array('1.01.05.01', 'AON', 'FE',
      'Encargos financeiros a apropriar é retificadora de empréstimo, não despesa antecipada. O gêmeo de longo prazo (2.02.02.02) já estava em FE — a mesma natureza estava em dois blocos diferentes.'),
    jsonb_build_array('1.03.00.03', 'AOL', 'I',
      'Aplicação financeira de longo prazo (capitalização, previdência privada) é aplicação de recursos, não capital de giro.'),
    jsonb_build_array('2.02.01.08', 'FO', 'POO',
      'Receita diferida é dinheiro de cliente por entrega futura: operacional. A conta irmã (2.02.01.07) já estava em POO.'),
    jsonb_build_array('2.02.01.06', 'FE', 'FO',
      'Conta corrente de longo prazo com terceiros/ligadas é Outras Obrigações, como a gêmea de curto prazo (2.01.01.13). Mesmo bloco, linha certa.'),
    jsonb_build_array('2.05.01.10', 'FL', 'FC',
      'Existe FC "Cisão" no catálogo, sem uso. Mesmo bloco; a cisão deixa de se esconder dentro de Patrimônio Líquido e Dividendos.')
  );
  _m jsonb; _cls text; _de text; _para text; _n int; _tot int := 0;
BEGIN
  FOR _m IN SELECT * FROM jsonb_array_elements(_mudancas) LOOP
    _cls := _m->>0; _de := _m->>1; _para := _m->>2;

    UPDATE public.dfc_padrao SET codigo_dfc = _para
     WHERE classificacao = _cls AND codigo_dfc = _de;

    UPDATE public.dfc_vinculo SET codigo_dfc = _para, atualizado_em = now()
     WHERE classificacao = _cls AND codigo_dfc = _de AND origem <> 'manual';
    GET DIAGNOSTICS _n = ROW_COUNT;
    _tot := _tot + _n;
    RAISE NOTICE '  % : % -> %  (% vínculo(s))', _cls, _de, _para, _n;
  END LOOP;
  RAISE NOTICE 'DFC: % vínculo(s) reclassificado(s)', _tot;
END $$;

-- ------------------------------------------------------------
-- 2) DFC — empréstimo concedido não é "outros créditos"
-- ------------------------------------------------------------
-- `1.01.02.10 CREDITOS DIVERSOS` está em AOO (operacional) e a maior
-- parte dos filhos é isso mesmo. Três não são: mútuo concedido,
-- empréstimo a terceiros e crédito com sócios são dinheiro EMPRESTADO —
-- financiamento concedido, e o catálogo tem `FR` "Empréstimos a
-- Receber" justamente para isso, até agora sem uso nenhum.
--
-- O vínculo é por classificação e o prefixo mais longo ganha: vincular os
-- três filhos não desfaz o AOO do pai, que continua valendo para os
-- outros sete (devedores diversos, aluguéis a receber, fretes...).
INSERT INTO public.dfc_padrao (classificacao, descricao_referencia, codigo_dfc) VALUES
  ('1.01.02.10.01', 'EMPRESTIMO DE MUTUO',                'FR'),
  ('1.01.02.10.04', 'EMPRESTIMOS CONCEDIDOS A TERCEIROS', 'FR'),
  ('1.01.02.10.09', 'CRÉDITOS COM SÓCIOS',                'FR')
ON CONFLICT (classificacao) DO NOTHING;

-- E o vínculo correspondente, para cada tenant que já tem o plano —
-- só onde ainda não existe vínculo naquela classificação exata.
INSERT INTO public.dfc_vinculo (tenant_id, company_id, classificacao, codigo_dfc, origem)
SELECT t.id, NULL, d.classificacao, d.codigo_dfc, 'planilha'
  FROM public.tenants t
  CROSS JOIN (VALUES ('1.01.02.10.01'), ('1.01.02.10.04'), ('1.01.02.10.09')) AS x(classificacao)
  JOIN public.dfc_padrao d ON d.classificacao = x.classificacao
 WHERE EXISTS (
   SELECT 1 FROM public.plano_contas p
    WHERE p.tenant_id = t.id AND p.company_id IS NULL AND p.ativo
      AND (p.classificacao = d.classificacao
        OR left(p.classificacao, length(d.classificacao) + 1) = d.classificacao || '.'))
ON CONFLICT (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), classificacao)
  DO NOTHING;

-- ------------------------------------------------------------
-- 3) EBITDA — a sexta depreciação
-- ------------------------------------------------------------
-- O plano tem 6 contas de depreciação/amortização no resultado. A
-- `estrutura_padrao` marcava 5. A que faltava é a de CUSTO DE SERVIÇOS —
-- justamente a que pesa em quem fecha resultado por serviço. Sem a marca
-- ela não entra na sugestão de add-back e o EBITDA sai menor do que é.
-- Mesma forma das outras cinco: demonstração DRE, tipo_linha 'tag',
-- ordem na sequência (905, depois da 904).
INSERT INTO public.estrutura_padrao
  (classificacao, papel, demonstracao, tipo_linha, rotulo, ordem)
SELECT '3.05.01.03.01', 'DEPRECIACAO_AMORTIZACAO', 'DRE', 'tag', NULL, 905
 WHERE EXISTS (SELECT 1 FROM public.plano_padrao_referencia
                WHERE classificacao = '3.05.01.03.01')
ON CONFLICT (classificacao, papel) DO NOTHING;

-- ------------------------------------------------------------
-- 4) A agregadora de participante nascia com o tipo errado — meu bug
-- ------------------------------------------------------------
-- `plano_criar_agregadoras` (ajuste 34) copiava o `tipo` do participante:
-- a consolidada de clientes nascia `4-Cli. Nac.` e a de fornecedores
-- `5-For. Nac.`. Elas não são participante — são a conta estrutural que
-- soma todos eles.
--
-- E isso tem consequência de verdade. O motor busca o plano assim:
--
--     .in("tipo", ["1-Ativo","2-Passivo"]).eq("is_participante", false)
--
-- A agregadora é `is_participante = false` (certo) com tipo de
-- participante (errado): não entra por nenhum dos dois lados. No snapshot
-- da DFC, que não pede participantes, ela some — e ela é quem carrega os
-- 113.366 clientes e os 21.246 fornecedores.
--
-- Passa a herdar o tipo da SINTÉTICA PAI, que é a tipagem do próprio
-- plano, com o grupo da classificação como rede.
CREATE OR REPLACE FUNCTION public.plano_criar_agregadoras(_tenant_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _criadas int := 0;
BEGIN
  WITH classes AS (
    SELECT p.classificacao,
           max(p.nivel) AS nivel,
           max(p.conta_pai_classificacao) AS pai
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NULL
       AND p.is_participante
     GROUP BY p.classificacao
  ),
  nomeadas AS (
    SELECT c.*,
           COALESCE(
             (SELECT pai.descricao FROM public.plano_contas pai
               WHERE pai.tenant_id = _tenant_id AND pai.company_id IS NULL
                 AND pai.classificacao = c.pai AND pai.is_sintetica
               LIMIT 1),
             'PARTICIPANTES ' || c.classificacao) AS nome,
           -- O tipo ESTRUTURAL: o da sintética pai; se ela não disser,
           -- o grupo da classificação. Nunca o do participante.
           COALESCE(
             (SELECT pai.tipo FROM public.plano_contas pai
               WHERE pai.tenant_id = _tenant_id AND pai.company_id IS NULL
                 AND pai.classificacao = c.pai AND pai.is_sintetica
                 AND pai.tipo IN ('1-Ativo', '2-Passivo', '3-DRE')
               LIMIT 1),
             CASE left(c.classificacao, 1)
               WHEN '1' THEN '1-Ativo'
               WHEN '2' THEN '2-Passivo'
               WHEN '3' THEN '3-DRE'
               ELSE '1-Ativo' END) AS tipo
      FROM classes c
  ),
  ins AS (
    INSERT INTO public.plano_contas
      (tenant_id, company_id, codigo, classificacao, descricao, tipo, natureza,
       nivel, is_sintetica, is_participante, conta_pai_classificacao, ativo)
    SELECT _tenant_id, NULL, 'AGG-' || n.classificacao, n.classificacao,
           n.nome || ' (consolidado)', n.tipo, 'A',
           n.nivel, false, false, n.pai, true
      FROM nomeadas n
    ON CONFLICT (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo)
      -- o tipo entra no DO UPDATE: é o que conserta as que já existem
      DO UPDATE SET descricao = EXCLUDED.descricao, tipo = EXCLUDED.tipo, ativo = true
    RETURNING (xmax = 0) AS nova
  )
  SELECT count(*) FILTER (WHERE nova) INTO _criadas FROM ins;
  RETURN _criadas;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.plano_criar_agregadoras(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.plano_criar_agregadoras(uuid) TO authenticated, service_role;

-- Conserta as que já existem, sem esperar a próxima criação.
DO $$
DECLARE _t uuid; _n int; _tot int := 0;
BEGIN
  FOR _t IN SELECT DISTINCT tenant_id FROM public.plano_contas
             WHERE company_id IS NULL AND codigo LIKE 'AGG-%' LOOP
    PERFORM public.plano_criar_agregadoras(_t);
  END LOOP;
  SELECT count(*) INTO _n FROM public.plano_contas
   WHERE company_id IS NULL AND codigo LIKE 'AGG-%'
     AND tipo NOT IN ('1-Ativo', '2-Passivo', '3-DRE');
  RAISE NOTICE 'agregadoras ainda com tipo de participante: %', _n;
END $$;

-- ------------------------------------------------------------
-- O QUE EU NÃO MUDEI — é decisão sua, e muda número reportado
-- ------------------------------------------------------------
--
-- a) `3.19.01 DISTRIBUIÇÃO DE LUCROS` é linha de DRE e entra no
--    resultado líquido (3.99 acumula até 3.19). Distribuição é destinação
--    do resultado — débito no PL, nunca despesa. Do jeito que está, o
--    lucro sai subavaliado pelo valor distribuído E a mesma saída de
--    caixa aparece de novo na DFC. Mas tirar 3.19 da DRE muda o lucro que
--    o BI mostra, e ele passa a divergir do que o seu sistema contábil
--    reporta. Isso é seu, não meu. Se quiser, é uma linha:
--
--      DELETE FROM public.estrutura_padrao WHERE classificacao = '3.19.01';
--
--    (e mover 3.19 para o PL no plano, se for para ficar consistente).
--
-- b) O papel `EBIT` está em `3.10.99`, que o seu plano chama de RESULTADO
--    OPERACIONAL e que acumula desde 3.01 — inclui receitas e despesas
--    financeiras. É a convenção brasileira de "operacional", e o app usa
--    o rótulo "(=) Resultado Operacional (EBIT)" coerentemente. Não é um
--    erro de alocação; é uma escolha de nomenclatura. Só vale saber onde
--    ela aparece: "Dívida Líquida / EBITDA" parte daí, então com despesa
--    financeira líquida relevante o EBITDA sai menor que o econômico.
--
-- c) `1.01.02.05 LUCROS A RECEBER` e `1.01.02.06 JCP A RECEBER` estão em
--    `O` (operacional). O CPC 03 permite dividendo recebido em
--    operacional OU em investimento — é política contábil, não erro.
--    Como `1.03.01.01 PARTICIPAÇÕES` está em `I`, mandar os dois para `I`
--    deixaria o retorno junto do investimento. Sua chamada.
--
-- d) `1.01.01.03 BANCOS CONTA VINCULADA` está em `C` (caixa). Conta
--    vinculada é caixa restrito e a rigor não é equivalente de caixa.
--    Depende do que a sua conta vinculada é na prática.
--
-- e) 26 classificações são usadas por mais de uma conta (122 contas ao
--    todo) — ex.: `1.03.01.03.01` serve CONSTRUÇÕES EM ANDAMENTO,
--    APARTAMENTOS, TERRENOS, SALAS, BOX, ÁREA DE TERRAS e PRÉDIOS. Para
--    os números não faz diferença (somam na mesma linha); para as telas
--    que mostram "o grupo de destino", o nome que aparece é o de uma
--    delas só. Se quiser separar, é mexer no plano.
