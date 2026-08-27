-- ============================================================
-- AJUSTE 35 — o ECD chegar ao BI, e a DFC exportar o que foi alocado
-- ============================================================
--
-- "ecds carregadas, porém não são carregados ao bi, mesmo com vínculo"
-- "a dfc ainda não exporta as alocações realizadas"
--
-- Rastreei os dois no banco. São cinco defeitos, e três deles apagam ou
-- escondem dado sem dizer nada.

-- ------------------------------------------------------------
-- 0) A guarda de permissão que não guardava
-- ------------------------------------------------------------
-- Este padrão está em ~15 funções:
--
--     IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id)
--       THEN RAISE EXCEPTION 'Sem permissão'; END IF;
--
-- Se `get_my_tenant_id()` devolve NULL — e devolve, porque
-- `handle_new_user` cria o profile SEM tenant_id e o cadastro está
-- aberto — a expressão inteira vira NULL, `NOT NULL` é NULL, e o IF
-- NÃO DISPARA. Um usuário recém-criado, sem tenant nenhum, passa pela
-- guarda de qualquer tenant.
--
-- Lógica de três valores é fácil de errar e difícil de ver. Então a
-- guarda vira uma função só, com o COALESCE dentro, e quem precisa dela
-- chama em vez de reescrever.
CREATE OR REPLACE FUNCTION public.pode_tenant(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    public.is_orkestria_admin()
      OR (public.get_my_tenant_id() IS NOT NULL
          AND _tenant_id IS NOT NULL
          AND public.get_my_tenant_id() = _tenant_id),
    false);
$fn$;

GRANT EXECUTE ON FUNCTION public.pode_tenant(uuid) TO authenticated, service_role;

-- ============================================================
-- PARTE 1 — O ECD NÃO CHEGAVA AO BI
-- ============================================================

-- ------------------------------------------------------------
-- 1.1) De quem é cada linha de saldo
-- ------------------------------------------------------------
-- `saldos_mensais` não tinha como dizer se uma linha veio do diário ou
-- de um ECD. Sem isso:
--
--   · `ecd_desfazer` apagava TUDO no intervalo de datas do ECD —
--     inclusive o diário. Medido na base de teste: 38 linhas apagadas,
--     38 delas do diário, 0 do ECD. E a tela promete o contrário:
--     "O diário não é tocado".
--   · `ecd_aplicar` não podia reescrever o que ele mesmo gravou, então
--     aplicar de novo (depois de corrigir vínculos) não fazia nada.
--
-- Uma coluna resolve os dois.
ALTER TABLE public.saldos_mensais
  ADD COLUMN IF NOT EXISTS origem_ecd uuid REFERENCES public.ecd_importacao(id) ON DELETE SET NULL;
