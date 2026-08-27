-- ============================================================
-- AJUSTE 24 — importação de ECD para os períodos anteriores
-- ============================================================
--
-- O upload de ECD já existia e o parser já lia tudo que é preciso
-- (I050 = plano, I150/I155 = saldos mensais com abertura e fechamento).
-- O que faltava era o DESTINO: ele gravava em `chart_of_accounts`,
-- `account_balances` e `financial_statements` — as tabelas do pipeline
-- antigo, que nenhuma tela lê mais. Por isso "não carrega no banco".
--
-- Aqui o ECD passa a alimentar o pipeline atual: `saldos_mensais` e
-- `saldos_abertura`, com o código já traduzido para o plano padrão.
--
-- DESENHO EM TRÊS TEMPOS, e o motivo de não ser um passo só:
--
--   1. IMPORTAR   o arquivo vira dados em tabelas de ESPERA
--                 (`ecd_conta`, `ecd_saldo`). Nada entra na
--                 contabilidade ainda.
--   2. VINCULAR   sugere o de-para de cada conta do ECD para o plano
--                 padrão, com o motivo e o grau de confiança de cada
--                 sugestão. Tudo editável, nada aplicado.
--   3. APLICAR    só então materializa em `saldos_mensais` /
--                 `saldos_abertura`.
--
-- Importar direto seria mais rápido e muito pior: um de-para errado
-- espalha número errado por todas as demonstrações, e desfazer depois é
-- caro. Em espera, o erro custa um clique.
--
-- O vínculo reaproveita `depara_contas`, que já existe e já é o que o
-- motor consulta (`depara_traducao`). Assim, no instante em que o
-- vínculo é aceito, Balanço, DFC e indicadores passam a enxergar o
-- período antigo sem nenhuma outra mudança.

-- ------------------------------------------------------------
-- 1) Tabelas de espera
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ecd_importacao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  arquivo_nome    text NOT NULL,
  cnpj            text,
  razao_social    text,
  periodo_inicio  date,
  periodo_fim     date,
  -- 'importado' → em espera; 'aplicado' → já materializado
  status          text NOT NULL DEFAULT 'importado'
                  CHECK (status IN ('importado', 'aplicado', 'descartado')),
  resumo          jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  aplicado_em     timestamptz
);

CREATE TABLE IF NOT EXISTS public.ecd_conta (
  importacao_id uuid NOT NULL REFERENCES public.ecd_importacao(id) ON DELETE CASCADE,
  codigo        text NOT NULL,
  descricao     text,
  nivel         int,
  tipo          text,          -- 'A' analítica / 'S' sintética
  natureza      text,          -- D / C / P
  cod_superior  text,
  PRIMARY KEY (importacao_id, codigo)
);

CREATE TABLE IF NOT EXISTS public.ecd_saldo (
  importacao_id uuid NOT NULL REFERENCES public.ecd_importacao(id) ON DELETE CASCADE,
  codigo        text NOT NULL,
  competencia   date NOT NULL,          -- 1º dia do mês
  saldo_inicial numeric(18,2) NOT NULL DEFAULT 0,
  debitos       numeric(18,2) NOT NULL DEFAULT 0,
  creditos      numeric(18,2) NOT NULL DEFAULT 0,
  saldo_final   numeric(18,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (importacao_id, codigo, competencia)
);

CREATE INDEX IF NOT EXISTS idx_ecd_importacao_empresa
  ON public.ecd_importacao (company_id, status);
CREATE INDEX IF NOT EXISTS idx_ecd_saldo_comp
  ON public.ecd_saldo (importacao_id, competencia);

ALTER TABLE public.ecd_importacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecd_conta      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecd_saldo      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ecd_importacao tenant" ON public.ecd_importacao;
CREATE POLICY "ecd_importacao tenant" ON public.ecd_importacao
  TO authenticated
  USING (public.pode_gerenciar_tenant(tenant_id))
  WITH CHECK (public.pode_gerenciar_tenant(tenant_id));

DROP POLICY IF EXISTS "ecd_conta tenant" ON public.ecd_conta;
CREATE POLICY "ecd_conta tenant" ON public.ecd_conta
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ecd_importacao i
                  WHERE i.id = importacao_id AND public.pode_gerenciar_tenant(i.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ecd_importacao i
                  WHERE i.id = importacao_id AND public.pode_gerenciar_tenant(i.tenant_id)));

