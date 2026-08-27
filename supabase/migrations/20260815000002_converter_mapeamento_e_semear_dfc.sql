-- ============================================================
-- AJUSTE 01 (parte 2/3) — conversão dos dados que já existem.
--
-- (A) mapeamento_demonstracao  ->  alocação no plano_contas
--     As empresas já configuradas continuam funcionando sem
--     retrabalho. A tabela antiga NÃO é removida aqui: fica como
--     backup até a validação terminar (a remoção é a parte 3/3,
--     comentada e opcional).
--
-- (B) semente da DFC — como a DFC dependia de prefixos fixos no
--     código (1.01.01 = caixa, 1.03 = imobilizado, 2.01.04 =
--     empréstimos...), replicamos essa mesma leitura UMA VEZ nas
--     contas analíticas. A partir daí a fonte da verdade é o banco,
--     e cada conta é ajustável na tela — inclusive nos planos que
--     não seguem esses prefixos, que antes simplesmente geravam
--     DFC errada em silêncio.
-- ============================================================

-- ------------------------------------------------------------
-- (A) Converter mapeamento_demonstracao -> plano_contas
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.migrar_mapeamento_para_plano()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _exatas int := 0;
  _descendentes int := 0;
  _sem_match int := 0;
  _sep text;
  _pref text;
  _n int;
  -- prefixo _ no nome para não colidir com aliases SQL dentro da função
  -- (um alias `m` aqui seria resolvido como esta variável, não como a tabela)
  _map record;
BEGIN
  -- Passo 1 — casamento EXATO: o prefixo do mapeamento é a
  -- classificação de uma conta real. É o caso normal, e é o que
  -- mantém a alocação compacta (a sintética cascateia para as filhas).
  WITH upd AS (
    UPDATE public.plano_contas p
       SET tipo_demonstracao = md.tipo_demonstracao,
           linha_demonstracao = md.linha_demonstracao,
           ordem_linha        = md.ordem,
           inverter_sinal     = md.inverter_sinal,
           tipo_custo         = md.tipo_custo
      FROM public.mapeamento_demonstracao md
     WHERE p.tenant_id = md.tenant_id
       AND p.company_id IS NOT DISTINCT FROM md.company_id
       AND p.classificacao = md.classificacao_prefixo
       AND p.is_participante = false
       -- DFC não entra: no motor atual o mapa de DFC nunca é lido
       -- (buildDFC deriva da DRE + saldos), então converter geraria
       -- alocação fantasma. A DFC passa a viver em dfc_atividade.
       AND md.tipo_demonstracao IN ('DRE','BP_ATIVO','BP_PASSIVO')
    RETURNING 1
  )
  SELECT count(*) INTO _exatas FROM upd;

  -- Passo 2 — prefixos SEM conta correspondente (ex.: mapeamento
  -- escrito na mão para um nível que não existe no plano). Aplica nas
  -- descendentes mais rasas, que é onde a herança começaria.
  FOR _map IN
    SELECT md.*
      FROM public.mapeamento_demonstracao md
     WHERE md.tipo_demonstracao IN ('DRE','BP_ATIVO','BP_PASSIVO')
       AND NOT EXISTS (
         SELECT 1 FROM public.plano_contas p
          WHERE p.tenant_id = md.tenant_id
            AND p.company_id IS NOT DISTINCT FROM md.company_id
            AND p.classificacao = md.classificacao_prefixo
       )
     -- genérico primeiro, específico depois: o específico sobrescreve
     ORDER BY length(md.classificacao_prefixo) ASC
  LOOP
    SELECT COALESCE(mc.separador, '.') INTO _sep
      FROM public.mascara_classificacao mc
     WHERE mc.tenant_id = _map.tenant_id
       AND mc.company_id IS NOT DISTINCT FROM _map.company_id
     LIMIT 1;
    _sep := COALESCE(_sep, '.');
    _pref := _map.classificacao_prefixo || _sep;

    -- Compara por left() em vez de LIKE: evita que '_' ou '%' numa
    -- classificação sejam interpretados como curinga.
    UPDATE public.plano_contas p
       SET tipo_demonstracao = _map.tipo_demonstracao,
           linha_demonstracao = _map.linha_demonstracao,
           ordem_linha        = _map.ordem,
           inverter_sinal     = _map.inverter_sinal,
           tipo_custo         = _map.tipo_custo
     WHERE p.tenant_id = _map.tenant_id
       AND p.company_id IS NOT DISTINCT FROM _map.company_id
       AND p.is_participante = false
       AND left(p.classificacao, length(_pref)) = _pref
       AND p.nivel = (
         SELECT min(p2.nivel)
           FROM public.plano_contas p2
          WHERE p2.tenant_id = _map.tenant_id
            AND p2.company_id IS NOT DISTINCT FROM _map.company_id
            AND p2.is_participante = false
            AND left(p2.classificacao, length(_pref)) = _pref
       );
    GET DIAGNOSTICS _n = ROW_COUNT;
    _descendentes := _descendentes + _n;
    IF _n = 0 THEN
      _sem_match := _sem_match + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'alocacoes_exatas', _exatas,
    'alocacoes_por_descendencia', _descendentes,
    'prefixos_sem_conta_no_plano', _sem_match
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.migrar_mapeamento_para_plano() FROM anon, public;

-- Executa a conversão uma vez, agora.
DO $$
DECLARE _r jsonb;
BEGIN
  _r := public.migrar_mapeamento_para_plano();
  RAISE NOTICE 'Conversão mapeamento -> plano_contas: %', _r;