ALTER TABLE public.saldos_abertura
  ADD COLUMN IF NOT EXISTS origem_ecd uuid REFERENCES public.ecd_importacao(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_saldos_mensais_origem_ecd
  ON public.saldos_mensais (origem_ecd) WHERE origem_ecd IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_saldos_abertura_origem_ecd
  ON public.saldos_abertura (origem_ecd) WHERE origem_ecd IS NOT NULL;

COMMENT ON COLUMN public.saldos_mensais.origem_ecd IS
  'A importação de ECD que gravou esta linha. NULL = veio do diário ou '
  'de balancete. É o que permite desfazer um ECD sem levar o diário junto.';

-- ------------------------------------------------------------
-- 1.2) Aplicar de novo tem que valer
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ecd_aplicar(
  _importacao_id uuid,
  _substituir boolean DEFAULT false,
  _forcar boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _company uuid; _primeiro date;
  _sem_vinculo int; _linhas int := 0; _abert int := 0;
  _apagadas int := 0; _meses_do_diario int := 0; _data_abert date;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT count(DISTINCT s.codigo) INTO _sem_vinculo
    FROM public.ecd_saldo s
    LEFT JOIN public.depara_contas d
           ON d.tenant_id = _tenant AND d.company_id = _company AND d.conta_codigo = s.codigo
   WHERE s.importacao_id = _importacao_id
     AND (s.debitos <> 0 OR s.creditos <> 0 OR s.saldo_final <> 0)
     AND d.conta_padrao_codigo IS NULL
     AND NOT COALESCE(d.ignorada, false);

  IF _sem_vinculo > 0 AND NOT _forcar THEN
    RETURN jsonb_build_object('ok', false, 'contas_sem_vinculo', _sem_vinculo,
      'nota', 'há conta com movimento e sem vínculo — vincule ou marque como ignorada antes de aplicar');
  END IF;

  SELECT min(competencia) INTO _primeiro
    FROM public.ecd_saldo WHERE importacao_id = _importacao_id;
  _data_abert := (_primeiro - INTERVAL '1 day')::date;

  -- Meses em que o DIÁRIO já mandou. Continuam protegidos — é a regra
  -- original e ela está certa. O que muda é que agora ela é DITA: antes
  -- o mês era descartado em silêncio e a resposta vinha 'ok' com zero
  -- linhas, indistinguível de sucesso.
  SELECT count(DISTINCT s.competencia) INTO _meses_do_diario
    FROM public.ecd_saldo s
   WHERE s.importacao_id = _importacao_id
     AND EXISTS (
       SELECT 1 FROM public.saldos_mensais m
        WHERE m.company_id = _company AND m.competencia = s.competencia
          AND m.origem_ecd IS DISTINCT FROM _importacao_id
          AND m.origem_ecd IS NULL);

  -- O que ESTA importação gravou antes e não vale mais (vínculo mudou ou
  -- foi removido) sai. Sem isto, corrigir um vínculo deixava o valor
  -- velho pendurado para sempre.
  WITH fora AS (
    DELETE FROM public.saldos_mensais m
     WHERE m.origem_ecd = _importacao_id
       AND NOT EXISTS (
         SELECT 1 FROM public.ecd_saldo s
           JOIN public.depara_contas d
             ON d.tenant_id = _tenant AND d.company_id = _company
            AND d.conta_codigo = s.codigo AND d.conta_padrao_codigo IS NOT NULL
            AND NOT COALESCE(d.ignorada, false)
          WHERE s.importacao_id = _importacao_id
            AND d.conta_padrao_codigo = m.conta_codigo
            AND s.competencia = m.competencia)
    RETURNING 1
  ) SELECT count(*) INTO _apagadas FROM fora;

  WITH tradu AS (
    SELECT d.conta_padrao_codigo AS codigo, s.competencia,
           sum(s.debitos) AS deb, sum(s.creditos) AS cred
      FROM public.ecd_saldo s
      JOIN public.depara_contas d
        ON d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_codigo = s.codigo AND d.conta_padrao_codigo IS NOT NULL
       AND NOT COALESCE(d.ignorada, false)
     WHERE s.importacao_id = _importacao_id
     GROUP BY 1, 2
  ),
  alvo AS (
    -- A guarda agora é por ORIGEM, não por existência. O mês do diário
    -- continua intocado; o mês que ESTE ECD gravou é reescrito.
    SELECT t.* FROM tradu t
     WHERE _substituir OR NOT EXISTS (
       SELECT 1 FROM public.saldos_mensais m
        WHERE m.company_id = _company AND m.competencia = t.competencia
          AND m.origem_ecd IS NULL)
  ),
  gravado AS (
    INSERT INTO public.saldos_mensais
      (tenant_id, company_id, conta_codigo, competencia, total_debitos, total_creditos, origem_ecd)
    SELECT _tenant, _company, a.codigo, a.competencia, a.deb, a.cred, _importacao_id FROM alvo a
    ON CONFLICT (company_id, conta_codigo, competencia)
      DO UPDATE SET total_debitos = EXCLUDED.total_debitos,
                    total_creditos = EXCLUDED.total_creditos,
                    origem_ecd = EXCLUDED.origem_ecd,
                    updated_at = now()
    RETURNING 1
  ) SELECT count(*) INTO _linhas FROM gravado;

  -- Abertura: só nas contas que este ECD traz, e carimbada. Antes o
  -- desfazer apagava a data inteira — inclusive a abertura vinda do
  -- balancete, que costuma ser exatamente a mesma data.
  WITH tradu AS (
    SELECT d.conta_padrao_codigo AS codigo, sum(s.saldo_inicial) AS saldo
      FROM public.ecd_saldo s
      JOIN public.depara_contas d
        ON d.tenant_id = _tenant AND d.company_id = _company
       AND d.conta_codigo = s.codigo AND d.conta_padrao_codigo IS NOT NULL
       AND NOT COALESCE(d.ignorada, false)
     WHERE s.importacao_id = _importacao_id AND s.competencia = _primeiro
     GROUP BY 1
  ),
  gravado AS (
    INSERT INTO public.saldos_abertura
      (tenant_id, company_id, conta_codigo, data_referencia, saldo, origem_ecd)
    SELECT _tenant, _company, t.codigo, _data_abert, t.saldo, _importacao_id
      FROM tradu t WHERE t.saldo <> 0
    ON CONFLICT (company_id, conta_codigo, data_referencia)
      -- Não rouba a abertura de quem chegou antes: se a linha é do
      -- balancete (origem_ecd IS NULL), ela fica como está.
      DO UPDATE SET saldo = EXCLUDED.saldo, origem_ecd = EXCLUDED.origem_ecd
      WHERE public.saldos_abertura.origem_ecd IS NOT DISTINCT FROM EXCLUDED.origem_ecd
    RETURNING 1
  ) SELECT count(*) INTO _abert FROM gravado;

  UPDATE public.ecd_importacao
     SET status = 'aplicado', aplicado_em = now(),
         resumo = resumo || jsonb_build_object(
           'linhas_saldos', _linhas, 'linhas_abertura', _abert,
           'contas_sem_vinculo', _sem_vinculo)
   WHERE id = _importacao_id;

  RETURN jsonb_build_object('ok', true,
    'linhas_saldos', _linhas, 'linhas_abertura', _abert,
    'linhas_removidas', _apagadas,
    -- Quando isto é > 0, "0 linhas" tem explicação em vez de mistério.
    'meses_do_diario', _meses_do_diario,
    'abertura_em', _data_abert,
    'contas_sem_vinculo', _sem_vinculo,
    'conferencia', public.ecd_conferencia(_importacao_id));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_aplicar(uuid, boolean, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_aplicar(uuid, boolean, boolean) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 1.3) Desfazer só o que é do ECD
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ecd_desfazer(_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _tenant uuid; _company uuid; _de date; _ate date; _n int; _na int;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT min(competencia), max(competencia) INTO _de, _ate
    FROM public.ecd_saldo WHERE importacao_id = _importacao_id;

  -- Era `competencia BETWEEN _de AND _ate`, sem filtro de origem. Num
  -- ECD que cobre um período onde o diário também existe, isso apagava
  -- o diário inteiro — e não havia como voltar.
  WITH d AS (
    DELETE FROM public.saldos_mensais m
     WHERE m.origem_ecd = _importacao_id
    RETURNING 1
  ) SELECT count(*) INTO _n FROM d;

  WITH d AS (
    DELETE FROM public.saldos_abertura a
     WHERE a.origem_ecd = _importacao_id
    RETURNING 1
  ) SELECT count(*) INTO _na FROM d;

  UPDATE public.ecd_importacao
     SET status = 'importado', aplicado_em = NULL
   WHERE id = _importacao_id;

  RETURN jsonb_build_object('ok', true, 'saldos_removidos', _n,
                            'aberturas_removidas', _na, 'de', _de, 'ate', _ate);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_desfazer(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_desfazer(uuid) TO authenticated, service_role;

-- NOTA sobre `reverter_upload_diario`: ela apaga linhas zeradas de
-- `saldos_mensais` da empresa inteira, sem filtrar origem, e pode levar
-- junto linhas do ECD com movimento zero. NÃO mexi nela aqui de
-- propósito: reescrever uma função que eu não li inteira, no mesmo
-- pacote em que corrijo outras cinco, é como se criam os problemas dos
-- ajustes 32/33. Fica anotado para o próximo, com o defeito descrito.

-- ------------------------------------------------------------
-- 1.4) Os períodos do BI, sem truncar em 1000
-- ------------------------------------------------------------
-- ESTE é o motivo direto de "apliquei o ECD e não aparece no BI".
--
-- A tela lia os períodos assim:
--
--     supabase.from("saldos_mensais").select("competencia").eq("company_id", ...)
--
-- uma linha por (conta, mês). O PostgREST corta em `max_rows = 1000`
-- (supabase/config.toml) e NÃO avisa. Uma empresa com 800 contas e 12
-- meses já são 9.600 linhas: chegam 1.000, das primeiras do heap. As
-- linhas do ECD são inseridas depois das do diário, ficam no fim, e são
-- as primeiras a cair fora. O dado estava lá o tempo todo; o seletor de
-- período é que nunca oferecia aqueles meses.
--
-- Contar mês distinto é trabalho de banco. Uma linha por mês, não uma
-- por conta.
CREATE OR REPLACE FUNCTION public.periodos_da_empresa(_company_id uuid)
RETURNS TABLE (competencia date, fonte text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  -- Sem ramo por `fonte_dados`: período é onde HÁ dado. Uma empresa
  -- pode ter diário e ECD ao mesmo tempo, e tinha de escolher um.
  SELECT c.competencia,
         string_agg(DISTINCT c.fonte, '+' ORDER BY c.fonte) AS fonte
    FROM (
      SELECT DISTINCT m.competencia,
             CASE WHEN m.origem_ecd IS NULL THEN 'diario' ELSE 'ecd' END AS fonte
        FROM public.saldos_mensais m
       WHERE m.company_id = _company_id
         AND public.pode_acessar_empresa(_company_id)
      UNION
      SELECT DISTINCT b.periodo, 'balancete'
        FROM public.account_balances b
       WHERE b.company_id = _company_id
         AND public.pode_acessar_empresa(_company_id)
      UNION
      SELECT DISTINCT f.periodo, 'demonstracao'
        FROM public.financial_statements f
       WHERE f.company_id = _company_id
         AND public.pode_acessar_empresa(_company_id)
    ) c
   GROUP BY c.competencia
   ORDER BY c.competencia;
$fn$;

REVOKE EXECUTE ON FUNCTION public.periodos_da_empresa(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.periodos_da_empresa(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 1.5) Carimba o que já foi aplicado
-- ------------------------------------------------------------
-- Sem isto, um ECD aplicado ANTES deste ajuste continua sem origem — e
-- o desfazer dele voltaria a apagar o diário. Só marca linha que não
-- tem nenhum lançamento de diário explicando ela.
DO $do$
DECLARE _i record; _n int; _t int := 0;
BEGIN
  FOR _i IN SELECT id, company_id FROM public.ecd_importacao WHERE status = 'aplicado' LOOP
    UPDATE public.saldos_mensais m
       SET origem_ecd = _i.id
     WHERE m.company_id = _i.company_id
       AND m.origem_ecd IS NULL
       AND EXISTS (
         SELECT 1 FROM public.ecd_saldo s
           JOIN public.depara_contas d
             ON d.company_id = _i.company_id AND d.conta_codigo = s.codigo
            AND d.conta_padrao_codigo = m.conta_codigo
          WHERE s.importacao_id = _i.id AND s.competencia = m.competencia)
       -- Se há lançamento de diário naquele mês/conta, a linha é do
       -- diário (ou dos dois) e não pode ser carimbada como do ECD.
       AND NOT EXISTS (
         SELECT 1 FROM public.lancamentos_diario l
          WHERE l.company_id = _i.company_id
            AND l.conta_codigo = m.conta_codigo
            AND l.competencia = m.competencia);
    GET DIAGNOSTICS _n = ROW_COUNT;
    _t := _t + _n;
  END LOOP;
  RAISE NOTICE 'saldos carimbados como do ECD: %', _t;
END;
$do$;

-- ============================================================
-- PARTE 2 — A DFC NÃO EXPORTAVA O QUE FOI ALOCADO
-- ============================================================

-- ------------------------------------------------------------
-- 2.1) "0 conta(s) abrangidas" quando gravou certo
-- ------------------------------------------------------------
-- A contagem pegava só os DESCENDENTES:
--
--     left(p.classificacao, length(_classificacao)+1) = _classificacao || '.'
--
-- Classificar uma conta ANALÍTICA — que é o que a lista "Conta a conta"
-- oferece — não tem descendente nenhum, então a resposta era sempre
-- "0 conta(s) abrangidas por este vínculo". O vínculo gravava; a
-- mensagem dizia que não. Qualquer um conclui que não salvou.
--
-- E o escopo: gravar com `_company_id` de uma empresa que usa o Plano
-- Padrão cria um vínculo que a LEITURA nunca enxerga (a resolução
-- colapsa o escopo para NULL). Ficava no banco, aceito, ignorado.
CREATE OR REPLACE FUNCTION public.definir_dfc_classificacao(
  _tenant_id uuid,
  _classificacao text,
  _dfc_codigo text,
  _company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _abaixo bigint; _no_plano bigint;
BEGIN
  IF NOT public.pode_tenant(_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  -- Escrever onde ninguém lê é pior do que recusar.
  IF _company_id IS NOT NULL
     AND COALESCE((public.escopo_plano_empresa(_company_id)->>'usa_plano_padrao')::boolean, false)
  THEN
    RAISE EXCEPTION
      'Esta empresa usa o Plano Padrão do escritório: a alocação de DFC é feita no plano do escritório, não aqui. '
      'Um vínculo gravado no escopo da empresa não seria lido por ninguém.';
  END IF;

  IF _dfc_codigo IS NULL THEN
    DELETE FROM public.dfc_vinculo
     WHERE tenant_id = _tenant_id AND classificacao = _classificacao
       AND company_id IS NOT DISTINCT FROM _company_id;
    RETURN jsonb_build_object('removido', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.dfc_catalogo WHERE codigo = _dfc_codigo) THEN
    RAISE EXCEPTION 'Código de DFC desconhecido: %', _dfc_codigo;
  END IF;

  INSERT INTO public.dfc_vinculo (tenant_id, company_id, classificacao, codigo_dfc, origem)
  VALUES (_tenant_id, _company_id, _classificacao, _dfc_codigo, 'manual')
  ON CONFLICT (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), classificacao)
    DO UPDATE SET codigo_dfc = EXCLUDED.codigo_dfc,
                  origem = 'manual',
                  atualizado_em = now();

  SELECT count(*) FILTER (WHERE p.classificacao = _classificacao
                            OR left(p.classificacao, length(_classificacao) + 1)
                               = _classificacao || '.'),
         count(*) FILTER (WHERE p.classificacao = _classificacao)
    INTO _abaixo, _no_plano
    FROM public.plano_contas p
   WHERE p.tenant_id = _tenant_id
     AND p.company_id IS NOT DISTINCT FROM _company_id
     AND p.is_sintetica = false AND p.ativo;

  RETURN jsonb_build_object(
    'contas_abrangidas', _abaixo,
    -- Vínculo em classificação que não existe no plano é aceito (o plano
    -- pode crescer), mas o silêncio sobre isso escondia erro de digitação.
    'existe_no_plano', (_abaixo > 0));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.definir_dfc_classificacao(uuid, text, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.definir_dfc_classificacao(uuid, text, text, uuid)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2.2) A exportação: rápida de novo, e trazendo TODA alocação
-- ------------------------------------------------------------
-- Três coisas nesta função:
--
-- (a) VOLTA A SER RÁPIDA. O ajuste 34 (meu) reescreveu-a a partir da
--     versão do ajuste 19 e desfez a otimização do ajuste 23: a
--     resolução voltou a ser chamada através da fronteira de função e o
--     casamento de prefixo voltou ao LATERAL com `left()`. Medido:
--     1.509 ms contra 106 ms. Aqui está de volta a versão rápida, com o
--     escopo efetivo do ajuste 34 por cima.
--
-- (b) ESCOPO EFETIVO (ajuste 34): empresa que usa o Plano Padrão exporta
--     o plano do escritório; o "com movimento" continua sendo o dela.
--
-- (c) TODA ALOCAÇÃO APARECE. `grupo` saía só de `plano_contas` filtrado
--     por `left(classificacao,1) IN ('1','2')`. Uma alocação numa conta
--     de RESULTADO — que a DFC usa, os códigos R e D existem para isso —
--     simplesmente não saía na planilha.
--
--     E isso não era só omissão: reimportar a própria planilha com
--     "substituir tudo" APAGA o que não está nela. Exportar e reimportar
--     destruía as alocações de resultado. Reproduzido no banco.
DROP FUNCTION IF EXISTS public.dfc_efetivo(uuid, uuid, boolean);

-- O miolo, com o escopo JÁ RESOLVIDO em parâmetro.
--
-- Por que separado: na primeira tentativa eu resolvi o escopo num CTE
-- (`WITH alvo AS (...)`) e cruzei com `plano_contas`. Custo medido:
-- 1.662 ms — pior do que antes. Vindo de CTE, o planejador não consegue
-- empurrar `company_id IS NULL` para o índice e varre as 135 mil linhas.
-- Como PARÂMETRO, ele empurra. É a mesma consulta com 15× de diferença.
CREATE OR REPLACE FUNCTION public.dfc_efetivo_escopo(
  _tenant_id uuid,
  _escopo_plano uuid,      -- de onde vem o PLANO (NULL = escritório)
  _company_mov uuid,       -- de quem é o MOVIMENTO (NULL = todos)
  _somente_balanco boolean DEFAULT true
)
RETURNS TABLE (
  classificacao text, descricao text, contas int, analiticas int, com_movimento int,
  codigo_dfc text, descricao_dfc text, bloco text,
  classificacao_vinculo text, origem text, ambiguo boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH vin AS MATERIALIZED (
    SELECT DISTINCT ON (v.classificacao)
           v.classificacao, v.codigo_dfc, v.origem, v.company_id
      FROM public.dfc_vinculo v
     WHERE v.tenant_id = _tenant_id
       AND (v.company_id IS NULL OR v.company_id = _escopo_plano)
     ORDER BY v.classificacao, (v.company_id IS NOT NULL) DESC
  ),
  cta AS MATERIALIZED (
    SELECT p.classificacao,
           min(p.dfc_codigo)                AS codigo_dfc,
           count(DISTINCT p.dfc_codigo) > 1 AS ambiguo
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM _escopo_plano
       AND p.dfc_codigo IS NOT NULL
       AND p.ativo
     GROUP BY p.classificacao
  ),
  res AS MATERIALIZED (
    SELECT v.classificacao, v.codigo_dfc, v.origem, false AS ambiguo
      FROM vin v
    UNION ALL
    SELECT c.classificacao, c.codigo_dfc, 'conta', c.ambiguo
      FROM cta c
     WHERE NOT EXISTS (
       SELECT 1 FROM vin v
        WHERE c.classificacao = v.classificacao
           OR left(c.classificacao, length(v.classificacao) + 1) = v.classificacao || '.')
  ),
  grupo_plano AS MATERIALIZED (
    SELECT e.classificacao,
           COALESCE(min(e.descricao) FILTER (WHERE e.is_sintetica),
                    min(e.descricao))                             AS descricao,
           count(*)::int                                          AS contas,
           count(*) FILTER (WHERE NOT e.is_sintetica)::int         AS analiticas,
           count(*) FILTER (WHERE m.conta_codigo IS NOT NULL)::int AS com_movimento
      FROM (
        -- Dois ramos, e a separação é por DESEMPENHO, não por gosto.
        -- Juntar os dois num `OR ... IN (SELECT ... FROM vin)` fazia o
        -- planejador reexecutar o CTE `vin` por linha das 135 mil do
        -- plano: 1.509 ms contra 124 ms. Com o UNION, o segundo ramo
        -- vira junção por igualdade contra ~66 linhas.
        SELECT p.classificacao, p.codigo, p.descricao, p.is_sintetica
          FROM public.plano_contas p
         WHERE p.tenant_id = _tenant_id
           AND p.company_id IS NOT DISTINCT FROM _escopo_plano
           AND p.ativo
           AND (NOT _somente_balanco OR left(p.classificacao, 1) IN ('1', '2'))
        -- UNION ALL, não UNION: os dois ramos são disjuntos por
        -- construção (um exige começar com 1 ou 2, o outro exige não
        -- começar), então a deduplicação do UNION só custava — era uma
        -- ordenação sobre 135 mil linhas.
        UNION ALL
        -- A classificação alocada entra mesmo fora do balanço: sem isto
        -- a planilha não a traz, e reimportar com "substituir tudo" a
        -- APAGA.
        SELECT p.classificacao, p.codigo, p.descricao, p.is_sintetica
          FROM public.plano_contas p
          JOIN vin v ON v.classificacao = p.classificacao
         WHERE _somente_balanco
           AND p.tenant_id = _tenant_id
           AND p.company_id IS NOT DISTINCT FROM _escopo_plano
           AND p.ativo
           AND left(p.classificacao, 1) NOT IN ('1', '2')
      ) e
      LEFT JOIN (
        SELECT DISTINCT s.conta_codigo
          FROM public.saldos_mensais s
         WHERE s.tenant_id = _tenant_id
           AND (_company_mov IS NULL OR s.company_id = _company_mov)
      ) m ON m.conta_codigo = e.codigo
     GROUP BY e.classificacao
  ),
  -- Vínculo em classificação que o plano não tem também sai na planilha,
  -- com contas = 0. Assim ele sobrevive ao ciclo exportar → importar, e
  -- a contagem zero mostra que algo está errado com ele.
  grupo AS MATERIALIZED (
    SELECT * FROM grupo_plano
    UNION ALL
    SELECT v.classificacao, '(sem conta no plano)'::text, 0, 0, 0
      FROM vin v
     WHERE NOT EXISTS (SELECT 1 FROM grupo_plano g WHERE g.classificacao = v.classificacao)
       -- Só os vínculos DESTE escopo. Sem esta linha, exportar uma
       -- empresa de plano próprio despejava os 66 vínculos do escritório
       -- como "(sem conta no plano)" — 68 linhas onde deviam ser 3.
       AND v.company_id IS NOT DISTINCT FROM _escopo_plano
  ),
  anc AS MATERIALIZED (
    SELECT g.classificacao, a.pos,
           array_to_string((string_to_array(g.classificacao, '.'))[1:a.pos], '.') AS ancestral
      FROM grupo g
      CROSS JOIN LATERAL generate_series(
        1, COALESCE(array_length(string_to_array(g.classificacao, '.'), 1), 1)) AS a(pos)
  ),
  escolhido AS MATERIALIZED (
    SELECT DISTINCT ON (an.classificacao)
           an.classificacao, r.classificacao AS cls_vinculo,
           r.codigo_dfc, r.origem, r.ambiguo
      FROM anc an
      JOIN res r ON r.classificacao = an.ancestral
     ORDER BY an.classificacao, an.pos DESC
  )
  SELECT g.classificacao, g.descricao, g.contas, g.analiticas, g.com_movimento,
         e.codigo_dfc, cat.descricao, cat.bloco, e.cls_vinculo,
         CASE WHEN e.cls_vinculo IS NULL           THEN 'sem alocação'
              WHEN e.cls_vinculo = g.classificacao THEN e.origem
              ELSE 'herdado' END,
         COALESCE(e.ambiguo, false)
    FROM grupo g
    LEFT JOIN escolhido e ON e.classificacao = g.classificacao
    LEFT JOIN public.dfc_catalogo cat ON cat.codigo = e.codigo_dfc
   ORDER BY g.classificacao;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_efetivo_escopo(uuid, uuid, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_efetivo_escopo(uuid, uuid, uuid, boolean) TO service_role;

-- A porta de entrada: resolve o escopo e chama o miolo.
CREATE OR REPLACE FUNCTION public.dfc_efetivo(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _somente_balanco boolean DEFAULT true
)
RETURNS TABLE (
  classificacao text, descricao text, contas int, analiticas int, com_movimento int,
  codigo_dfc text, descricao_dfc text, bloco text,
  classificacao_vinculo text, origem text, ambiguo boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _escopo uuid;
BEGIN
  -- Empresa que usa o Plano Padrão exporta o plano do escritório (ajuste
  -- 34); o movimento continua sendo o dela.
  _escopo := CASE
    WHEN _company_id IS NULL THEN NULL
    WHEN COALESCE((public.escopo_plano_empresa(_company_id)->>'usa_plano_padrao')::boolean,
                  false) THEN NULL
    ELSE _company_id END;
  RETURN QUERY SELECT * FROM public.dfc_efetivo_escopo(
    _tenant_id, _escopo, _company_id, _somente_balanco);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_efetivo(uuid, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_efetivo(uuid, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.dfc_exportar(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _somente_balanco boolean DEFAULT true
)
RETURNS TABLE (
  classificacao text, descricao text, contas int, analiticas int, com_movimento int,
  codigo_dfc text, descricao_dfc text, bloco text,
  classificacao_vinculo text, origem text, ambiguo boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.pode_tenant(_tenant_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  RETURN QUERY SELECT * FROM public.dfc_efetivo(_tenant_id, _company_id, _somente_balanco);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_exportar(uuid, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_exportar(uuid, uuid, boolean) TO authenticated, service_role;

-- As outras guardas do mesmo módulo, pelo mesmo motivo do item 0.
CREATE OR REPLACE FUNCTION public.dfc_exportar_contas(
  _tenant_id uuid, _company_id uuid DEFAULT NULL, _limite int DEFAULT 5000)
RETURNS TABLE (
  codigo text, classificacao text, descricao text,
  codigo_na_conta text, codigo_efetivo text, em_vigor boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _alvo uuid;
BEGIN
  IF NOT public.pode_tenant(_tenant_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  _alvo := CASE
    WHEN _company_id IS NULL THEN NULL
    WHEN COALESCE((public.escopo_plano_empresa(_company_id)->>'usa_plano_padrao')::boolean,
                  false) THEN NULL
    ELSE _company_id END;

  RETURN QUERY
  WITH res AS MATERIALIZED (SELECT * FROM public.dfc_resolucao(_tenant_id, _alvo)),
  suspeitas AS (
    SELECT r.classificacao, r.codigo_dfc, r.ambiguo
      FROM res r WHERE r.ambiguo OR r.origem <> 'conta'
  )
  SELECT p.codigo, p.classificacao, p.descricao, p.dfc_codigo, s.codigo_dfc,
         s.codigo_dfc IS NOT DISTINCT FROM p.dfc_codigo
    FROM public.plano_contas p
    JOIN suspeitas s ON s.classificacao = p.classificacao
   WHERE p.tenant_id = _tenant_id
     AND p.company_id IS NOT DISTINCT FROM _alvo
     AND p.dfc_codigo IS NOT NULL
     AND p.ativo
     AND s.codigo_dfc IS DISTINCT FROM p.dfc_codigo
   ORDER BY p.classificacao, p.codigo
   LIMIT least(_limite, 1000);   -- o servidor corta em 1000 de qualquer jeito
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_exportar_contas(uuid, uuid, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_exportar_contas(uuid, uuid, int) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
