-- ============================================================
-- AJUSTE 14 — DFC pela sintética, drill-down e apresentação
-- ============================================================

-- ------------------------------------------------------------
-- 1) Herdar a DFC da sintética imediatamente superior
--
-- A planilha classifica ~71 pontos do plano. Tudo que fica fora deles
-- precisava ser classificado à mão, conta a conta — e num plano de
-- 135.000 contas isso não acontece.
--
-- Esta rotina sobe a árvore: para cada analítica sem código, procura o
-- ANCESTRAL MAIS PRÓXIMO que tenha um, e herda. Roda em cascata do nível
-- mais fundo para o mais raso, então classificar UMA sintética resolve
-- tudo que está pendurado nela.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.herdar_dfc_da_sintetica(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _todos_escopos boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _herdadas int := 0; _restantes int := 0;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  WITH alvo AS (
    SELECT p.id, p.classificacao
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND (_todos_escopos OR p.company_id IS NOT DISTINCT FROM _company_id)
       AND p.dfc_codigo IS NULL
       AND p.ativo
  ),
  -- ancestral mais próximo COM código, dentro do mesmo escopo
  herdado AS (
    SELECT a.id,
           (SELECT anc.dfc_codigo
              FROM public.plano_contas anc
             WHERE anc.tenant_id = _tenant_id
               AND (_todos_escopos OR anc.company_id IS NOT DISTINCT FROM _company_id)
               AND anc.dfc_codigo IS NOT NULL
               AND left(a.classificacao, length(anc.classificacao) + 1)
                   = anc.classificacao || '.'
             ORDER BY length(anc.classificacao) DESC
             LIMIT 1) AS codigo
      FROM alvo a
  ),
  upd AS (
    UPDATE public.plano_contas p
       SET dfc_codigo = h.codigo
      FROM herdado h
     WHERE p.id = h.id AND h.codigo IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO _herdadas FROM upd;

  SELECT count(*) INTO _restantes
    FROM public.plano_contas p
   WHERE p.tenant_id = _tenant_id
     AND (_todos_escopos OR p.company_id IS NOT DISTINCT FROM _company_id)
     AND p.is_sintetica = false AND p.ativo
     AND p.dfc_codigo IS NULL
     AND left(p.classificacao, 1) IN ('1', '2');

  RETURN jsonb_build_object('herdadas', _herdadas, 'analiticas_sem_codigo', _restantes);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.herdar_dfc_da_sintetica(uuid, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.herdar_dfc_da_sintetica(uuid, uuid, boolean)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2) Classificar a DFC POR SINTÉTICA — a tela que faltava
--
-- Lista as sintéticas que ainda mandam em analíticas sem código, com
-- quantas contas cada uma resolve. Ordenado pelo que resolve mais: as
-- primeiras linhas da lista costumam cobrir a maior parte do plano.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dfc_sinteticas_pendentes(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _limite int DEFAULT 200
)
RETURNS TABLE (
  classificacao text,
  descricao text,
  tipo text,
  nivel int,
  dfc_codigo text,
  analiticas_sem_codigo bigint,
  analiticas_total bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  RETURN QUERY
  WITH escopo AS (
    SELECT p.classificacao, p.descricao, p.tipo, p.nivel, p.is_sintetica,
           p.dfc_codigo, p.conta_pai_classificacao
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM _company_id
       AND p.ativo
  ),
  -- a sintética IMEDIATAMENTE superior de cada analítica pendente
  pendentes AS (
    SELECT e.conta_pai_classificacao AS pai,
           count(*) FILTER (WHERE e.dfc_codigo IS NULL) AS sem,
           count(*) AS tot
      FROM escopo e
     WHERE e.is_sintetica = false
       AND left(e.classificacao, 1) IN ('1', '2')
       AND e.conta_pai_classificacao IS NOT NULL
     GROUP BY e.conta_pai_classificacao
  )
  SELECT s.classificacao, s.descricao, s.tipo, s.nivel, s.dfc_codigo, p.sem, p.tot
    FROM pendentes p
    JOIN escopo s ON s.classificacao = p.pai AND s.is_sintetica
   WHERE p.sem > 0
   ORDER BY p.sem DESC, s.classificacao
   LIMIT _limite;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_sinteticas_pendentes(uuid, uuid, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_sinteticas_pendentes(uuid, uuid, int)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- Define o código numa sintética e desce para tudo abaixo dela.
-- `_sobrescrever` decide se contas já classificadas são reescritas.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.definir_dfc_sintetica(
  _tenant_id uuid,
  _classificacao text,
  _dfc_codigo text,
  _company_id uuid DEFAULT NULL,
  _sobrescrever boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _n int := 0;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF _dfc_codigo IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.dfc_catalogo WHERE codigo = _dfc_codigo) THEN
    RAISE EXCEPTION 'Código de DFC desconhecido: %', _dfc_codigo;
  END IF;

  UPDATE public.plano_contas p
     SET dfc_codigo = _dfc_codigo
   WHERE p.tenant_id = _tenant_id
     AND p.company_id IS NOT DISTINCT FROM _company_id
     AND (p.classificacao = _classificacao
          OR left(p.classificacao, length(_classificacao) + 1) = _classificacao || '.')
     AND (_sobrescrever OR p.dfc_codigo IS NULL OR p.classificacao = _classificacao);
  GET DIAGNOSTICS _n = ROW_COUNT;

  RETURN jsonb_build_object('contas_atualizadas', _n);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.definir_dfc_sintetica(uuid, text, text, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.definir_dfc_sintetica(uuid, text, text, uuid, boolean)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) Cobertura da DFC em uma consulta
--
-- A tela do Plano Padrão carregava 40.000 linhas do plano em 40 idas ao
-- servidor só para contar quantas contas estavam sem classificação — num
-- plano de 135.000 contas ela nem terminava de carregar, e por isso o
-- botão de reaplicar a planilha "não funcionava": a tela travava antes.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dfc_cobertura(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _r jsonb;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT jsonb_build_object(
           'analiticas_balanco', count(*) FILTER (WHERE is_sintetica = false AND grupo IN ('1','2')),
           'sem_codigo',         count(*) FILTER (WHERE is_sintetica = false AND grupo IN ('1','2') AND dfc_codigo IS NULL),
           'sinteticas_balanco', count(*) FILTER (WHERE is_sintetica AND grupo IN ('1','2')),
           'sinteticas_sem_codigo', count(*) FILTER (WHERE is_sintetica AND grupo IN ('1','2') AND dfc_codigo IS NULL),
           'total_plano',        count(*)
         )
    INTO _r
    FROM (
      SELECT p.is_sintetica, p.dfc_codigo, left(p.classificacao, 1) AS grupo
        FROM public.plano_contas p
       WHERE p.tenant_id = _tenant_id
         AND p.company_id IS NOT DISTINCT FROM _company_id
         AND p.ativo
    ) t;
  RETURN _r;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_cobertura(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_cobertura(uuid, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Analíticas ainda sem classificação, paginadas e com busca.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dfc_analiticas_sem_codigo(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _busca text DEFAULT NULL,
  _limite int DEFAULT 200
)
RETURNS TABLE (codigo text, classificacao text, descricao text, tipo text, conta_pai text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  RETURN QUERY
  SELECT p.codigo, p.classificacao, p.descricao, p.tipo, p.conta_pai_classificacao
    FROM public.plano_contas p
   WHERE p.tenant_id = _tenant_id
     AND p.company_id IS NOT DISTINCT FROM _company_id
     AND p.ativo
     AND p.is_sintetica = false
     AND p.dfc_codigo IS NULL
     AND left(p.classificacao, 1) IN ('1', '2')
     AND (_busca IS NULL OR _busca = ''
          OR p.codigo ILIKE '%' || _busca || '%'
          OR p.classificacao ILIKE _busca || '%'
          OR p.descricao ILIKE '%' || _busca || '%')
   ORDER BY p.classificacao, p.codigo
   LIMIT _limite;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_analiticas_sem_codigo(uuid, uuid, text, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_analiticas_sem_codigo(uuid, uuid, text, int)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) Índice para o drill-down
--
-- O drill-down filtrava com `ilike('1.01%')`, que é insensível a caixa e
-- por isso NÃO usa índice: cada clique varria a tabela inteira. Passou a
-- usar `like`, que usa — desde que exista índice com `text_pattern_ops`,
-- porque em locale não-C o btree padrão não serve para LIKE.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_plano_contas_classif_pattern
  ON public.plano_contas (tenant_id, company_id, classificacao text_pattern_ops);

-- Roda a herança agora, para o plano já sair classificado.
DO $herda$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT tenant_id, company_id FROM public.plano_contas LOOP
    WITH alvo AS (
      SELECT p.id, p.classificacao FROM public.plano_contas p
       WHERE p.tenant_id = r.tenant_id
         AND p.company_id IS NOT DISTINCT FROM r.company_id
         AND p.dfc_codigo IS NULL AND p.ativo
    ), herdado AS (
      SELECT a.id,
             (SELECT anc.dfc_codigo FROM public.plano_contas anc
               WHERE anc.tenant_id = r.tenant_id
                 AND anc.company_id IS NOT DISTINCT FROM r.company_id
                 AND anc.dfc_codigo IS NOT NULL
                 AND left(a.classificacao, length(anc.classificacao) + 1)
                     = anc.classificacao || '.'
               ORDER BY length(anc.classificacao) DESC LIMIT 1) AS codigo
        FROM alvo a
    )
    UPDATE public.plano_contas p SET dfc_codigo = h.codigo
      FROM herdado h WHERE p.id = h.id AND h.codigo IS NOT NULL;
  END LOOP;
END;
$herda$;

ANALYZE public.plano_contas;

-- ------------------------------------------------------------
-- 5) Drill-down: resolver as contas no servidor
--
-- Trocar `ilike` por `like` ajudou, mas não resolvia o caso que trava de
-- verdade: abrir "CREDITOS" (1.01.02) num plano de escritório traz
-- 113.452 contas — todos os clientes — para o navegador, sendo que
-- pouquíssimas têm lançamento no período.
--
-- Esta função devolve só as contas que REALMENTE têm lançamento na
-- empresa, já com o escopo do plano resolvido (Padrão x próprio) e com o
-- de-para aplicado ao contrário quando a empresa é de outro sistema.
-- ------------------------------------------------------------
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
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  _esc := public.escopo_plano_empresa(_company_id);
  _tenant := (_esc->>'tenant_id')::uuid;
  _usa_padrao := COALESCE((_esc->>'usa_plano_padrao')::boolean, false);
  _usa_depara := COALESCE((_esc->>'usa_depara')::boolean, false);
  IF _tenant IS NULL THEN RETURN; END IF;
  _scope := CASE WHEN _usa_padrao THEN NULL ELSE _company_id END;

  -- Começa pelas contas que TÊM movimento (dezenas), não pelas que estão
  -- sob a classificação (podem ser 113.000 clientes). Inverter a ordem é
  -- o que faz esta consulta caber num clique.
  --
  -- Os dois caminhos ficam em IF/ELSE, não num UNION com filtro: dentro
  -- de um UNION o Postgres avalia `depara_traducao()` mesmo quando o
  -- ramo não se aplica, e essa função sozinha custa mais que a consulta
  -- inteira.
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
    )
    SELECT p.codigo, p.descricao, p.classificacao
      FROM com_mov m
      JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _scope
       AND p.codigo = m.conta_codigo
     WHERE p.is_sintetica = false
       AND (p.classificacao = _classificacao
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
    ),
    trad AS (
      SELECT t.conta_codigo, t.conta_padrao_codigo
        FROM public.depara_traducao(_company_id) t
       WHERE NOT t.ignorada AND t.conta_padrao_codigo IS NOT NULL
    )
    SELECT m.conta_codigo, COALESCE(o.descricao, p.descricao), p.classificacao
      FROM com_mov m
      JOIN trad tr ON tr.conta_codigo = m.conta_codigo
      JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _scope
       AND p.codigo = tr.conta_padrao_codigo
      LEFT JOIN public.plano_contas o
        ON o.tenant_id = _tenant AND o.company_id = _company_id
       AND o.codigo = m.conta_codigo
     WHERE p.is_sintetica = false
       AND (p.classificacao = _classificacao
            OR left(p.classificacao, length(_classificacao) + 1) = _classificacao || '.')
     ORDER BY p.classificacao, m.conta_codigo;
  END IF;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.drilldown_contas(uuid, text, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.drilldown_contas(uuid, text, date, date)
  TO authenticated, service_role;