END $$;

-- ------------------------------------------------------------
-- (B) Semente da DFC nas contas ANALÍTICAS
-- ------------------------------------------------------------
-- Reproduz exatamente a leitura que estava hardcoded em
-- build-statements.ts, para a DFC não mudar de comportamento no
-- momento da troca. Só grava onde ainda está NULL, então é seguro
-- rodar de novo e nunca sobrescreve ajuste manual.
CREATE OR REPLACE FUNCTION public.semear_dfc_padrao(_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caixa int := 0; _inv int := 0; _fin int := 0; _oper int := 0; _naocaixa int := 0;
BEGIN
  -- 1) Caixa e equivalentes (1.01.01) — é contra este saldo que a
  --    variação líquida da DFC é conferida.
  WITH u AS (
    UPDATE public.plano_contas p SET dfc_atividade = 'caixa'
     WHERE p.is_sintetica = false AND p.dfc_atividade IS NULL
       AND p.tipo = '1-Ativo'
       AND (_tenant_id IS NULL OR p.tenant_id = _tenant_id)
       AND left(p.classificacao, 7) = '1.01.01'
    RETURNING 1
  ) SELECT count(*) INTO _caixa FROM u;

  -- 2) Investimento: imobilizado (1.03) e intangível (1.04)
  WITH u AS (
    UPDATE public.plano_contas p SET dfc_atividade = 'investimento'
     WHERE p.is_sintetica = false AND p.dfc_atividade IS NULL
       AND p.tipo = '1-Ativo'
       AND (_tenant_id IS NULL OR p.tenant_id = _tenant_id)
       AND left(p.classificacao, 4) IN ('1.03','1.04')
    RETURNING 1
  ) SELECT count(*) INTO _inv FROM u;

  -- 3) Financiamento: empréstimos CP/LP e Capital Social.
  --    Lucros/Prejuízos acumulados NÃO entram — esse resultado já
  --    está no Lucro Líquido que abre o bloco operacional; marcar
  --    aqui contaria o mesmo dinheiro duas vezes.
  WITH u AS (
    UPDATE public.plano_contas p SET dfc_atividade = 'financiamento'
     WHERE p.is_sintetica = false AND p.dfc_atividade IS NULL
       AND p.tipo = '2-Passivo'
       AND (_tenant_id IS NULL OR p.tenant_id = _tenant_id)
       AND (
         left(p.classificacao, 7) IN ('2.01.04','2.02.01')
         OR left(p.classificacao, 10) = '2.05.01.01'
       )
    RETURNING 1
  ) SELECT count(*) INTO _fin FROM u;

  -- 3b) CONTRAPARTIDA dos lançamentos que não passam por caixa.
  --     Depreciação/amortização acumulada é conta REDUTORA do ativo:
  --     o outro lado da despesa de depreciação. Se ela entrasse em
  --     'investimento', o crédito viraria "entrada de caixa em
  --     investimentos" — dinheiro que nunca existiu. Marcada como
  --     não-caixa, sai de todos os blocos; a despesa correspondente
  --     é estornada no operacional (regra 5). Só assim a identidade
  --     da DFC fecha: variação de caixa = operacional + inv + fin.
  UPDATE public.plano_contas p
     SET dfc_nao_caixa = true, dfc_atividade = NULL
   WHERE p.is_sintetica = false
     AND p.tipo IN ('1-Ativo','2-Passivo')
     AND (_tenant_id IS NULL OR p.tenant_id = _tenant_id)
     AND p.descricao ~* '(deprec|amortiz|exaust).*(acum)|(acum).*(deprec|amortiz|exaust)';

  -- 4) Todo o resto de Ativo/Passivo analítico = capital de giro
  --    (bloco operacional), exceto Lucros/Prejuízos Acumulados e as
  --    contas já marcadas como não-caixa acima.
  WITH u AS (
    UPDATE public.plano_contas p SET dfc_atividade = 'operacional'
     WHERE p.is_sintetica = false AND p.dfc_atividade IS NULL
       AND p.dfc_nao_caixa = false
       AND p.tipo IN ('1-Ativo','2-Passivo','4-Cli. Nac.','5-For. Nac.','6-Cli. Ex.','7-For. Ex.')
       AND (_tenant_id IS NULL OR p.tenant_id = _tenant_id)
       AND left(p.classificacao, 10) NOT IN ('2.05.01.08','2.05.01.09')
    RETURNING 1
  ) SELECT count(*) INTO _oper FROM u;

  -- 5) DRE: despesas que não transitam por caixa e são estornadas
  --    no bloco operacional (mesma regex KW_DEPRECIACAO do código).
  WITH u AS (
    UPDATE public.plano_contas p SET dfc_nao_caixa = true
     WHERE p.is_sintetica = false AND p.dfc_nao_caixa = false
       AND p.tipo = '3-DRE'
       AND (_tenant_id IS NULL OR p.tenant_id = _tenant_id)
       AND p.descricao ~* 'deprec|amortiz|exaust'
    RETURNING 1
  ) SELECT count(*) INTO _naocaixa FROM u;

  RETURN jsonb_build_object(
    'caixa', _caixa, 'investimento', _inv, 'financiamento', _fin,
    'operacional', _oper, 'dre_nao_caixa', _naocaixa
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.semear_dfc_padrao(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.semear_dfc_padrao(uuid) TO authenticated, service_role;

DO $$
DECLARE _r jsonb;
BEGIN
  _r := public.semear_dfc_padrao(NULL);
  RAISE NOTICE 'Semente DFC: %', _r;
END $$;
