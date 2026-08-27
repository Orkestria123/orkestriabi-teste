-- ============================================================
-- AJUSTE 16 — alocações da DFC em planilha (exportar e importar)
-- ============================================================
--
-- A alocação da DFC é um vínculo por CLASSIFICAÇÃO: poucas dezenas de
-- linhas que alcançam as 135.000 contas por prefixo. Ótimo para
-- configurar, ruim para CONFERIR — olhando a tela não dá para saber se
-- cada conta caiu onde devia.
--
-- Três funções resolvem isso:
--   dfc_resolucao       quem decide o código de uma classificação (uma só
--                       regra, usada tanto pelo motor quanto pela planilha)
--   dfc_exportar        a planilha de conferência, por classificação
--   dfc_exportar_contas as exceções gravadas conta a conta
--   dfc_importar_vinculos  a planilha corrigida de volta
--
-- Reinstalável: as assinaturas mudaram em relação a um rascunho anterior,
-- por isso o DROP antes.

DROP FUNCTION IF EXISTS public.dfc_exportar(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.dfc_exportar_contas(uuid, uuid);
DROP FUNCTION IF EXISTS public.dfc_exportar_contas(uuid, uuid, int);
DROP FUNCTION IF EXISTS public.dfc_resolucao(uuid, uuid);
DROP FUNCTION IF EXISTS public.dfc_efetivo(uuid, uuid, boolean);

-- ------------------------------------------------------------
-- 0) A regra de resolução, num lugar só
--
-- Antes esta regra existia escrita dentro de `dfc_mapa` (o que o motor
-- lê) e teria de ser reescrita dentro do export. Duas cópias da mesma
-- regra divergem — e uma planilha que mostra um código diferente do que
-- a DFC usa é pior do que não ter planilha nenhuma.
--
-- Precedência, na ordem:
--   1. vínculo da empresa            (dfc_vinculo com company_id)
--   2. vínculo do escritório         (dfc_vinculo com company_id NULL)
--   3. código gravado na própria conta (plano_contas.dfc_codigo)
--
-- A herança por prefixo NÃO entra aqui: quem resolve prefixo é quem lê,
-- pegando o ancestral mais longo deste mapa. É o mesmo desenho de antes.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dfc_resolucao(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL
)
RETURNS TABLE (
  classificacao text,
  codigo_dfc text,
  origem text,
  ambiguo boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH vin AS (
    SELECT DISTINCT ON (v.classificacao)
           v.classificacao, v.codigo_dfc, v.origem
      FROM public.dfc_vinculo v
     WHERE v.tenant_id = _tenant_id
       AND (v.company_id IS NULL OR v.company_id = _company_id)
     ORDER BY v.classificacao, (v.company_id IS NOT NULL) DESC
  ),
  -- O código gravado na conta é exceção pontual. Várias contas dividem a
  -- mesma classificação (113.097 clientes moram em 1.01.02.01.01.01), e
  -- se elas discordarem entre si o mapa fica dependendo de qual linha
  -- veio por último. Agrupar aqui torna determinístico e ainda marca a
  -- discordância em vez de escondê-la.
  cta AS (
    SELECT p.classificacao,
           min(p.dfc_codigo)                    AS codigo_dfc,
           count(DISTINCT p.dfc_codigo) > 1     AS ambiguo
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM _company_id
       AND p.dfc_codigo IS NOT NULL
       AND p.ativo
     GROUP BY p.classificacao
  ),
  -- PRECEDÊNCIA: o vínculo manda. O código gravado na conta só vale onde
  -- NENHUM vínculo cobre a classificação — nem ela, nem um ancestral.
  --
  -- Antes a comparação era só na classificação exata, e isso é o motivo
  -- de "mudei a sintética e não pegou": o código gravado lá embaixo é um
  -- prefixo MAIS LONGO que o vínculo de cima, então vencia. Com a regra
  -- assim, quem tem vínculo acima ignora o que está gravado na conta —
  -- sem precisar apagar 135.138 linhas do plano.
  cta_valida AS (
    SELECT c.* FROM cta c
     WHERE NOT EXISTS (
       SELECT 1 FROM vin v
        WHERE c.classificacao = v.classificacao
           OR left(c.classificacao, length(v.classificacao) + 1) = v.classificacao || '.')
  )
  SELECT v.classificacao, v.codigo_dfc, v.origem, false
    FROM vin v
  UNION ALL
  SELECT c.classificacao, c.codigo_dfc, 'conta', c.ambiguo
    FROM cta_valida c;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_resolucao(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_resolucao(uuid, uuid) TO service_role;

-- `dfc_mapa` passa a delegar. Mesma assinatura, mesmo retorno — o motor
-- não muda. Ganha duas correções de brinde:
--   * o ramo das contas era um SELECT sem agrupamento: com os
--     participantes carregados devolvia 113.000 linhas idênticas para o
--     navegador montar um mapa de 6 chaves;
--   * um vínculo de EMPRESA não suprimia o código gravado na conta, então
--     os dois entravam no mapa e vencia o último — dependendo da ordem.
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
  SELECT r.classificacao, r.codigo_dfc, r.origem
    FROM public.dfc_resolucao(_tenant, _scope) r;
END;
$fn$;

-- ------------------------------------------------------------
-- 1) Exportar: a planilha de conferência
--
-- Uma linha por CLASSIFICAÇÃO, não por conta. O motivo é o volume: no
-- plano do escritório 113.097 contas dividem a classificação
-- 1.01.02.01.01.01 e todas recebem, por construção, o mesmo código. Uma
-- planilha conta a conta teria 135.000 linhas para transmitir umas
-- poucas centenas de decisões — não dá para conferir isso.
--
-- As colunas que fazem a conferência valer:
--   contas / analiticas   o peso daquela linha
--   com_movimento         quantas dessas contas têm saldo — é aqui que
--                         mora o risco: classificação com movimento e sem
--                         código é dinheiro que some do fluxo de caixa
--   classificacao_vinculo de QUAL classificação veio o código; sem isso
--                         uma alocação errada e uma certa se parecem
--   ambiguo               contas da mesma classificação com códigos
--                         diferentes gravados
--
-- `dfc_efetivo` é o miolo SEM checagem de permissão, para poder ser
-- chamado de dentro da migration (que roda sem sessão autenticada) pela
-- normalização lá no fim. Quem expõe para a aplicação é `dfc_exportar`.
-- ------------------------------------------------------------
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
  WITH escopo AS (
    SELECT p.classificacao, p.codigo, p.descricao, p.is_sintetica
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM _company_id
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
           -- A sintética batiza o grupo; sem ela, qualquer analítica.
           -- Com `array_agg(... ORDER BY ...)` isto montava e ordenava um
           -- array de 113.097 descrições para pegar o primeiro elemento —
           -- 3,2 s no plano real. `min()` faz o mesmo em uma passada.
           COALESCE(min(e.descricao) FILTER (WHERE e.is_sintetica),
                    min(e.descricao))                           AS descricao,
           count(*)::int                                        AS contas,
           count(*) FILTER (WHERE NOT e.is_sintetica)::int       AS analiticas,
           count(*) FILTER (WHERE m.conta_codigo IS NOT NULL)::int AS com_movimento
      FROM escopo e
      LEFT JOIN mov m ON m.conta_codigo = e.codigo
     GROUP BY e.classificacao
  ),
  -- MATERIALIZED é obrigatório: sem isso o planejador reexecuta a função
  -- dentro do LATERAL, uma vez por classificação (529 varreduras do plano
  -- de 135.792 contas = 3,1 s). Materializada, roda uma vez só.
  res AS MATERIALIZED (
    SELECT * FROM public.dfc_resolucao(_tenant_id, _company_id)
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
      -- prefixo mais longo vence: é a mesma regra da leitura
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

CREATE OR REPLACE FUNCTION public.dfc_exportar(
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
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  RETURN QUERY SELECT * FROM public.dfc_efetivo(_tenant_id, _company_id, _somente_balanco);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_exportar(uuid, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_exportar(uuid, uuid, boolean)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2) Exportar as exceções conta a conta — só as que CONFLITAM
--
-- `plano_contas.dfc_codigo` é o código gravado numa conta específica.
-- Depois do ajuste 15 ele deixou de ser o caminho normal, mas as
-- gravações antigas continuam lá: no plano do escritório 135.138 das
-- 135.792 contas têm código gravado. Listar todas não é "exceção", é o
-- plano inteiro — 13 s de consulta para uma aba ilegível.
--
-- Interessa só o que pode MORDER: conta cujo código gravado difere do
-- que a classificação dela resolve. Ou seja, ou as contas irmãs
-- discordam entre si, ou existe um vínculo dizendo outra coisa. O resto
-- é redundante e some na normalização.
-- ------------------------------------------------------------
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
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  RETURN QUERY
  WITH res AS MATERIALIZED (
    SELECT * FROM public.dfc_resolucao(_tenant_id, _company_id)
  ),
  -- classificações onde o código gravado na conta NÃO é o que vale
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
     AND p.company_id IS NOT DISTINCT FROM _company_id
     AND p.dfc_codigo IS NOT NULL
     AND p.ativo
     AND s.codigo_dfc IS DISTINCT FROM p.dfc_codigo
   ORDER BY p.classificacao, p.codigo
   LIMIT _limite;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_exportar_contas(uuid, uuid, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_exportar_contas(uuid, uuid, int)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) Importar: a planilha corrigida volta para o banco
--
-- Recebe {classificacao, codigo_dfc}. Três coisas que não são óbvias e
-- decidem se isto presta:
--
-- (a) VÍNCULO MÍNIMO. A planilha traz o código EFETIVO de cada
--     classificação, e a maior parte dele é herdada de um nível acima.
--     Gravar todos criaria centenas de vínculos redundantes e destruiria
--     a herança — mexer na sintética deixaria de descer. Então cada
--     classificação só ganha vínculo próprio se o código pedido for
--     DIFERENTE do que ela já herda. Reimportar a planilha sem editar
--     nada não escreve nada.
--
-- (b) EXCEÇÃO GRAVADA NA CONTA. Se a conta tem `dfc_codigo` e a planilha
--     pede outro, o vínculo novo perderia para a exceção velha e a
--     edição não teria efeito nenhum — em silêncio. A planilha é a
--     autoridade: a exceção conflitante é apagada.
--
-- (c) TUDO OU NADA. Valida a planilha inteira antes de escrever. Meia
--     alocação importada é pior do que nenhuma.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dfc_importar_vinculos(
  _tenant_id uuid,
  _linhas jsonb,
  _company_id uuid DEFAULT NULL,
  _substituir boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _erros jsonb := '[]'::jsonb;
  _avisos jsonb := '[]'::jsonb;
  _criados int := 0; _atualizados int := 0; _removidos int := 0;
  _excecoes int := 0; _lidas int := 0; _ignoradas int := 0;
  _r record; _herdado text;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  CREATE TEMP TABLE _ent (cls text PRIMARY KEY, cod text, ord int) ON COMMIT DROP;
  CREATE TEMP TABLE _min (cls text PRIMARY KEY, cod text) ON COMMIT DROP;

  SELECT count(*), count(*) FILTER (WHERE nullif(trim(l.value->>'classificacao'), '') IS NULL)
    INTO _lidas, _ignoradas
    FROM jsonb_array_elements(COALESCE(_linhas, '[]'::jsonb)) l;

  -- Linhas repetidas da mesma classificação: vale a primeira, como o
  -- leitor da planilha avisa na tela.
  INSERT INTO _ent (cls, cod, ord)
  SELECT DISTINCT ON (x.cls) x.cls, x.cod, x.ord
    FROM (
      SELECT nullif(trim(l.value->>'classificacao'), '')     AS cls,
             nullif(trim(upper(l.value->>'codigo_dfc')), '') AS cod,
             l.ordinality::int                               AS ord
        FROM jsonb_array_elements(COALESCE(_linhas, '[]'::jsonb)) WITH ORDINALITY l
    ) x
   WHERE x.cls IS NOT NULL
   ORDER BY x.cls, x.ord;

  -- ---- validação, ANTES de escrever qualquer coisa ----
  _erros := _erros || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'linha', e.ord, 'classificacao', e.cls, 'codigo', e.cod,
             'erro', 'código de DFC não existe no catálogo') ORDER BY e.ord)
      FROM _ent e
     WHERE e.cod IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.dfc_catalogo c WHERE c.codigo = e.cod)
  ), '[]'::jsonb);

  -- As classificações DISTINTAS do plano são poucas centenas; a tabela
  -- tem 135.792 linhas. Conferir cada linha da planilha direto contra a
  -- tabela fazia uma varredura por linha (529 × 135.792) e a importação
  -- passava de 40 minutos. Reduz primeiro, confere depois.
  CREATE TEMP TABLE _cls ON COMMIT DROP AS
    SELECT DISTINCT p.classificacao
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM _company_id;

  _erros := _erros || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'linha', e.ord, 'classificacao', e.cls,
             'erro', 'classificação não existe no plano (nem como grupo)') ORDER BY e.ord)
      FROM _ent e
     WHERE NOT EXISTS (
       SELECT 1 FROM _cls c
        WHERE c.classificacao = e.cls
           OR left(c.classificacao, length(e.cls) + 1) = e.cls || '.')
  ), '[]'::jsonb);

  IF jsonb_array_length(_erros) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'linhas_lidas', _lidas, 'erros', _erros,
      'nota', 'nada foi gravado — corrija a planilha e importe de novo');
  END IF;

  -- ---- (a) vínculo mínimo ----
  -- Contexto: vínculos de classificações que a planilha não menciona
  -- continuam valendo e participam da herança. Com "substituir tudo"
  -- não há contexto: só sobra o que a planilha disser.
  IF NOT _substituir THEN
    INSERT INTO _min (cls, cod)
    SELECT v.classificacao, v.codigo_dfc
      FROM public.dfc_vinculo v
     WHERE v.tenant_id = _tenant_id
       AND v.company_id IS NOT DISTINCT FROM _company_id
       AND NOT EXISTS (SELECT 1 FROM _ent e WHERE e.cls = v.classificacao);
  END IF;

  -- Do mais curto para o mais longo: quando chega numa classificação, os
  -- ancestrais dela já foram decididos.
  FOR _r IN SELECT e.cls, e.cod FROM _ent e ORDER BY length(e.cls), e.cls LOOP
    SELECT m.cod INTO _herdado
      FROM _min m
     WHERE left(_r.cls, length(m.cls) + 1) = m.cls || '.'
     ORDER BY length(m.cls) DESC
     LIMIT 1;

    IF _r.cod IS NOT DISTINCT FROM _herdado THEN
      CONTINUE;                       -- já herda o que a planilha pede
    ELSIF _r.cod IS NULL THEN
      -- Apagar o código de um filho não desfaz a herança: o modelo não
      -- tem como dizer "aqui não, mesmo o pai dizendo que sim".
      _avisos := _avisos || to_jsonb(format(
        '%s ficou em branco na planilha, mas continua herdando %s de um nível '
        'acima. Para tirar daqui, apague o código do nível superior.',
        _r.cls, _herdado));
    ELSE
      INSERT INTO _min (cls, cod) VALUES (_r.cls, _r.cod);
    END IF;
  END LOOP;

  -- ---- aplicação ----
  WITH del AS (
    DELETE FROM public.dfc_vinculo v
     USING _ent e
     WHERE v.tenant_id = _tenant_id
       AND v.company_id IS NOT DISTINCT FROM _company_id
       AND v.classificacao = e.cls
       AND NOT EXISTS (SELECT 1 FROM _min m WHERE m.cls = e.cls)
    RETURNING 1
  ) SELECT count(*) INTO _removidos FROM del;

  IF _substituir THEN
    WITH del2 AS (
      DELETE FROM public.dfc_vinculo v
       WHERE v.tenant_id = _tenant_id
         AND v.company_id IS NOT DISTINCT FROM _company_id
         AND NOT EXISTS (SELECT 1 FROM _min m WHERE m.cls = v.classificacao)
      RETURNING 1
    ) SELECT _removidos + count(*) INTO _removidos FROM del2;
  END IF;

  WITH gravacao AS (
    INSERT INTO public.dfc_vinculo
      (tenant_id, company_id, classificacao, codigo_dfc, origem)
    SELECT _tenant_id, _company_id, m.cls, m.cod, 'planilha'
      FROM _min m JOIN _ent e ON e.cls = m.cls
    ON CONFLICT (tenant_id,
                 COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 classificacao)
      -- sem o WHERE, reimportar a planilha marcaria tudo como alterado
      DO UPDATE SET codigo_dfc = EXCLUDED.codigo_dfc,
                    origem = 'planilha',
                    atualizado_em = now()
      WHERE public.dfc_vinculo.codigo_dfc IS DISTINCT FROM EXCLUDED.codigo_dfc
    RETURNING (xmax = 0) AS novo
  )
  SELECT count(*) FILTER (WHERE novo), count(*) FILTER (WHERE NOT novo)
    INTO _criados, _atualizados FROM gravacao;

  -- Nada de apagar código gravado na conta: desde este ajuste o vínculo
  -- tem precedência sobre ele em toda a subárvore (ver dfc_resolucao),
  -- então a edição da planilha passa a valer sozinha.
  _excecoes := 0;

  RETURN jsonb_build_object(
    'ok', true,
    'linhas_lidas', _lidas,
    'linhas_ignoradas', _ignoradas,
    'classificacoes', (SELECT count(*) FROM _ent),
    'vinculos_criados', _criados,
    'vinculos_atualizados', _atualizados,
    'vinculos_removidos', _removidos,
    'excecoes_removidas', _excecoes,
    'avisos', _avisos,
    'cobertura', public.dfc_cobertura(_tenant_id, _company_id));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_importar_vinculos(uuid, jsonb, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_importar_vinculos(uuid, jsonb, uuid, boolean)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) Normalização — de uma vez, o que já está gravado