DROP POLICY IF EXISTS "ecd_saldo tenant" ON public.ecd_saldo;
CREATE POLICY "ecd_saldo tenant" ON public.ecd_saldo
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ecd_importacao i
                  WHERE i.id = importacao_id AND public.pode_gerenciar_tenant(i.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ecd_importacao i
                  WHERE i.id = importacao_id AND public.pode_gerenciar_tenant(i.tenant_id)));

-- ------------------------------------------------------------
-- 1b) Carga do arquivo já lido
--
-- O parser roda no navegador (o arquivo pode ter dezenas de MB e não
-- vale subir para o servidor). O que chega aqui é o resultado dele, em
-- UMA chamada — não milhares de inserts do navegador, que demorariam e
-- poderiam parar no meio.
--
-- Reimportar o mesmo arquivo substitui a importação anterior daquele
-- nome que ainda esteja em espera. Uma já APLICADA nunca é tocada: para
-- refazer, use `ecd_desfazer` antes.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ecd_importar(
  _company_id uuid,
  _arquivo_nome text,
  _cabecalho jsonb,
  _contas jsonb,
  _saldos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _id uuid; _nc int; _ns int; _meses int; _anual boolean;
BEGIN
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  DELETE FROM public.ecd_importacao
   WHERE company_id = _company_id AND arquivo_nome = _arquivo_nome AND status = 'importado';

  INSERT INTO public.ecd_importacao
    (tenant_id, company_id, arquivo_nome, cnpj, razao_social, periodo_inicio, periodo_fim)
  VALUES (_tenant, _company_id, _arquivo_nome,
          nullif(_cabecalho->>'cnpj',''), nullif(_cabecalho->>'razaoSocial',''),
          nullif(_cabecalho->>'periodoInicio','')::date,
          nullif(_cabecalho->>'periodoFim','')::date)
  RETURNING id INTO _id;

  INSERT INTO public.ecd_conta (importacao_id, codigo, descricao, nivel, tipo, natureza, cod_superior)
  SELECT _id,
         nullif(trim(x->>'codigo_conta'), ''),
         x->>'nome_conta',
         nullif(x->>'nivel','')::int,
         upper(COALESCE(nullif(x->>'tipo_conta',''), 'A')),
         upper(COALESCE(nullif(x->>'natureza',''), 'D')),
         nullif(x->>'parent_codigo','')
    FROM jsonb_array_elements(COALESCE(_contas, '[]'::jsonb)) x
   WHERE nullif(trim(x->>'codigo_conta'), '') IS NOT NULL
  ON CONFLICT (importacao_id, codigo) DO NOTHING;
  GET DIAGNOSTICS _nc = ROW_COUNT;

  -- A competência é normalizada para o 1º dia do mês, que é a convenção
  -- de `saldos_mensais`. Linhas repetidas da mesma conta/mês somam.
  INSERT INTO public.ecd_saldo
    (importacao_id, codigo, competencia, saldo_inicial, debitos, creditos, saldo_final)
  SELECT _id, codigo, competencia,
         sum(saldo_inicial), sum(debitos), sum(creditos), sum(saldo_final)
    FROM (
      SELECT nullif(trim(x->>'codigo_conta'), '')                       AS codigo,
             date_trunc('month', (x->>'periodo')::date)::date           AS competencia,
             COALESCE((x->>'saldo_inicial')::numeric, 0)                 AS saldo_inicial,
             COALESCE((x->>'debitos')::numeric, 0)                       AS debitos,
             COALESCE((x->>'creditos')::numeric, 0)                      AS creditos,
             COALESCE((x->>'saldo_final')::numeric, 0)                   AS saldo_final
        FROM jsonb_array_elements(COALESCE(_saldos, '[]'::jsonb)) x
       WHERE nullif(trim(x->>'codigo_conta'), '') IS NOT NULL
         AND nullif(x->>'periodo','') IS NOT NULL
    ) t
   GROUP BY codigo, competencia
  ON CONFLICT (importacao_id, codigo, competencia) DO NOTHING;
  GET DIAGNOSTICS _ns = ROW_COUNT;

  SELECT count(DISTINCT competencia) INTO _meses
    FROM public.ecd_saldo WHERE importacao_id = _id;

  -- Um ECD com I150 ANUAL entrega um saldo por ano, não por mês. Dá para
  -- importar, mas o Balanço mensal vai ter degraus — melhor avisar do
  -- que deixar descobrir depois.
  _anual := _meses > 0 AND _meses <= 2
            AND (SELECT (max(periodo_fim) - min(periodo_inicio)) > 300
                   FROM public.ecd_importacao WHERE id = _id);

  UPDATE public.ecd_importacao
     SET resumo = jsonb_build_object('contas', _nc, 'saldos', _ns,
                                     'meses', _meses, 'periodos_anuais', _anual)
   WHERE id = _id;

  RETURN jsonb_build_object('ok', true, 'importacao_id', _id,
    'contas', _nc, 'saldos', _ns, 'meses', _meses, 'periodos_anuais', _anual);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_importar(uuid, text, jsonb, jsonb, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_importar(uuid, text, jsonb, jsonb, jsonb)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2) Sugerir o de-para
--
-- Quatro regras, da mais forte para a mais fraca. Cada conta recebe a
-- PRIMEIRA que casar, e a regra que casou fica registrada — para você
-- saber por que aquela sugestão apareceu.
--
--   codigo       o código do ECD é o mesmo código da conta no plano
--   classificacao o código do ECD é a própria classificação do plano
--   saldo        o saldo de virada do ECD bate, ao centavo, com o saldo
--                de abertura que já está no sistema (o que veio do
--                diário já validado). É o sinal mais forte que existe
--                aqui: dois documentos independentes concordando.
--   descricao    o nome da conta, normalizado, é único dos dois lados
--
-- REGRA DE OURO: valor repetido NÃO sugere. Se duas contas do plano têm
-- o mesmo saldo, ou dois nomes normalizam igual, a sugestão fica de
-- fora e a conta aparece como pendente. Adivinhar em empate é como se
-- erra feio e em silêncio.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ecd_normalizar_texto(_s text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT regexp_replace(
           lower(translate(COALESCE(_s, ''),
             'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
             'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),
           '[^a-z0-9]+', ' ', 'g');
$$;

CREATE OR REPLACE FUNCTION public.ecd_sugerir_depara(_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _company uuid; _escopo uuid; _ate date;
  _r jsonb;
BEGIN
  SELECT i.tenant_id, i.company_id, i.periodo_fim
    INTO _tenant, _company, _ate
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'Importação não encontrada';
  END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  -- escopo do plano de destino: escritório ou a própria empresa
  _escopo := CASE WHEN COALESCE(
      (public.escopo_plano_empresa(_company)->>'usa_plano_padrao')::boolean, false)
    THEN NULL ELSE _company END;

  CREATE TEMP TABLE _plano ON COMMIT DROP AS
    SELECT p.codigo, p.classificacao, p.descricao,
           public.ecd_normalizar_texto(p.descricao) AS desc_norm
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _escopo
       AND p.ativo
       AND NOT p.is_sintetica;
  CREATE INDEX ON _plano (codigo);
  CREATE INDEX ON _plano (classificacao);
  CREATE INDEX ON _plano (desc_norm);
  ANALYZE _plano;

  -- saldo de virada já existente no sistema (veio do diário validado)
  CREATE TEMP TABLE _abert ON COMMIT DROP AS
    SELECT DISTINCT ON (a.conta_codigo) a.conta_codigo, a.saldo
      FROM public.saldos_abertura a
     WHERE a.company_id = _company
     ORDER BY a.conta_codigo, a.data_referencia DESC;
  ANALYZE _abert;

  -- contas do ECD que precisam de vínculo: analíticas com saldo
  CREATE TEMP TABLE _ecd ON COMMIT DROP AS
    SELECT c.codigo, c.descricao,
           public.ecd_normalizar_texto(c.descricao) AS desc_norm,
           s.saldo_final
      FROM public.ecd_conta c
      LEFT JOIN public.ecd_saldo s
             ON s.importacao_id = c.importacao_id
            AND s.codigo = c.codigo
            AND s.competencia = (SELECT max(competencia) FROM public.ecd_saldo
                                  WHERE importacao_id = _importacao_id)
     WHERE c.importacao_id = _importacao_id
       AND COALESCE(c.tipo, 'A') <> 'S';
  ANALYZE _ecd;

  -- valores e nomes que se repetem NÃO servem de âncora
  CREATE TEMP TABLE _saldo_unico ON COMMIT DROP AS
    SELECT saldo, min(conta_codigo) AS conta_codigo
      FROM _abert WHERE saldo <> 0
     GROUP BY saldo HAVING count(*) = 1;
  CREATE TEMP TABLE _desc_unica ON COMMIT DROP AS
    SELECT desc_norm, min(codigo) AS codigo
      FROM _plano WHERE desc_norm <> ''
     GROUP BY desc_norm HAVING count(*) = 1;
  CREATE TEMP TABLE _ecd_desc_unica ON COMMIT DROP AS
    SELECT desc_norm FROM _ecd WHERE desc_norm <> ''
     GROUP BY desc_norm HAVING count(*) = 1;
  ANALYZE _saldo_unico; ANALYZE _desc_unica; ANALYZE _ecd_desc_unica;

  CREATE TEMP TABLE _sug ON COMMIT DROP AS
  SELECT e.codigo AS ecd_codigo,
         COALESCE(pc.codigo, pcl.codigo, ps.codigo, pd.codigo) AS plano_codigo,
         CASE WHEN pc.codigo  IS NOT NULL THEN 'codigo'
              WHEN pcl.codigo IS NOT NULL THEN 'classificacao'
              WHEN ps.codigo  IS NOT NULL THEN 'saldo'
              WHEN pd.codigo  IS NOT NULL THEN 'descricao'
         END AS regra
    FROM _ecd e
    LEFT JOIN _plano pc  ON pc.codigo = e.codigo
    LEFT JOIN _plano pcl ON pcl.classificacao = e.codigo
    LEFT JOIN (
      SELECT su.saldo, pl.codigo
        FROM _saldo_unico su JOIN _plano pl ON pl.codigo = su.conta_codigo
    ) ps ON e.saldo_final IS NOT NULL AND e.saldo_final <> 0 AND ps.saldo = e.saldo_final
    LEFT JOIN _desc_unica du ON du.desc_norm = e.desc_norm
    LEFT JOIN _ecd_desc_unica edu ON edu.desc_norm = e.desc_norm
    LEFT JOIN _plano pd ON pd.codigo = du.codigo AND edu.desc_norm IS NOT NULL;

  -- Grava só onde AINDA NÃO existe vínculo: o que você já revisou
  -- nunca é sobrescrito por uma sugestão automática.
  INSERT INTO public.depara_contas
    (tenant_id, company_id, conta_codigo, conta_padrao_codigo, ignorada, observacao)
  SELECT _tenant, _company, s.ecd_codigo, s.plano_codigo, false,
         'ECD: sugestão automática por ' || s.regra
    FROM _sug s
   WHERE s.plano_codigo IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.depara_contas d
        WHERE d.tenant_id = _tenant AND d.company_id = _company
          AND d.conta_codigo = s.ecd_codigo);

  SELECT jsonb_build_object(
           'contas_ecd',   (SELECT count(*) FROM _ecd),
           'sugeridas',    (SELECT count(*) FROM _sug WHERE plano_codigo IS NOT NULL),
           'pendentes',    (SELECT count(*) FROM _sug WHERE plano_codigo IS NULL),
           'por_regra',    (SELECT COALESCE(jsonb_object_agg(regra, n), '{}'::jsonb)
                              FROM (SELECT regra, count(*) n FROM _sug
                                     WHERE regra IS NOT NULL GROUP BY regra) t),
           'ja_vinculadas',(SELECT count(*) FROM public.depara_contas d
                             WHERE d.tenant_id = _tenant AND d.company_id = _company))
    INTO _r;
  RETURN _r;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_sugerir_depara(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_sugerir_depara(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) Conferência — antes de aplicar
--
-- Devolve, período a período, o que o ECD diz e quanto disso está
-- vinculado. A linha que importa é `sem_vinculo`: é dinheiro que ficaria
-- de fora se você aplicasse agora.
--
-- E a conferência mais forte: `virada`. O saldo final do ECD no último
-- período tem que bater com o saldo de abertura que já está no sistema,
-- vindo do diário. São dois documentos independentes — se batem, o
-- de-para está certo; se não batem, tem conta faltando ou trocada.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ecd_conferencia(_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _company uuid; _r jsonb; _ultimo date;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT max(competencia) INTO _ultimo FROM public.ecd_saldo WHERE importacao_id = _importacao_id;

  WITH vinc AS (
    SELECT d.conta_codigo, d.conta_padrao_codigo, d.ignorada
      FROM public.depara_contas d
     WHERE d.tenant_id = _tenant AND d.company_id = _company
  ),
  por_periodo AS (
    SELECT s.competencia,
           count(*)                                                        AS contas,
           count(*) FILTER (WHERE v.conta_padrao_codigo IS NOT NULL)        AS vinculadas,
           count(*) FILTER (WHERE COALESCE(v.ignorada,false))               AS ignoradas,
           sum(s.debitos)                                                   AS debitos,
           sum(s.creditos)                                                  AS creditos,
           sum(CASE WHEN v.conta_padrao_codigo IS NULL AND NOT COALESCE(v.ignorada,false)
                    THEN abs(s.debitos) + abs(s.creditos) ELSE 0 END)       AS movimento_sem_vinculo
      FROM public.ecd_saldo s
      LEFT JOIN vinc v ON v.conta_codigo = s.codigo
     WHERE s.importacao_id = _importacao_id
     GROUP BY s.competencia
  ),
  -- virada: ECD (último período, traduzido) × abertura já existente
  ecd_fim AS (
    SELECT v.conta_padrao_codigo AS codigo, sum(s.saldo_final) AS saldo
      FROM public.ecd_saldo s
      JOIN vinc v ON v.conta_codigo = s.codigo AND v.conta_padrao_codigo IS NOT NULL
     WHERE s.importacao_id = _importacao_id AND s.competencia = _ultimo
     GROUP BY 1
  ),
  abert AS (
    SELECT DISTINCT ON (a.conta_codigo) a.conta_codigo AS codigo, a.saldo
      FROM public.saldos_abertura a
     WHERE a.company_id = _company
     ORDER BY a.conta_codigo, a.data_referencia DESC
  )
  SELECT jsonb_build_object(
    'ultimo_periodo', _ultimo,
    'periodos', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'competencia', competencia, 'contas', contas,
                    'vinculadas', vinculadas, 'ignoradas', ignoradas,
                    'debitos', debitos, 'creditos', creditos,
                    'movimento_sem_vinculo', movimento_sem_vinculo)
                    ORDER BY competencia), '[]'::jsonb) FROM por_periodo),
    -- A virada só é comparável nas contas que os DOIS lados têm. Uma
    -- conta que existe só de um lado não é divergência de valor: é
    -- cobertura faltando, e vira outro número. Misturar as duas coisas
    -- fazia a conferência acusar erro onde não havia.
    'virada', (SELECT jsonb_build_object(
                 'em_ambos', count(*) FILTER (WHERE e.codigo IS NOT NULL AND a.codigo IS NOT NULL),
                 'batem',    count(*) FILTER (WHERE e.codigo IS NOT NULL AND a.codigo IS NOT NULL
                                          AND abs(e.saldo - a.saldo) < 0.01),
                 'diferem',  count(*) FILTER (WHERE e.codigo IS NOT NULL AND a.codigo IS NOT NULL
                                          AND abs(e.saldo - a.saldo) >= 0.01),
                 'so_no_ecd',     count(*) FILTER (WHERE a.codigo IS NULL),
                 'so_no_sistema', count(*) FILTER (WHERE e.codigo IS NULL),
                 'diferenca_total', COALESCE(sum(e.saldo - a.saldo)
                                      FILTER (WHERE e.codigo IS NOT NULL AND a.codigo IS NOT NULL), 0),
                 'exemplos', COALESCE((SELECT jsonb_agg(x) FROM (
                     SELECT e2.codigo AS conta, e2.saldo AS ecd, a2.saldo AS sistema
                       FROM ecd_fim e2 JOIN abert a2 ON a2.codigo = e2.codigo
                      WHERE abs(e2.saldo - a2.saldo) >= 0.01
                      LIMIT 10) x), '[]'::jsonb))
               FROM ecd_fim e FULL JOIN abert a ON a.codigo = e.codigo)
  ) INTO _r;
  RETURN _r;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_conferencia(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_conferencia(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) Aplicar
--
-- Materializa em `saldos_mensais` e `saldos_abertura`, com o código já
-- traduzido para o plano. Duas travas:
--
--   * NÃO sobrescreve competência que já tem movimento vindo do diário,
--     a menos que `_substituir` seja verdadeiro. O diário validado é a
--     fonte melhor; o ECD entra para completar o que falta atrás.
--   * recusa se houver conta com movimento e sem vínculo, a menos que
--     `_forcar`. Aplicar com conta solta é exatamente como se perde
--     dinheiro em silêncio.
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
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  -- DISTINCT: uma conta com 12 meses de movimento é UMA conta pendente,
  -- não doze. A mensagem tem que dizer quantas contas faltam vincular.
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

  -- movimento mensal, já traduzido e somado por conta do plano
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
    SELECT t.* FROM tradu t
     WHERE _substituir OR NOT EXISTS (
       SELECT 1 FROM public.saldos_mensais m
        WHERE m.company_id = _company AND m.competencia = t.competencia)
  ),
  gravado AS (
    INSERT INTO public.saldos_mensais
      (tenant_id, company_id, conta_codigo, competencia, total_debitos, total_creditos)
    SELECT _tenant, _company, a.codigo, a.competencia, a.deb, a.cred FROM alvo a
    ON CONFLICT (company_id, conta_codigo, competencia)
      DO UPDATE SET total_debitos = EXCLUDED.total_debitos,
                    total_creditos = EXCLUDED.total_creditos,
                    updated_at = now()
    RETURNING 1
  ) SELECT count(*) INTO _linhas FROM gravado;

  -- abertura do ECD: saldo inicial do PRIMEIRO período, na véspera dele
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
      (tenant_id, company_id, conta_codigo, data_referencia, saldo)
    SELECT _tenant, _company, t.codigo, (_primeiro - INTERVAL '1 day')::date, t.saldo
      FROM tradu t WHERE t.saldo <> 0
    ON CONFLICT (company_id, conta_codigo, data_referencia)
      DO UPDATE SET saldo = EXCLUDED.saldo
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
    'abertura_em', (_primeiro - INTERVAL '1 day')::date,
    'contas_sem_vinculo', _sem_vinculo,
    'conferencia', public.ecd_conferencia(_importacao_id));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_aplicar(uuid, boolean, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_aplicar(uuid, boolean, boolean) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5) Desfazer — porque erro de de-para acontece
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ecd_desfazer(_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _company uuid; _de date; _ate date; _n int; _na int;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT min(competencia), max(competencia) INTO _de, _ate
    FROM public.ecd_saldo WHERE importacao_id = _importacao_id;

  WITH d AS (
    DELETE FROM public.saldos_mensais m
     WHERE m.company_id = _company
       AND m.competencia BETWEEN _de AND _ate
    RETURNING 1
  ) SELECT count(*) INTO _n FROM d;

  WITH d AS (
    DELETE FROM public.saldos_abertura a
     WHERE a.company_id = _company
       AND a.data_referencia = (_de - INTERVAL '1 day')::date
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

NOTIFY pgrst, 'reload schema';
