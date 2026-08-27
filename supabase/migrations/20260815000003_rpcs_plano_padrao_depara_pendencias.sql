-- ============================================================
-- AJUSTE 01 (parte 3/3) — as RPCs que sustentam as telas novas.
--
--  1. pode_acessar_empresa()      guarda de autorização reutilizável
--  2. atualizar_plano_padrao()    carga mensal incremental (nunca apaga)
--  3. plano_cobertura()           resumo "o que falta alocar"
--  4. plano_pendencias()          fila de contas sem alocação
--  5. depara_pendencias()         fila de de-para (plano de terceiro)
--  6. aplicar_depara_em_lote()    grava de-para em lote
--
-- NOTA DE SEGURANÇA: toda função aqui é SECURITY DEFINER e recebe
-- _company_id vindo do cliente. Isso é exatamente o padrão que gerou
-- o vazamento cross-tenant do indicador_snapshot (item 1 do AUDIT.md),
-- então TODAS validam o acesso antes de ler qualquer dado, via
-- pode_acessar_empresa().
-- ============================================================

-- ------------------------------------------------------------
-- 1) Guarda de autorização reutilizável
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pode_acessar_empresa(_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_da_empresa uuid;
  _meu_tenant uuid;
  _minha_empresa uuid;
BEGIN
  SELECT tenant_id INTO _tenant_da_empresa FROM public.companies WHERE id = _company_id;
  IF _tenant_da_empresa IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_orkestria_admin() THEN
    RETURN true;
  END IF;
  _meu_tenant := public.get_my_tenant_id();
  _minha_empresa := public.get_my_company_id();
  IF _meu_tenant IS DISTINCT FROM _tenant_da_empresa THEN
    RETURN false;
  END IF;
  -- usuário preso a uma empresa (papel client) só enxerga a própria
  IF _minha_empresa IS NOT NULL AND _minha_empresa IS DISTINCT FROM _company_id THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pode_acessar_empresa(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.pode_acessar_empresa(uuid) TO authenticated, service_role;

-- Helper interno: resolve o escopo do plano (global do tenant x da empresa)
-- e o separador da máscara, num lugar só.
CREATE OR REPLACE FUNCTION public.plano_escopo(_company_id uuid)
RETURNS TABLE (tenant_id uuid, company_scope uuid, separador text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
  _modo text;
  _scope uuid;
  _sep text;
BEGIN
  SELECT c.tenant_id, t.plano_contas_modo
    INTO _tenant, _modo
    FROM public.companies c
    JOIN public.tenants t ON t.id = c.tenant_id
   WHERE c.id = _company_id;

  IF _tenant IS NULL THEN
    RETURN;
  END IF;

  _scope := CASE WHEN COALESCE(_modo,'empresa') = 'global' THEN NULL ELSE _company_id END;

  SELECT COALESCE(mc.separador, '.') INTO _sep
    FROM public.mascara_classificacao mc
   WHERE mc.tenant_id = _tenant
     AND mc.company_id IS NOT DISTINCT FROM _scope
   LIMIT 1;

  RETURN QUERY SELECT _tenant, _scope, COALESCE(_sep, '.');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.plano_escopo(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.plano_escopo(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2) Atualização mensal do Plano Padrão — INCREMENTAL
-- ------------------------------------------------------------
-- Regra do negócio: o plano SÓ CRESCE. Conta que não veio no arquivo
-- do mês continua ativa e intacta (pode ter lançamento histórico).
-- Conta que já existe tem só os campos descritivos atualizados —
-- a ALOCAÇÃO (linha da DRE/BP, flags de DFC, tipo de custo) é
-- preservada, senão a carga mensal apagaria a configuração toda.
--
-- _company_id = NULL  -> Plano Padrão do tenant (modo global)
-- _company_id = uuid  -> plano próprio daquela empresa
CREATE OR REPLACE FUNCTION public.atualizar_plano_padrao(
  _tenant_id uuid,
  _company_id uuid,
  _rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _novas int := 0;
  _atualizadas int := 0;
  _total int := 0;
BEGIN
  -- Autorização: para plano de empresa, checa a empresa. Para plano
  -- global do tenant, exige pertencer ao tenant (ou ser super admin).
  IF _company_id IS NOT NULL THEN
    IF NOT public.pode_acessar_empresa(_company_id) THEN
      RAISE EXCEPTION 'Sem permissão para atualizar o plano desta empresa';
    END IF;
  ELSIF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para atualizar o Plano Padrão deste escritório';
  END IF;

  WITH entrada AS (
    -- DISTINCT ON protege contra código repetido dentro do mesmo lote
    -- (ON CONFLICT não pode afetar a mesma linha duas vezes).
    SELECT DISTINCT ON (x.codigo) x.*
      FROM jsonb_to_recordset(_rows) AS x(
        codigo text,
        classificacao text,
        descricao text,
        tipo text,
        natureza text,
        nivel int,
        is_participante boolean,
        is_sintetica boolean,
        conta_pai_classificacao text
      )
     WHERE x.codigo IS NOT NULL AND x.classificacao IS NOT NULL
     ORDER BY x.codigo
  ),
  gravadas AS (
    INSERT INTO public.plano_contas AS pc (
      tenant_id, company_id, codigo, classificacao, descricao, tipo,
      natureza, nivel, is_participante, is_sintetica, conta_pai_classificacao, ativo
    )
    SELECT _tenant_id, _company_id, e.codigo, e.classificacao, e.descricao, e.tipo,
           CASE WHEN upper(left(COALESCE(e.natureza,'A'),1)) = 'S' THEN 'S' ELSE 'A' END,
           COALESCE(e.nivel, 1), COALESCE(e.is_participante,false),
           COALESCE(e.is_sintetica, upper(left(COALESCE(e.natureza,'A'),1)) = 'S'),
           e.conta_pai_classificacao, true
      FROM entrada e
    ON CONFLICT (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo)
    DO UPDATE SET
      classificacao           = EXCLUDED.classificacao,
      descricao               = EXCLUDED.descricao,
      tipo                    = EXCLUDED.tipo,
      natureza                = EXCLUDED.natureza,
      nivel                   = EXCLUDED.nivel,
      is_participante         = EXCLUDED.is_participante,
      is_sintetica            = EXCLUDED.is_sintetica,
      conta_pai_classificacao = EXCLUDED.conta_pai_classificacao,
      ativo                   = true,
      updated_at              = now()
    -- Só grava se algo descritivo realmente mudou: evita inflar
    -- updated_at e o contador de "atualizadas" em carga repetida.
    WHERE (pc.classificacao, pc.descricao, pc.tipo, pc.natureza, pc.nivel,
           pc.is_participante, pc.is_sintetica, pc.conta_pai_classificacao, pc.ativo)
       IS DISTINCT FROM
          (EXCLUDED.classificacao, EXCLUDED.descricao, EXCLUDED.tipo, EXCLUDED.natureza,
           EXCLUDED.nivel, EXCLUDED.is_participante, EXCLUDED.is_sintetica,
           EXCLUDED.conta_pai_classificacao, true)
    RETURNING (xmax = 0) AS inserida
  )
  SELECT count(*) FILTER (WHERE inserida),
         count(*) FILTER (WHERE NOT inserida)
    INTO _novas, _atualizadas
    FROM gravadas;

  SELECT count(*) INTO _total FROM jsonb_array_elements(_rows);

  RETURN jsonb_build_object(
    'total_arquivo', _total,
    'novas', _novas,
    'atualizadas', _atualizadas,
    'inalteradas', GREATEST(_total - _novas - _atualizadas, 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.atualizar_plano_padrao(uuid, uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.atualizar_plano_padrao(uuid, uuid, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) Fila de contas SEM alocação (com movimento)
-- ------------------------------------------------------------
-- "Falta alocação" = a conta tem movimento e nem ela nem nenhum
-- ancestral dela tem linha_demonstracao. É a herança do plano
-- resolvida no banco (a alocação mais específica vence).
CREATE OR REPLACE FUNCTION public.plano_pendencias(_company_id uuid, _limite int DEFAULT 500)
RETURNS TABLE (
  codigo text,
  classificacao text,
  descricao text,
  tipo text,
  is_sintetica boolean,
  movimento numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid; _scope uuid; _sep text;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RETURN;
  END IF;
  SELECT e.tenant_id, e.company_scope, e.separador
    INTO _tenant, _scope, _sep
    FROM public.plano_escopo(_company_id) e;
  IF _tenant IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH mov AS (
    SELECT s.conta_codigo, sum(s.movimento) AS movimento
      FROM public.saldos_mensais s
     WHERE s.company_id = _company_id
     GROUP BY s.conta_codigo
  )
  SELECT p.codigo, p.classificacao, p.descricao, p.tipo, p.is_sintetica, m.movimento
    FROM mov m
    JOIN public.plano_contas p
      ON p.tenant_id = _tenant
     AND p.company_id IS NOT DISTINCT FROM _scope
     AND p.codigo = m.conta_codigo
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.plano_contas a
      WHERE a.tenant_id = _tenant
        AND a.company_id IS NOT DISTINCT FROM _scope
        AND a.linha_demonstracao IS NOT NULL
        AND (
          p.classificacao = a.classificacao
          OR left(p.classificacao, length(a.classificacao) + length(_sep))
             = a.classificacao || _sep
        )
   )
   ORDER BY abs(m.movimento) DESC
   LIMIT GREATEST(_limite, 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.plano_pendencias(uuid, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.plano_pendencias(uuid, int) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) Resumo de cobertura — alimenta o badge "faltam N alocações"
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.plano_cobertura(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid; _scope uuid; _sep text;
  _com_mov int := 0; _pendentes int := 0;
  _mov_total numeric := 0; _mov_pendente numeric := 0;
  _sem_dfc int := 0;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RETURN jsonb_build_object('autorizado', false);
  END IF;
  SELECT e.tenant_id, e.company_scope, e.separador
    INTO _tenant, _scope, _sep
    FROM public.plano_escopo(_company_id) e;
  IF _tenant IS NULL THEN
    RETURN jsonb_build_object('autorizado', true, 'contas_com_movimento', 0);
  END IF;

  WITH mov AS (
    SELECT s.conta_codigo, sum(s.movimento) AS movimento
      FROM public.saldos_mensais s
     WHERE s.company_id = _company_id
     GROUP BY s.conta_codigo
  ),
  j AS (
    SELECT p.codigo, p.classificacao, p.tipo, p.is_sintetica, m.movimento,
           EXISTS (
             SELECT 1 FROM public.plano_contas a
              WHERE a.tenant_id = _tenant
                AND a.company_id IS NOT DISTINCT FROM _scope
                AND a.linha_demonstracao IS NOT NULL
                AND (
                  p.classificacao = a.classificacao
                  OR left(p.classificacao, length(a.classificacao) + length(_sep))
                     = a.classificacao || _sep
                )
           ) AS alocada
      FROM mov m
      JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _scope
       AND p.codigo = m.conta_codigo
  )
  SELECT count(*),
         count(*) FILTER (WHERE NOT alocada),
         COALESCE(sum(abs(movimento)), 0),
         COALESCE(sum(abs(movimento)) FILTER (WHERE NOT alocada), 0)
    INTO _com_mov, _pendentes, _mov_total, _mov_pendente
    FROM j;

  -- Contas analíticas de Ativo/Passivo com movimento e sem flag de DFC:
  -- essas somem do fluxo de caixa sem avisar e quebram a identidade
  -- "variação de caixa = operacional + investimento + financiamento",
  -- então contam como pendência. Contas marcadas como não-caixa
  -- (contrapartida de depreciação etc.) NÃO são pendência: elas estão
  -- conscientemente fora dos blocos.
  SELECT count(*) INTO _sem_dfc
    FROM (
      SELECT DISTINCT s.conta_codigo FROM public.saldos_mensais s WHERE s.company_id = _company_id
    ) m
    JOIN public.plano_contas p
      ON p.tenant_id = _tenant
     AND p.company_id IS NOT DISTINCT FROM _scope
     AND p.codigo = m.conta_codigo
   WHERE p.is_sintetica = false
     AND p.dfc_atividade IS NULL
     AND p.dfc_nao_caixa = false
     AND p.tipo IN ('1-Ativo','2-Passivo','4-Cli. Nac.','5-For. Nac.','6-Cli. Ex.','7-For. Ex.');

  RETURN jsonb_build_object(
    'autorizado', true,
    'contas_com_movimento', _com_mov,
    'pendentes', _pendentes,
    'alocadas', _com_mov - _pendentes,
    'movimento_total', _mov_total,
    'movimento_pendente', _mov_pendente,
    'cobertura_percentual',
      CASE WHEN _mov_total = 0 THEN 100
           ELSE round(((_mov_total - _mov_pendente) / _mov_total) * 100, 2) END,
    'contas_sem_dfc', _sem_dfc
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.plano_cobertura(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.plano_cobertura(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5) Fila de DE-PARA (empresa com plano de terceiro)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.depara_pendencias(_company_id uuid, _limite int DEFAULT 500)
RETURNS TABLE (
  codigo text,
  classificacao text,
  descricao text,
  tipo text,
  movimento numeric,
  sugestao_codigo text,
  sugestao_descricao text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RETURN;
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;
  IF _tenant IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH mov AS (
    SELECT s.conta_codigo, sum(s.movimento) AS movimento
      FROM public.saldos_mensais s
     WHERE s.company_id = _company_id
     GROUP BY s.conta_codigo
  ),
  proprias AS (
    SELECT p.codigo, p.classificacao, p.descricao, p.tipo, m.movimento
      FROM mov m
      JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND p.company_id = _company_id
       AND p.codigo = m.conta_codigo
      LEFT JOIN public.depara_contas d
        ON d.company_id = _company_id AND d.conta_codigo = p.codigo
     WHERE d.id IS NULL
        OR (d.ignorada = false AND d.conta_padrao_codigo IS NULL)
  )
  SELECT pr.codigo, pr.classificacao, pr.descricao, pr.tipo, pr.movimento,
         sug.codigo, sug.descricao
    FROM proprias pr
    -- Sugestão automática: mesma classificação no Plano Padrão; se não
    -- houver, a conta padrão de descrição mais parecida dentro do mesmo tipo.
    LEFT JOIN LATERAL (
      SELECT pp.codigo, pp.descricao
        FROM public.plano_contas pp
       WHERE pp.tenant_id = _tenant
         AND pp.company_id IS NULL
         AND pp.is_sintetica = false
         AND pp.tipo = pr.tipo
       ORDER BY
         (pp.classificacao = pr.classificacao) DESC,
         similarity_simples(pp.descricao, pr.descricao) DESC
       LIMIT 1
    ) sug ON true
   ORDER BY abs(pr.movimento) DESC
   LIMIT GREATEST(_limite, 1);
END;
$$;

-- Similaridade sem depender da extensão pg_trgm (que pode não estar
-- habilitada no projeto): proporção de palavras em comum entre as
-- duas descrições. Suficiente para ordenar sugestões.
CREATE OR REPLACE FUNCTION public.similarity_simples(_a text, _b text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  WITH
  a AS (
    SELECT DISTINCT unnest(string_to_array(
      regexp_replace(lower(COALESCE(_a,'')), '[^a-z0-9 ]', ' ', 'g'), ' ')) AS w
  ),
  b AS (
    SELECT DISTINCT unnest(string_to_array(
      regexp_replace(lower(COALESCE(_b,'')), '[^a-z0-9 ]', ' ', 'g'), ' ')) AS w
  ),
  a2 AS (SELECT w FROM a WHERE length(w) > 2),
  b2 AS (SELECT w FROM b WHERE length(w) > 2)
  SELECT CASE
    WHEN (SELECT count(*) FROM a2) = 0 OR (SELECT count(*) FROM b2) = 0 THEN 0
    ELSE round(
      (SELECT count(*) FROM (SELECT w FROM a2 INTERSECT SELECT w FROM b2) i)::numeric
      / GREATEST((SELECT count(*) FROM a2), (SELECT count(*) FROM b2))::numeric, 4)
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.depara_pendencias(uuid, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.depara_pendencias(uuid, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.similarity_simples(text, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 6) Gravação do de-para em lote
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aplicar_depara_em_lote(_company_id uuid, _itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
  _n int := 0;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para configurar o de-para desta empresa';
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada';
  END IF;

  WITH entrada AS (
    SELECT DISTINCT ON (x.conta_codigo) x.*
      FROM jsonb_to_recordset(_itens) AS x(
        conta_codigo text,
        conta_padrao_codigo text,
        ignorada boolean,
        observacao text
      )
     WHERE x.conta_codigo IS NOT NULL
     ORDER BY x.conta_codigo
  ),
  gravadas AS (
    INSERT INTO public.depara_contas (
      tenant_id, company_id, conta_codigo, conta_padrao_codigo, ignorada, observacao
    )
    SELECT _tenant, _company_id, e.conta_codigo, e.conta_padrao_codigo,
           COALESCE(e.ignorada,false), e.observacao
      FROM entrada e
    ON CONFLICT (company_id, conta_codigo) DO UPDATE SET
      conta_padrao_codigo = EXCLUDED.conta_padrao_codigo,
      ignorada            = EXCLUDED.ignorada,
      observacao          = EXCLUDED.observacao,
      updated_at          = now()
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM gravadas;

  RETURN jsonb_build_object('gravadas', _n);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.aplicar_depara_em_lote(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.aplicar_depara_em_lote(uuid, jsonb) TO authenticated, service_role;
