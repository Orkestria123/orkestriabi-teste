-- ============================================================
-- AJUSTE 34 — clientes e fornecedores no de-para, e a DFC da EMPRESA
-- ============================================================
--
-- DOIS DEFEITOS, E OS DOIS SÃO DE ALGO QUE NUNCA RODOU
--
-- 1) "se eu procurar agora fornecedores e clientes, não aparece nada"
--
--    O plano do escritório guarda cliente e fornecedor como CONTA: são
--    ~135.000 linhas com `is_participante = true`. O seletor de destino
--    exclui as três coisas que não podem ser destino:
--
--        is_sintetica = false      → tira CLIENTES, FORNECEDORES (os pais)
--        is_participante = false   → tira os 135.000 participantes
--        ativo = true
--
--    Sobra o quê para "fornecedores"? NADA — e é literalmente nada, não
--    é uma lista curta. Porque o destino que deveria existir é a CONTA
--    AGREGADORA ("FORNECEDORES NACIONAIS (consolidado)"), criada pela
--    função `garantir_contas_agregadoras`, escrita no ajuste 13.
--
--    Essa função nunca foi chamada. Nem por migração, nem pela
--    aplicação — conferi as duas. Ela existe no banco há dez ajustes
--    esperando alguém pedir. No meu banco de teste ela roda porque o
--    seed a chama de propósito; no seu, nunca rodou. Por isso o teste
--    passava e a sua tela não achava nada.
--
-- 2) "DFC alocação ainda não exportável"
--
--    `dfc_efetivo` monta o escopo assim:
--
--        WHERE p.company_id IS NOT DISTINCT FROM _company_id
--
--    Escopo ESTRITO. Uma empresa que usa o Plano Padrão não tem conta
--    nenhuma com o company_id dela — o plano dela é o do escritório.
--    Resultado: zero linhas, planilha vazia. Não é erro na tela, é a
--    consulta respondendo "não há nada" para a pergunta errada.
--
--    A regra certa já existia no mesmo arquivo, em `dfc_mapa`:
--
--        _scope := CASE WHEN usa_plano_padrao THEN NULL ELSE _company_id END
--
--    A exportação simplesmente nunca a adotou.