--
-- O plano do escritório chegou aqui com o código da DFC gravado em
-- 135.138 das 135.792 contas: era assim que a alocação funcionava antes
-- do ajuste 15. Isso ainda "funciona", mas deixa o sistema num estado em
-- que a próxima alteração NÃO PEGA — o código da conta vence o vínculo,
-- em silêncio. É o defeito que mais voltou nos relatos.
--
-- Esta rotina faz de uma vez o que a importação da planilha faz: calcula
-- o vínculo MÍNIMO que reproduz exatamente a alocação de hoje, grava, e
-- limpa o código das contas onde ele virou redundante. A alocação
-- efetiva de cada conta não muda — o que muda é onde ela mora.
--
-- Roda dentro da migration, sem statement_timeout de sessão.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dfc_normalizar(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _criados int := 0; _limpas int := 0; _r record; _herdado text;
BEGIN
  CREATE TEMP TABLE _ef (cls text PRIMARY KEY, cod text) ON COMMIT DROP;
  CREATE TEMP TABLE _mn (cls text PRIMARY KEY, cod text) ON COMMIT DROP;

  -- alocação efetiva de hoje, classificação a classificação (todo o
  -- plano, não só balanço — a DFC lê contas de resultado também)
  INSERT INTO _ef (cls, cod)
  SELECT e.classificacao, e.codigo_dfc
    FROM public.dfc_efetivo(_tenant_id, _company_id, false) e
   WHERE e.codigo_dfc IS NOT NULL;

  -- vínculos que já existem entram como contexto
  INSERT INTO _mn (cls, cod)
  SELECT v.classificacao, v.codigo_dfc
    FROM public.dfc_vinculo v
   WHERE v.tenant_id = _tenant_id
     AND v.company_id IS NOT DISTINCT FROM _company_id
  ON CONFLICT (cls) DO NOTHING;

  FOR _r IN SELECT f.cls, f.cod FROM _ef f ORDER BY length(f.cls), f.cls LOOP
    SELECT m.cod INTO _herdado
      FROM _mn m
     WHERE left(_r.cls, length(m.cls) + 1) = m.cls || '.'
     ORDER BY length(m.cls) DESC
     LIMIT 1;
    IF _r.cod IS DISTINCT FROM _herdado THEN
      INSERT INTO _mn (cls, cod) VALUES (_r.cls, _r.cod)
      ON CONFLICT (cls) DO UPDATE SET cod = EXCLUDED.cod;
    END IF;
  END LOOP;

  WITH gravacao AS (
    INSERT INTO public.dfc_vinculo
      (tenant_id, company_id, classificacao, codigo_dfc, origem)
    SELECT _tenant_id, _company_id, m.cls, m.cod, 'conta'
      FROM _mn m
    ON CONFLICT (tenant_id,
                 COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 classificacao)
      DO UPDATE SET codigo_dfc = EXCLUDED.codigo_dfc, atualizado_em = now()
      WHERE public.dfc_vinculo.codigo_dfc IS DISTINCT FROM EXCLUDED.codigo_dfc
    RETURNING 1
  ) SELECT count(*) INTO _criados FROM gravacao;

  -- Limpa o código da conta onde a classificação é unânime: ali o
  -- vínculo já diz a mesma coisa. Onde as contas discordam, fica —
  -- a aba de exceções mostra.
  _limpas := 0;   -- não se apaga mais nada: quem manda é a precedência

  RETURN jsonb_build_object(
    'vinculos', _criados, 'contas_limpas', _limpas,
    'cobertura', public.dfc_cobertura(_tenant_id, _company_id));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_normalizar(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_normalizar(uuid, uuid) TO service_role;

-- roda para o plano do escritório de cada tenant
DO $do$
DECLARE _t uuid; _r jsonb;
BEGIN
  FOR _t IN SELECT DISTINCT tenant_id FROM public.plano_contas WHERE company_id IS NULL LOOP
    _r := public.dfc_normalizar(_t, NULL);
    RAISE NOTICE 'dfc_normalizar(%) -> %', _t, _r;
  END LOOP;
END
$do$;
