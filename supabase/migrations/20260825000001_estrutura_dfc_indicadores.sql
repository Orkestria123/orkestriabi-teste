-- ============================================================
-- AJUSTE 15 — sintéticas faltantes, DFC por classificação
-- ============================================================

-- ------------------------------------------------------------
-- 1) Materializar as sintéticas que o plano não traz
--
-- O export do sistema contábil pula níveis: existe `3.17.01.01.01`
-- (CONTRIBUICAO SOCIAL) mas não existe `3.17.01`, nem `3.17`, nem `3`.
-- A demonstração é desenhada num nível — se o nível não existe naquele
-- ramo, as contas de baixo não casam com linha nenhuma e SOMEM: foi por
-- isso que IRPJ e CSLL não apareciam na DRE.
--
-- (O Lucro do Exercício continuava certo, porque é apurado do grupo
-- inteiro. Ou seja: a demonstração não fechava com ela mesma, e nada
-- avisava. Pior tipo de erro.)
--
-- Esta função cria os níveis que faltam. O nome vem, em ordem:
--   1. do acumulador do bloco (`.98` antes de `.99`) — é ele que batiza
--      o bloco no plano do escritório;
--   2. do único ramo abaixo, quando o bloco só tem um;
--   3. genérico.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._garantir_sinteticas_interno(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _separador text DEFAULT '.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _criadas int := 0; _total int := 0; _rodada int := 0;
BEGIN
  -- Repete até não faltar mais nada: um buraco pode ter vários níveis
  -- (falta 3, 3.17 e 3.17.01 ao mesmo tempo).
  LOOP
    _rodada := _rodada + 1;
    EXIT WHEN _rodada > 12;

    WITH existentes AS (
      SELECT DISTINCT p.classificacao
        FROM public.plano_contas p
       WHERE p.tenant_id = _tenant_id
         AND p.company_id IS NOT DISTINCT FROM _company_id
    ),
    -- todos os ancestrais implícitos de cada classificação
    ancestrais AS (
      SELECT DISTINCT
             array_to_string(
               (string_to_array(e.classificacao, _separador))[1:i], _separador) AS cls
        FROM existentes e
        CROSS JOIN LATERAL generate_series(
               1, array_length(string_to_array(e.classificacao, _separador), 1) - 1) AS i
    ),
    faltando AS (
      SELECT a.cls FROM ancestrais a
       WHERE a.cls <> ''
         AND NOT EXISTS (SELECT 1 FROM existentes e WHERE e.classificacao = a.cls)
    ),
    nomeada AS (
      SELECT f.cls,
             COALESCE(
               -- 1. acumulador do bloco: .98 tem precedência sobre .99
               (SELECT p.descricao FROM public.plano_contas p
                 WHERE p.tenant_id = _tenant_id
                   AND p.company_id IS NOT DISTINCT FROM _company_id
                   AND p.classificacao IN (f.cls || _separador || '98',
                                           f.cls || _separador || '99')
                 ORDER BY p.classificacao LIMIT 1),
               -- 2. o único nome no ramo mais raso abaixo
               (SELECT min(p.descricao) FROM public.plano_contas p
                 WHERE p.tenant_id = _tenant_id
                   AND p.company_id IS NOT DISTINCT FROM _company_id
                   AND left(p.classificacao, length(f.cls) + 1) = f.cls || _separador
                 HAVING count(DISTINCT p.descricao) = 1),
               'GRUPO ' || f.cls
             ) AS descricao,
             -- tipo e demais atributos herdados de um descendente
             (SELECT p.tipo FROM public.plano_contas p
               WHERE p.tenant_id = _tenant_id
                 AND p.company_id IS NOT DISTINCT FROM _company_id
                 AND left(p.classificacao, length(f.cls) + 1) = f.cls || _separador
               ORDER BY length(p.classificacao) LIMIT 1) AS tipo
        FROM faltando f
    ),
    ins AS (
      INSERT INTO public.plano_contas
        (tenant_id, company_id, codigo, classificacao, descricao, tipo, natureza,
         nivel, is_sintetica, is_participante, conta_pai_classificacao, ativo)
      SELECT _tenant_id, _company_id, 'S-' || n.cls, n.cls, n.descricao,
             COALESCE(n.tipo, '1-Ativo'), 'S',
             array_length(string_to_array(n.cls, _separador), 1),
             true, false,
             CASE WHEN position(_separador in n.cls) > 0
                  THEN left(n.cls, length(n.cls) - position(_separador in reverse(n.cls)))
                  ELSE NULL END,
             true
        FROM nomeada n
      ON CONFLICT (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo)
        DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO _criadas FROM ins;

    _total := _total + _criadas;
    EXIT WHEN _criadas = 0;
  END LOOP;

  RETURN jsonb_build_object('sinteticas_criadas', _total, 'rodadas', _rodada);
END;
$fn$;

-- Wrapper público, com a checagem de permissão.
--
-- A função interna existe sem checagem porque a migration precisa
-- chamá-la, e durante `db reset` não há sessão: `auth.uid()` é NULL e a
-- checagem barraria a semeadura em silêncio. Já aconteceu antes com os
-- marcos; desta vez o caminho vem separado desde o início.
CREATE OR REPLACE FUNCTION public.garantir_sinteticas_faltantes(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _separador text DEFAULT '.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $w$
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  RETURN public._garantir_sinteticas_interno(_tenant_id, _company_id, _separador);
END;
$w$;

REVOKE EXECUTE ON FUNCTION public._garantir_sinteticas_interno(uuid, uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text)
  TO authenticated, service_role;


-- ------------------------------------------------------------
-- 2) DFC vinculada por CLASSIFICAÇÃO, não conta a conta
--
-- Classificar "CLIENTES NACIONAIS" gravava o código em cada uma das
-- 113.101 contas abaixo dela — 113.101 linhas reescritas, cada uma
-- disparando um trigger que consultava o catálogo. Estourava o timeout
-- de 8 s do servidor e deixava a alocação pela metade. É a mesma lição
-- do de-para: vincula-se a CLASSE, não cada membro dela.
--
-- Agora o vínculo é uma linha por classificação. Classificar clientes
-- nacionais é UM insert. A conta resolve o código na leitura, pelo
-- prefixo mais longo — exatamente como a planilha já fazia.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dfc_vinculo (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  classificacao text NOT NULL,
  codigo_dfc text NOT NULL REFERENCES public.dfc_catalogo(codigo),
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('planilha','manual','conta')),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
-- company_id é NULL no Plano Padrão, e NULL não fecha chave primária —
-- mesma solução já usada em `plano_contas`.
CREATE UNIQUE INDEX IF NOT EXISTS dfc_vinculo_unico
  ON public.dfc_vinculo (tenant_id,
                         COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
                         classificacao);
CREATE INDEX IF NOT EXISTS idx_dfc_vinculo_escopo
  ON public.dfc_vinculo (tenant_id, company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dfc_vinculo TO authenticated;
GRANT ALL ON public.dfc_vinculo TO service_role;
ALTER TABLE public.dfc_vinculo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dfc_vinculo leitura" ON public.dfc_vinculo;
CREATE POLICY "dfc_vinculo leitura" ON public.dfc_vinculo
  FOR SELECT TO authenticated USING (public.get_my_tenant_id() = tenant_id OR public.is_orkestria_admin());
DROP POLICY IF EXISTS "dfc_vinculo escrita" ON public.dfc_vinculo;
CREATE POLICY "dfc_vinculo escrita" ON public.dfc_vinculo
  FOR ALL TO authenticated
  USING (public.pode_gerenciar_tenant(tenant_id))
  WITH CHECK (public.pode_gerenciar_tenant(tenant_id));

-- A planilha entra aqui como vínculo de origem 'planilha'.
INSERT INTO public.dfc_vinculo (tenant_id, company_id, classificacao, codigo_dfc, origem)
SELECT t.id, NULL, d.classificacao, d.codigo_dfc, 'planilha'
  FROM public.tenants t CROSS JOIN public.dfc_padrao d
ON CONFLICT (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), classificacao) DO NOTHING;

-- ------------------------------------------------------------
-- Vincular uma classificação (a sintética) — UMA linha.
-- ------------------------------------------------------------
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
DECLARE _abaixo bigint;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
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

  SELECT count(*) INTO _abaixo
    FROM public.plano_contas p
   WHERE p.tenant_id = _tenant_id
     AND p.company_id IS NOT DISTINCT FROM _company_id
     AND p.is_sintetica = false AND p.ativo
     AND left(p.classificacao, length(_classificacao) + 1) = _classificacao || '.';

  RETURN jsonb_build_object('contas_abrangidas', _abaixo);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.definir_dfc_classificacao(uuid, text, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.definir_dfc_classificacao(uuid, text, text, uuid)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- O mapa que o motor lê: prefixo -> código. Poucas dezenas de linhas,
-- em vez de um código por conta.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dfc_mapa(_company_id uuid)
RETURNS TABLE (classificacao text, codigo_dfc text, origem text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _tenant uuid; _scope uuid; _esc jsonb;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  _esc := public.escopo_plano_empresa(_company_id);
  _tenant := (_esc->>'tenant_id')::uuid;
  IF _tenant IS NULL THEN RETURN; END IF;
  _scope := CASE WHEN COALESCE((_esc->>'usa_plano_padrao')::boolean, false)
                 THEN NULL ELSE _company_id END;

  RETURN QUERY
  -- vínculo da empresa tem precedência sobre o do escritório
  SELECT * FROM (
    SELECT DISTINCT ON (v.classificacao) v.classificacao, v.codigo_dfc, v.origem
      FROM public.dfc_vinculo v
     WHERE v.tenant_id = _tenant
       AND (v.company_id IS NULL OR v.company_id = _scope)
     ORDER BY v.classificacao, (v.company_id IS NOT NULL) DESC
  ) vin
  UNION ALL
  -- override em conta específica continua valendo
  SELECT p.classificacao, p.dfc_codigo, 'conta'
    FROM public.plano_contas p
   WHERE p.tenant_id = _tenant
     AND p.company_id IS NOT DISTINCT FROM _scope
     AND p.dfc_codigo IS NOT NULL
     AND p.ativo
     AND NOT EXISTS (
       SELECT 1 FROM public.dfc_vinculo v2
        WHERE v2.tenant_id = _tenant AND v2.classificacao = p.classificacao
          AND v2.company_id IS NOT DISTINCT FROM NULL);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_mapa(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_mapa(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Cobertura e pendências, agora resolvidas pelo mapa (sem tocar em
-- 135.000 linhas).
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

  WITH conta AS (
    SELECT p.classificacao, p.is_sintetica, left(p.classificacao, 1) AS grupo,
           EXISTS (
             SELECT 1 FROM public.dfc_vinculo v
              WHERE v.tenant_id = _tenant_id
                AND v.company_id IS NOT DISTINCT FROM _company_id
                AND (p.classificacao = v.classificacao
                     OR left(p.classificacao, length(v.classificacao) + 1)
                        = v.classificacao || '.')
           ) OR p.dfc_codigo IS NOT NULL AS tem_codigo
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM _company_id
       AND p.ativo
  )
  SELECT jsonb_build_object(
           'analiticas_balanco', count(*) FILTER (WHERE NOT is_sintetica AND grupo IN ('1','2')),
           'sem_codigo',         count(*) FILTER (WHERE NOT is_sintetica AND grupo IN ('1','2') AND NOT tem_codigo),
           'vinculos',           (SELECT count(*) FROM public.dfc_vinculo v
                                   WHERE v.tenant_id = _tenant_id
                                     AND v.company_id IS NOT DISTINCT FROM _company_id),
           'total_plano',        count(*)
         )
    INTO _r FROM conta;
  RETURN _r;
END;
$fn$;

-- Sintéticas que ainda mandam em analíticas sem classificação, pelo mapa.
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
           p.dfc_codigo, p.conta_pai_classificacao,
           EXISTS (
             SELECT 1 FROM public.dfc_vinculo v
              WHERE v.tenant_id = _tenant_id
                AND v.company_id IS NOT DISTINCT FROM _company_id
                AND (p.classificacao = v.classificacao
                     OR left(p.classificacao, length(v.classificacao) + 1)
                        = v.classificacao || '.')
           ) OR p.dfc_codigo IS NOT NULL AS tem_codigo
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM _company_id
       AND p.ativo
  ),
  pendentes AS (
    SELECT e.conta_pai_classificacao AS pai,
           count(*) FILTER (WHERE NOT e.tem_codigo) AS sem,
           count(*) AS tot
      FROM escopo e
     WHERE NOT e.is_sintetica
       AND left(e.classificacao, 1) IN ('1', '2')
       AND e.conta_pai_classificacao IS NOT NULL
     GROUP BY e.conta_pai_classificacao
  )
  SELECT s.classificacao, s.descricao, s.tipo, s.nivel,
         (SELECT v.codigo_dfc FROM public.dfc_vinculo v
           WHERE v.tenant_id = _tenant_id
             AND v.company_id IS NOT DISTINCT FROM _company_id
             AND v.classificacao = s.classificacao),
         p.sem, p.tot
    FROM pendentes p
    JOIN escopo s ON s.classificacao = p.pai AND s.is_sintetica
   WHERE p.sem > 0
   ORDER BY p.sem DESC, s.classificacao
   LIMIT _limite;
END;
$fn$;

-- Analíticas pendentes pelo mapa.
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
     AND NOT EXISTS (
       SELECT 1 FROM public.dfc_vinculo v
        WHERE v.tenant_id = _tenant_id
          AND v.company_id IS NOT DISTINCT FROM _company_id
          AND (p.classificacao = v.classificacao
               OR left(p.classificacao, length(v.classificacao) + 1) = v.classificacao || '.'))
     AND (_busca IS NULL OR _busca = ''
          OR p.codigo ILIKE '%' || _busca || '%'
          OR p.classificacao ILIKE _busca || '%'
          OR p.descricao ILIKE '%' || _busca || '%')
   ORDER BY p.classificacao, p.codigo
   LIMIT _limite;
END;
$fn$;

-- ------------------------------------------------------------
-- 3) Aplica agora: sintéticas faltantes em todos os escopos.
-- ------------------------------------------------------------
DO $aplica$
DECLARE r record; _res jsonb; _tot int := 0;
BEGIN
  FOR r IN SELECT DISTINCT tenant_id, company_id FROM public.plano_contas LOOP
    _res := public._garantir_sinteticas_interno(r.tenant_id, r.company_id, '.');
    _tot := _tot + COALESCE((_res->>'sinteticas_criadas')::int, 0);
  END LOOP;
  RAISE NOTICE 'Sintéticas materializadas: %', _tot;
END;
$aplica$;

ANALYZE public.plano_contas;

-- ------------------------------------------------------------
-- 4) Reaplicar a planilha — agora é uma linha por classificação
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revincular_dfc(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _todos_escopos boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _n int := 0; _cob jsonb;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  -- descarta o que veio da planilha antes (mantém o que foi feito à mão)
  DELETE FROM public.dfc_vinculo
   WHERE tenant_id = _tenant_id
     AND company_id IS NOT DISTINCT FROM _company_id
     AND origem = 'planilha';

  INSERT INTO public.dfc_vinculo (tenant_id, company_id, classificacao, codigo_dfc, origem)
  SELECT _tenant_id, _company_id, d.classificacao, d.codigo_dfc, 'planilha'
    FROM public.dfc_padrao d
  ON CONFLICT (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), classificacao)
    DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;

  _cob := public.dfc_cobertura(_tenant_id, _company_id);
  RETURN jsonb_build_object(
    'vinculos_da_planilha', _n,
    'analiticas_balanco', _cob->'analiticas_balanco',
    'sem_codigo', _cob->'sem_codigo');
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.revincular_dfc(uuid, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.revincular_dfc(uuid, uuid, boolean) TO authenticated, service_role;

-- `herdar_dfc_da_sintetica` deixa de ser necessária: a herança acontece
-- na leitura, pelo prefixo mais longo do mapa. Fica como no-op informativa
-- para não quebrar chamada antiga.
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
DECLARE _cob jsonb;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  _cob := public.dfc_cobertura(_tenant_id, _company_id);
  RETURN jsonb_build_object('herdadas', 0,
    'analiticas_sem_codigo', _cob->'sem_codigo',
    'nota', 'a herança da sintética agora é automática na leitura');
END;
$fn$;

-- ------------------------------------------------------------
-- 5) `indicador_snapshot` passa a respeitar escopo e de-para
--
-- Os indicadores liam o plano da empresa E o do escritório juntos, e os
-- saldos com o código de ORIGEM. Numa empresa de plano de terceiro isso
-- significava saldo classificado como "1.1" tentando casar com a
-- estrutura do Padrão ("1.01"): TODOS os indicadores davam zero. As
-- demonstrações funcionavam (a tradução foi ligada no motor), os
-- indicadores não — eram outro caminho de leitura, e ninguém tinha
-- conferido.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.indicador_snapshot(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant_id uuid; _plano jsonb; _saldos jsonb; _aberturas jsonb;
  _my_tenant uuid; _my_company uuid; _esc jsonb; _scope uuid; _usa_depara boolean;
BEGIN
  SELECT tenant_id INTO _tenant_id FROM public.companies WHERE id = _company_id;
  IF _tenant_id IS NULL THEN
    RETURN jsonb_build_object('plano','[]'::jsonb,'saldos','[]'::jsonb,'aberturas','[]'::jsonb);
  END IF;

  IF NOT public.is_orkestria_admin() THEN
    _my_tenant := public.get_my_tenant_id();
    _my_company := public.get_my_company_id();
    IF _my_tenant IS DISTINCT FROM _tenant_id
       OR (_my_company IS NOT NULL AND _my_company IS DISTINCT FROM _company_id) THEN
      RETURN jsonb_build_object('plano','[]'::jsonb,'saldos','[]'::jsonb,'aberturas','[]'::jsonb);
    END IF;
  END IF;

  _esc := public.escopo_plano_empresa(_company_id);
  _usa_depara := COALESCE((_esc->>'usa_depara')::boolean, false);
  _scope := CASE WHEN COALESCE((_esc->>'usa_plano_padrao')::boolean, false)
                 THEN NULL ELSE _company_id END;

  -- Saldos e aberturas com o código já traduzido para o escopo lido.
  WITH trad AS (
    SELECT t.conta_codigo, t.conta_padrao_codigo
      FROM public.depara_traducao(_company_id) t
     WHERE _usa_depara AND NOT t.ignorada AND t.conta_padrao_codigo IS NOT NULL
  )
  SELECT jsonb_agg(jsonb_build_object(
           'conta_codigo', x.cod,
           'competencia', to_char(x.competencia, 'YYYY-MM-DD'),
           'total_debitos', x.total_debitos,
           'total_creditos', x.total_creditos))
    INTO _saldos
    FROM (
      SELECT COALESCE(tr.conta_padrao_codigo, sm.conta_codigo) AS cod,
             sm.competencia, sm.total_debitos, sm.total_creditos
        FROM public.saldos_mensais sm
        LEFT JOIN trad tr ON tr.conta_codigo = sm.conta_codigo
       WHERE sm.company_id = _company_id
    ) x;

  WITH trad AS (
    SELECT t.conta_codigo, t.conta_padrao_codigo
      FROM public.depara_traducao(_company_id) t
     WHERE _usa_depara AND NOT t.ignorada AND t.conta_padrao_codigo IS NOT NULL
  )
  SELECT jsonb_agg(jsonb_build_object(
           'conta_codigo', x.cod,
           'data_referencia', to_char(x.data_referencia, 'YYYY-MM-DD'),
           'saldo', x.saldo))
    INTO _aberturas
    FROM (
      SELECT COALESCE(tr.conta_padrao_codigo, sa.conta_codigo) AS cod,
             sa.data_referencia, sa.saldo
        FROM public.saldos_abertura sa
        LEFT JOIN trad tr ON tr.conta_codigo = sa.conta_codigo
       WHERE sa.company_id = _company_id
    ) x;

  -- Plano: SÓ o do escopo efetivo. Trazer os dois (empresa + escritório)
  -- criava classificações concorrentes para o mesmo código, e numa
  -- empresa de plano de terceiro TODOS os indicadores davam zero.
  WITH codigos_movimento AS (
    SELECT DISTINCT COALESCE(v->>'conta_codigo', '') AS cod
      FROM jsonb_array_elements(COALESCE(_saldos, '[]'::jsonb)) v
    UNION
    SELECT DISTINCT COALESCE(v->>'conta_codigo', '')
      FROM jsonb_array_elements(COALESCE(_aberturas, '[]'::jsonb)) v
  ),
  filtrado AS (
    SELECT p.codigo, p.classificacao, p.descricao, p.natureza, p.is_sintetica, p.is_participante
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM _scope
       AND (p.is_participante = false
            OR p.codigo IN (SELECT cod FROM codigos_movimento))
  )
  SELECT jsonb_agg(row_to_json(filtrado)) INTO _plano FROM filtrado;

  RETURN jsonb_build_object(
    'plano', COALESCE(_plano, '[]'::jsonb),
    'saldos', COALESCE(_saldos, '[]'::jsonb),
    'aberturas', COALESCE(_aberturas, '[]'::jsonb));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.indicador_snapshot(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.indicador_snapshot(uuid) TO authenticated, service_role;
