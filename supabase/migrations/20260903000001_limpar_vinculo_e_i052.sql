-- ============================================================
-- AJUSTE 29 — "Limpar vínculo" e o código do plano (I051/I052)
-- ============================================================

-- ------------------------------------------------------------
-- 1) Por que "Limpar vínculo" não funcionava
-- ------------------------------------------------------------
-- A tabela tem esta restrição, e ela está CERTA:
--
--     CHECK (ignorada = true OR conta_padrao_codigo IS NOT NULL)
--
-- Ou seja: uma linha de de-para só existe se apontar para algum lugar,
-- ou se estiver explicitamente marcada como ignorada. Não existe "linha
-- de de-para que não decide nada" — e é bom que não exista, senão o
-- "aplicar" teria que adivinhar o que fazer com ela.
--
-- Só que limpar o vínculo gravava exatamente isso: destino nulo e
-- ignorada falsa. O banco recusava, a tela mostrava o erro do Postgres
-- (ou nada, dependendo de onde) e o vínculo continuava lá.
--
-- A correção não é afrouxar a restrição — é entender o que "limpar"
-- significa. Uma conta sem destino e não ignorada é uma conta PENDENTE,
-- e pendente é exatamente a ausência de linha: `estadoDe()` no app já
-- trata "sem linha" e "sem destino" da mesma forma. Então limpar =
-- APAGAR a linha.
--
-- Fica dentro de `aplicar_depara_em_lote` para valer nos três caminhos
-- que a tela oferece (a linha, a régua de lote e o cabeçalho de grupo)
-- sem cada um reimplementar a regra.
CREATE OR REPLACE FUNCTION public.aplicar_depara_em_lote(_company_id uuid, _itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
  _n int := 0;
  _apagadas int := 0;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para configurar o de-para desta empresa';
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada';
  END IF;

  CREATE TEMP TABLE _entrada ON COMMIT DROP AS
  SELECT DISTINCT ON (x.conta_codigo) x.*
    FROM jsonb_to_recordset(_itens) AS x(
      conta_codigo text,
      conta_padrao_codigo text,
      ignorada boolean,
      observacao text
    )
   WHERE x.conta_codigo IS NOT NULL
   ORDER BY x.conta_codigo;

  -- LIMPAR: sem destino e sem ignorar = volta a ser pendente = sem linha.
  DELETE FROM public.depara_contas d
   USING _entrada e
   WHERE d.company_id = _company_id
     AND d.conta_codigo = e.conta_codigo
     AND e.conta_padrao_codigo IS NULL
     AND COALESCE(e.ignorada, false) = false;
  GET DIAGNOSTICS _apagadas = ROW_COUNT;

  WITH gravadas AS (
    INSERT INTO public.depara_contas (
      tenant_id, company_id, conta_codigo, conta_padrao_codigo, ignorada, observacao
    )
    SELECT _tenant, _company_id, e.conta_codigo, e.conta_padrao_codigo,
           COALESCE(e.ignorada,false), e.observacao
      FROM _entrada e
     WHERE e.conta_padrao_codigo IS NOT NULL OR COALESCE(e.ignorada,false) = true
    ON CONFLICT (company_id, conta_codigo) DO UPDATE SET
      conta_padrao_codigo = EXCLUDED.conta_padrao_codigo,
      ignorada            = EXCLUDED.ignorada,
      observacao          = EXCLUDED.observacao,
      updated_at          = now()
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM gravadas;

  DROP TABLE IF EXISTS _entrada;
  RETURN jsonb_build_object('gravadas', _n, 'limpas', _apagadas);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.aplicar_depara_em_lote(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.aplicar_depara_em_lote(uuid, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2) O código do plano de contas: I051 e I052
-- ------------------------------------------------------------
-- No ajuste 27 a classificação estrutural saía da HIERARQUIA (a cadeia
-- COD_CTA_SUP). Funciona, mas é dedução. O ECD costuma trazer o código
-- de verdade em dois registros filhos do I050:
--
--   I051 |COD_ENT_REF|COD_CCUS|COD_CTA_REF|  → plano REFERENCIAL da RFB
--   I052 |COD_CCUS|COD_AGL|                  → código de AGLUTINAÇÃO
--
-- O I052 é o mais interessante: é por ele que o próprio ECD monta as
-- demonstrações do bloco J. Quando existe, ele É o código estrutural do
-- plano da empresa — não uma dedução minha.
--
-- Ordem de preferência, da fonte mais confiável para a menos:
--     I052 (aglutinação) → I051 (referencial) → hierarquia → código puro
ALTER TABLE public.ecd_conta
  ADD COLUMN IF NOT EXISTS cod_referencial  text,
  ADD COLUMN IF NOT EXISTS cod_aglutinacao  text,
  ADD COLUMN IF NOT EXISTS classificacao_origem text;

COMMENT ON COLUMN public.ecd_conta.cod_aglutinacao IS
  'I052 COD_AGL — código de aglutinação do próprio ECD.';
COMMENT ON COLUMN public.ecd_conta.cod_referencial IS
  'I051 COD_CTA_REF — conta no plano referencial da Receita.';
COMMENT ON COLUMN public.ecd_conta.classificacao_origem IS
  'De onde veio a classificação: i052 | i051 | hierarquia | codigo.';

-- Grava o que o parser leu de I051/I052 e reclassifica.
-- Chamada DEPOIS de `ecd_importar`, de propósito: aquela função tem 200
-- linhas e funciona; acrescentar campos ao INSERT dela seria mexer no
-- que já está certo por causa de dois campos opcionais.
CREATE OR REPLACE FUNCTION public.ecd_gravar_referencias(
  _importacao_id uuid, _refs jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _n int := 0; _cls int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ecd_importacao i
     WHERE i.id = _importacao_id AND public.pode_acessar_empresa(i.company_id)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para esta importação';
  END IF;

  UPDATE public.ecd_conta c
     SET cod_referencial = nullif(btrim(x.cod_referencial), ''),
         cod_aglutinacao = nullif(btrim(x.cod_aglutinacao), '')
    FROM jsonb_to_recordset(_refs)
      AS x(codigo text, cod_referencial text, cod_aglutinacao text)
   WHERE c.importacao_id = _importacao_id
     AND c.codigo = x.codigo
     AND (nullif(btrim(x.cod_referencial), '') IS NOT NULL
       OR nullif(btrim(x.cod_aglutinacao), '') IS NOT NULL);
  GET DIAGNOSTICS _n = ROW_COUNT;

  _cls := public.ecd_classificar(_importacao_id);
  RETURN jsonb_build_object('contas_com_referencia', _n, 'reclassificadas', _cls);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_gravar_referencias(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_gravar_referencias(uuid, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) Classificação com a nova ordem de preferência
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ecd_classificar(_importacao_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _n int := 0;
BEGIN
  -- (a) O que o arquivo diz, quando diz: I052 primeiro, I051 depois.
  UPDATE public.ecd_conta
     SET classificacao = cod_aglutinacao, classificacao_origem = 'i052'
   WHERE importacao_id = _importacao_id
     AND cod_aglutinacao IS NOT NULL
     AND (classificacao IS DISTINCT FROM cod_aglutinacao
       OR classificacao_origem IS DISTINCT FROM 'i052');

  UPDATE public.ecd_conta
     SET classificacao = cod_referencial, classificacao_origem = 'i051'
   WHERE importacao_id = _importacao_id
     AND cod_aglutinacao IS NULL
     AND cod_referencial IS NOT NULL
     AND (classificacao IS DISTINCT FROM cod_referencial
       OR classificacao_origem IS DISTINCT FROM 'i051');

  -- (b) O resto: dedução pela cadeia COD_CTA_SUP (ajuste 27).
  WITH RECURSIVE arvore AS (
    SELECT c.codigo, c.codigo::text AS caminho, 1 AS profundidade
      FROM public.ecd_conta c
     WHERE c.importacao_id = _importacao_id
       AND (
         c.cod_superior IS NULL
         OR btrim(c.cod_superior) = ''
         OR c.cod_superior = c.codigo
         OR NOT EXISTS (
           SELECT 1 FROM public.ecd_conta p
            WHERE p.importacao_id = _importacao_id
              AND p.codigo = c.cod_superior)
       )
    UNION ALL
    SELECT f.codigo,
           CASE
             WHEN left(f.codigo, length(a.caminho) + 1) = a.caminho || '.'
               THEN f.codigo
             ELSE a.caminho || '.' || f.codigo
           END,
           a.profundidade + 1
      FROM public.ecd_conta f
      JOIN arvore a ON a.codigo = f.cod_superior
     WHERE f.importacao_id = _importacao_id
       AND a.profundidade < 15
       AND f.codigo <> a.codigo
  )
  UPDATE public.ecd_conta c
     SET classificacao = a.caminho, classificacao_origem = 'hierarquia'
    FROM arvore a
   WHERE c.importacao_id = _importacao_id
     AND c.codigo = a.codigo
     -- Não sobrescreve o que veio do arquivo: dedução é o último recurso.
     AND c.cod_aglutinacao IS NULL
     AND c.cod_referencial IS NULL
     AND (c.classificacao IS DISTINCT FROM a.caminho
       OR c.classificacao_origem IS DISTINCT FROM 'hierarquia');
  GET DIAGNOSTICS _n = ROW_COUNT;

  -- (c) Rede de segurança: nada fica sem classificação.
  UPDATE public.ecd_conta
     SET classificacao = codigo, classificacao_origem = 'codigo'
   WHERE importacao_id = _importacao_id
     AND classificacao IS NULL;

  RETURN _n;
END;
$fn$;

-- Reclassifica o que já está carregado com a regra nova.
DO $do$
DECLARE _imp uuid;
BEGIN
  FOR _imp IN SELECT id FROM public.ecd_importacao LOOP
    PERFORM public.ecd_classificar(_imp);
  END LOOP;
END;
$do$;

NOTIFY pgrst, 'reload schema';