-- ------------------------------------------------------------
-- 1) As contas agregadoras, sem depender de alguém lembrar
-- ------------------------------------------------------------
-- Separada de `garantir_contas_agregadoras` porque aquela cobra
-- permissão de sessão (`get_my_tenant_id()`), e uma migração roda SEM
-- sessão — a chamada de dentro do backfill estouraria. Esta é a parte
-- que cria as contas, e só isso.
CREATE OR REPLACE FUNCTION public.plano_criar_agregadoras(_tenant_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _criadas int := 0;
BEGIN
  WITH classes AS (
    -- Cada classificação que hospeda participante vira UMA agregadora.
    -- No plano do escritório são 4: clientes e fornecedores, nacionais
    -- e estrangeiros.
    SELECT p.classificacao, p.tipo,
           max(p.nivel) AS nivel,
           max(p.conta_pai_classificacao) AS pai
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NULL
       AND p.is_participante
     GROUP BY p.classificacao, p.tipo
  ),
  nomeadas AS (
    SELECT c.*,
           COALESCE(
             (SELECT pai.descricao FROM public.plano_contas pai
               WHERE pai.tenant_id = _tenant_id AND pai.company_id IS NULL
                 AND pai.classificacao = c.pai AND pai.is_sintetica
               LIMIT 1),
             'PARTICIPANTES ' || c.classificacao) AS nome
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
      DO UPDATE SET descricao = EXCLUDED.descricao, ativo = true
    RETURNING (xmax = 0) AS nova
  )
  SELECT count(*) FILTER (WHERE nova) INTO _criadas FROM ins;
  RETURN _criadas;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.plano_criar_agregadoras(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.plano_criar_agregadoras(uuid) TO authenticated, service_role;

-- A função pública continua igual por fora; por dentro delega.
CREATE OR REPLACE FUNCTION public.garantir_contas_agregadoras(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _criadas int;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  _criadas := public.plano_criar_agregadoras(_tenant_id);
  PERFORM public.aplicar_dfc_padrao(_tenant_id, NULL, false);
  RETURN jsonb_build_object('agregadoras_criadas', _criadas);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.garantir_contas_agregadoras(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.garantir_contas_agregadoras(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2) Gatilho: carga de plano com participante nasce com agregadora
-- ------------------------------------------------------------
-- Sem isto, o defeito volta na próxima atualização mensal do plano que
-- traga uma classificação de participante nova. Mesma forma do gatilho
-- de classificação do ECD: POR COMANDO, com tabela de transição — não
-- roda 135.000 vezes, roda uma vez por carga.
CREATE OR REPLACE FUNCTION public.plano_agregadoras_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $tg$
DECLARE _t uuid;
BEGIN
  FOR _t IN
    SELECT DISTINCT tenant_id FROM novas
     WHERE company_id IS NULL AND is_participante
  LOOP
    PERFORM public.plano_criar_agregadoras(_t);
  END LOOP;
  RETURN NULL;
END;
$tg$;

DROP TRIGGER IF EXISTS plano_contas_agregadoras ON public.plano_contas;
CREATE TRIGGER plano_contas_agregadoras
  AFTER INSERT ON public.plano_contas
  REFERENCING NEW TABLE AS novas
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.plano_agregadoras_tg();

-- ------------------------------------------------------------
-- 3) Quantos participantes cada agregadora representa
-- ------------------------------------------------------------
-- O seletor precisa disto para a escolha ser informada: apontar 300
-- contas de fornecedor de um ECD para uma linha só é a decisão certa,
-- mas quem escolhe tem que ver que aquela linha representa 84 mil
-- contas do plano — e não uma conta qualquer com nome parecido.
--
-- São 4 linhas de resposta, lidas de índice. Não é a contagem que pesa,
-- é fazê-la no navegador sobre 135 mil linhas — que é o que NÃO se faz.
CREATE OR REPLACE FUNCTION public.plano_agregadoras(_tenant_id uuid)
RETURNS TABLE (classificacao text, participantes int)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT p.classificacao, count(*)::int
    FROM public.plano_contas p
   WHERE p.tenant_id = _tenant_id
     AND p.company_id IS NULL
     AND p.is_participante
     AND (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id)
   GROUP BY p.classificacao;
$fn$;

REVOKE EXECUTE ON FUNCTION public.plano_agregadoras(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.plano_agregadoras(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) A DFC da EMPRESA: escopo efetivo, não escopo literal
-- ------------------------------------------------------------
-- Só o CTE `escopo` muda. O resto é o mesmo do ajuste 19, inclusive o
-- `MATERIALIZED` — sem ele o planejador reexecuta `dfc_resolucao` uma
-- vez por classificação (3,1 s no plano real).
--
-- `mov` continua olhando a EMPRESA de verdade, e é o que se quer: o
-- plano é o do escritório, mas "quantas destas contas têm movimento"
-- só faz sentido para a empresa que se está exportando.
CREATE OR REPLACE FUNCTION public.dfc_efetivo(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _somente_balanco boolean DEFAULT true
)
RETURNS TABLE (
  classificacao text,
  descricao text,
  contas int,
  analiticas int,
  com_movimento int,
  codigo_dfc text,
  descricao_dfc text,
  bloco text,
  classificacao_vinculo text,
  origem text,
  ambiguo boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH alvo AS (
    -- A empresa que usa o Plano Padrão NÃO tem plano próprio: o plano
    -- dela é o do escritório, e é ele que tem que ser exportado. Mesma
    -- regra que `dfc_mapa` já usava para LER a DFC — a exportação só
    -- não a tinha adotado, e por isso saía vazia.
    SELECT CASE
      WHEN _company_id IS NULL THEN NULL::uuid
      WHEN COALESCE(
             (public.escopo_plano_empresa(_company_id)->>'usa_plano_padrao')::boolean,
             false) THEN NULL::uuid
      ELSE _company_id
    END AS company_id
  ),
  escopo AS (
    SELECT p.classificacao, p.codigo, p.descricao, p.is_sintetica
      FROM public.plano_contas p, alvo a
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM a.company_id
       AND p.ativo
       AND (NOT _somente_balanco OR left(p.classificacao, 1) IN ('1', '2'))
  ),
  mov AS (
    SELECT DISTINCT s.conta_codigo
      FROM public.saldos_mensais s
     WHERE s.tenant_id = _tenant_id
       AND (_company_id IS NULL OR s.company_id = _company_id)
  ),
  grupo AS (
    SELECT e.classificacao,
           COALESCE(min(e.descricao) FILTER (WHERE e.is_sintetica),
                    min(e.descricao))                           AS descricao,
           count(*)::int                                        AS contas,
           count(*) FILTER (WHERE NOT e.is_sintetica)::int       AS analiticas,
           count(*) FILTER (WHERE m.conta_codigo IS NOT NULL)::int AS com_movimento
      FROM escopo e
      LEFT JOIN mov m ON m.conta_codigo = e.codigo
     GROUP BY e.classificacao
  ),
  res AS MATERIALIZED (
    SELECT * FROM public.dfc_resolucao(
      _tenant_id, (SELECT company_id FROM alvo))
  )
  SELECT g.classificacao,
         g.descricao,
         g.contas,
         g.analiticas,
         g.com_movimento,
         r.codigo_dfc,
         cat.descricao,
         cat.bloco,
         r.classificacao,
         CASE WHEN r.classificacao IS NULL           THEN 'sem alocação'
              WHEN r.classificacao = g.classificacao THEN r.origem
              ELSE 'herdado' END,
         COALESCE(r.ambiguo, false)
    FROM grupo g
    LEFT JOIN LATERAL (
      SELECT x.classificacao, x.codigo_dfc, x.origem, x.ambiguo
        FROM res x
       WHERE g.classificacao = x.classificacao
          OR left(g.classificacao, length(x.classificacao) + 1) = x.classificacao || '.'
       ORDER BY length(x.classificacao) DESC
       LIMIT 1
    ) r ON true
    LEFT JOIN public.dfc_catalogo cat ON cat.codigo = r.codigo_dfc
   ORDER BY g.classificacao;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_efetivo(uuid, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_efetivo(uuid, uuid, boolean) TO service_role;

-- `dfc_exportar_contas` tem o mesmo escopo estrito, e a mesma cura.
CREATE OR REPLACE FUNCTION public.dfc_exportar_contas(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _limite int DEFAULT 5000
)
RETURNS TABLE (
  codigo text,
  classificacao text,
  descricao text,
  codigo_na_conta text,
  codigo_efetivo text,
  em_vigor boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _alvo uuid;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  _alvo := CASE
    WHEN _company_id IS NULL THEN NULL
    WHEN COALESCE((public.escopo_plano_empresa(_company_id)->>'usa_plano_padrao')::boolean,
                  false) THEN NULL
    ELSE _company_id END;

  -- Daqui para baixo é o corpo do ajuste 19, LETRA POR LETRA. A única
  -- diferença são os dois `_company_id` que viraram `_alvo` — o escopo
  -- do plano. A regra do que é "exceção" não muda: só sai o que
  -- CONFLITA, senão a aba lista o plano inteiro.
  RETURN QUERY
  WITH res AS MATERIALIZED (
    SELECT * FROM public.dfc_resolucao(_tenant_id, _alvo)
  ),
  suspeitas AS (
    SELECT r.classificacao, r.codigo_dfc, r.ambiguo
      FROM res r
     WHERE r.ambiguo OR r.origem <> 'conta'
  )
  SELECT p.codigo, p.classificacao, p.descricao,
         p.dfc_codigo,
         s.codigo_dfc,
         s.codigo_dfc IS NOT DISTINCT FROM p.dfc_codigo
    FROM public.plano_contas p
    JOIN suspeitas s ON s.classificacao = p.classificacao
   WHERE p.tenant_id = _tenant_id
     AND p.company_id IS NOT DISTINCT FROM _alvo
     AND p.dfc_codigo IS NOT NULL
     AND p.ativo
     AND s.codigo_dfc IS DISTINCT FROM p.dfc_codigo
   ORDER BY p.classificacao, p.codigo
   LIMIT _limite;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_exportar_contas(uuid, uuid, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_exportar_contas(uuid, uuid, int) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5) O backfill que nunca aconteceu
-- ------------------------------------------------------------
DO $do$
DECLARE _t uuid; _n int; _total int := 0;
BEGIN
  FOR _t IN
    SELECT DISTINCT tenant_id FROM public.plano_contas
     WHERE company_id IS NULL AND is_participante
  LOOP
    _n := public.plano_criar_agregadoras(_t);
    _total := _total + _n;
  END LOOP;
  RAISE NOTICE 'contas agregadoras criadas: %', _total;
END;
$do$;

NOTIFY pgrst, 'reload schema';
