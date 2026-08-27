-- ============================================================
-- AJUSTE 36 — em que grupo estou alocando, e alocar sozinho
-- ============================================================
--
-- "no de-para preciso saber em qual grupo eu estou alocando a conta"
-- "para os dados que tenho hoje seria bom tu fazer a alocação
--  automaticamente já. Assim para a DFC também."

-- Caixa de título, para o galho não gritar em maiúsculas na tela.
CREATE OR REPLACE FUNCTION public.ecd_titulo(_s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE WHEN _s IS NULL OR btrim(_s) = '' THEN NULL
              WHEN _s = upper(_s) THEN initcap(lower(_s))
              ELSE _s END;
$fn$;

GRANT EXECUTE ON FUNCTION public.ecd_titulo(text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 1) O GALHO de cada conta de destino
-- ------------------------------------------------------------
-- Escolher "1.01.01.01.01 CAIXA GERAL" numa lista de 950 não diz onde
-- aquilo vai cair. O que decide é o galho: Ativo → Circulante →
-- Disponível. E, para a DFC, o código que aquela classificação resolve.
--
-- Sai daqui e não do navegador por dois motivos: são 950 contas contra
-- 199 sintéticas (junção que não se faz em JS sem trazer as duas), e a
-- resolução de DFC já mora no banco.
CREATE OR REPLACE FUNCTION public.plano_grupos_destino(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL
)
RETURNS TABLE (
  classificacao text,
  demonstracao  text,   -- 1-Ativo | 2-Passivo | 3-DRE
  galho         text,   -- "Ativo > Ativo Circulante > Disponível"
  codigo_dfc    text,
  descricao_dfc text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH alvo AS (
    SELECT CASE
      WHEN _company_id IS NULL THEN NULL::uuid
      WHEN COALESCE((public.escopo_plano_empresa(_company_id)->>'usa_plano_padrao')::boolean,
                    false) THEN NULL::uuid
      ELSE _company_id END AS company_id
  ),
  -- As sintéticas são os degraus do galho. São ~199; cabem na memória do
  -- planejador sem esforço.
  sint AS MATERIALIZED (
    SELECT p.classificacao, p.descricao, p.tipo, p.nivel
      FROM public.plano_contas p, alvo a
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM a.company_id
       AND p.ativo AND p.is_sintetica
       AND NOT COALESCE(p.is_participante, false)
  ),
  folhas AS MATERIALIZED (
    -- DISTINCT ON, não DISTINCT: a mesma classificação pode existir com
    -- `tipo` diferente (uma agregadora herda o tipo do pai participante),
    -- e o DISTINCT devolvia a conta DUAS vezes com demonstrações
    -- diferentes. Vence o tipo que combina com o primeiro dígito da
    -- classificação — que é a demonstração de verdade.
    SELECT DISTINCT ON (p.classificacao) p.classificacao, p.tipo
      FROM public.plano_contas p, alvo a
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM a.company_id
       AND p.ativo AND NOT p.is_sintetica
       AND NOT COALESCE(p.is_participante, false)
     ORDER BY p.classificacao,
              (left(p.tipo, 1) = left(p.classificacao, 1)) DESC, p.tipo
  ),
  -- Cada folha com os ancestrais sintéticos dela, na ordem.
  cadeia AS (
    SELECT f.classificacao, f.tipo,
           string_agg(public.ecd_titulo(s.descricao), ' > ' ORDER BY length(s.classificacao))
             AS galho
      FROM folhas f
      LEFT JOIN sint s
             ON s.classificacao = f.classificacao
             OR left(f.classificacao, length(s.classificacao) + 1) = s.classificacao || '.'
     GROUP BY f.classificacao, f.tipo
  ),
  res AS MATERIALIZED (
    SELECT * FROM public.dfc_resolucao(_tenant_id, (SELECT company_id FROM alvo))
  )
  SELECT c.classificacao, c.tipo, c.galho, r.codigo_dfc, cat.descricao
    FROM cadeia c
    LEFT JOIN LATERAL (
      SELECT x.codigo_dfc FROM res x
       WHERE c.classificacao = x.classificacao
          OR left(c.classificacao, length(x.classificacao) + 1) = x.classificacao || '.'
       ORDER BY length(x.classificacao) DESC
       LIMIT 1
    ) r ON true
    LEFT JOIN public.dfc_catalogo cat ON cat.codigo = r.codigo_dfc;
$fn$;

REVOKE EXECUTE ON FUNCTION public.plano_grupos_destino(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.plano_grupos_destino(uuid, uuid) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 2) A ALOCAÇÃO AUTOMÁTICA DO ECD
-- ------------------------------------------------------------
-- O "Sugerir vínculos" já existia, mas deixava tudo em estado SUGERIDO —
-- pendente de conferência uma a uma. Agora que o I051 é lido, existe uma
-- regra EXATA que antes não existia:
--
--     a classificação estrutural do ECD  ==  a classificação do plano
--
-- Não é semelhança de nome nem coincidência de número: é o mesmo código
-- de plano de contas dos dois lados. Essa vai como VINCULADA, não como
-- sugerida — não há o que conferir num código idêntico.
--
-- O resto continua pela cadeia de sugestão (nome, saldo, descrição) e
-- continua marcado como sugestão, para você olhar.
CREATE OR REPLACE FUNCTION public.ecd_alocar_automatico(
  _importacao_id uuid,
  _refazer boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _company uuid; _escopo uuid;
  _exatas int := 0; _sug jsonb; _pendentes int;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_acessar_empresa(_company) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  _escopo := CASE WHEN COALESCE(
      (public.escopo_plano_empresa(_company)->>'usa_plano_padrao')::boolean, false)
    THEN NULL ELSE _company END;

  -- Refazer: só o que o robô escreveu sai (mesma regra do ajuste 31).
  IF _refazer THEN
    DELETE FROM public.depara_contas d
     WHERE d.tenant_id = _tenant AND d.company_id = _company
       AND (d.observacao ILIKE 'ECD: sugestão automática%'
         OR d.observacao ILIKE 'ECD: classificação idêntica%')
       AND EXISTS (SELECT 1 FROM public.ecd_conta c
                    WHERE c.importacao_id = _importacao_id AND c.codigo = d.conta_codigo);
  END IF;

  -- ---------- regra exata: mesma classificação estrutural ----------
  WITH par AS (
    SELECT DISTINCT ON (e.codigo) e.codigo AS ecd_codigo, p.codigo AS plano_codigo
      FROM public.ecd_conta e
      JOIN public.plano_contas p
        ON p.classificacao = e.classificacao
       AND p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _escopo
       AND p.ativo AND NOT p.is_sintetica
       AND NOT COALESCE(p.is_participante, false)
     WHERE e.importacao_id = _importacao_id
       AND COALESCE(e.tipo, 'A') <> 'S'
       -- SÓ classificação que veio do ARQUIVO. A origem 'reduzido' é o
       -- próprio código da conta, e casar isso com o plano é a
       -- coincidência que estragou as sugestões do ajuste 30.
       AND e.classificacao_origem IN ('i052', 'i051', 'hierarquia')
       AND position('.' in e.classificacao) > 0
     ORDER BY e.codigo, p.codigo
  ),
  gravadas AS (
    INSERT INTO public.depara_contas
      (tenant_id, company_id, conta_codigo, conta_padrao_codigo, ignorada, observacao)
    SELECT _tenant, _company, par.ecd_codigo, par.plano_codigo, false,
           'ECD: classificação idêntica no plano'
      FROM par
     WHERE NOT EXISTS (
       SELECT 1 FROM public.depara_contas d
        WHERE d.tenant_id = _tenant AND d.company_id = _company
          AND d.conta_codigo = par.ecd_codigo)
    RETURNING 1
  ) SELECT count(*) INTO _exatas FROM gravadas;

  -- ---------- o resto, pela cadeia de sugestão ----------
  _sug := public.ecd_sugerir_depara(_importacao_id, false);

  SELECT count(*) INTO _pendentes
    FROM public.ecd_conta c
   WHERE c.importacao_id = _importacao_id
     AND COALESCE(c.tipo, 'A') <> 'S'
     AND NOT EXISTS (
       SELECT 1 FROM public.depara_contas d
        WHERE d.tenant_id = _tenant AND d.company_id = _company
          AND d.conta_codigo = c.codigo);

  RETURN jsonb_build_object(
    'exatas', _exatas,
    'sugeridas', COALESCE((_sug->>'sugeridas')::int, 0),
    'zeradas_barradas', COALESCE((_sug->>'zeradas_barradas')::int, 0),
    'pendentes', _pendentes,
    'por_regra', COALESCE(_sug->'por_regra', '{}'::jsonb));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_alocar_automatico(uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_alocar_automatico(uuid, boolean) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) A ALOCAÇÃO AUTOMÁTICA DA DFC
-- ------------------------------------------------------------
-- `aplicar_dfc_padrao` existe desde o ajuste 11, mas grava
-- `plano_contas.dfc_codigo` — UMA LINHA POR CONTA, 135 mil UPDATEs, e é
-- o caminho que o ajuste 15 aposentou (o vínculo por classificação
-- ganha do código gravado na conta).
--
-- Esta grava VÍNCULO por classificação: 71 linhas em vez de 135 mil, e
-- é o que a leitura realmente usa. A herança faz o resto — classificar
-- "1.01.01" resolve tudo que pendura embaixo.
CREATE OR REPLACE FUNCTION public.dfc_alocar_automatico(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _sobrescrever boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _escopo uuid; _n int := 0; _cobertas int; _faltam int;
BEGIN
  IF NOT public.pode_tenant(_tenant_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  _escopo := CASE
    WHEN _company_id IS NULL THEN NULL
    WHEN COALESCE((public.escopo_plano_empresa(_company_id)->>'usa_plano_padrao')::boolean,
                  false) THEN NULL
    ELSE _company_id END;

  WITH gravadas AS (
    INSERT INTO public.dfc_vinculo (tenant_id, company_id, classificacao, codigo_dfc, origem)
    -- 'planilha' e não 'padrao': o CHECK da tabela só aceita
    -- planilha|manual|conta, e o que importa é a distinção que a
    -- resolução usa — não-manual pode ser reescrito, manual não.
    SELECT _tenant_id, _escopo, d.classificacao, d.codigo_dfc, 'planilha'
      FROM public.dfc_padrao d
      -- Só onde o plano REALMENTE tem conta: um vínculo em classificação
      -- inexistente é ruído que aparece na planilha como
      -- "(sem conta no plano)".
     WHERE EXISTS (
       SELECT 1 FROM public.plano_contas p
        WHERE p.tenant_id = _tenant_id
          AND p.company_id IS NOT DISTINCT FROM _escopo
          AND p.ativo
          AND (p.classificacao = d.classificacao
            OR left(p.classificacao, length(d.classificacao) + 1) = d.classificacao || '.'))
       AND (_sobrescrever OR NOT EXISTS (
         SELECT 1 FROM public.dfc_vinculo v
          WHERE v.tenant_id = _tenant_id
            AND v.company_id IS NOT DISTINCT FROM _escopo
            AND v.classificacao = d.classificacao))
    ON CONFLICT (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), classificacao)
      -- Nunca atropela o que foi decidido À MÃO, mesmo com sobrescrever:
      -- o padrão é ponto de partida, não autoridade.
      DO UPDATE SET codigo_dfc = EXCLUDED.codigo_dfc, atualizado_em = now()
      WHERE public.dfc_vinculo.origem <> 'manual'
    RETURNING 1
  ) SELECT count(*) INTO _n FROM gravadas;

  SELECT count(*) FILTER (WHERE codigo_dfc IS NOT NULL),
         count(*) FILTER (WHERE codigo_dfc IS NULL)
    INTO _cobertas, _faltam
    FROM public.dfc_efetivo(_tenant_id, _company_id, true);

  RETURN jsonb_build_object(
    'vinculos_gravados', _n,
    'classificacoes_com_codigo', _cobertas,
    'classificacoes_sem_codigo', _faltam);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_alocar_automatico(uuid, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_alocar_automatico(uuid, uuid, boolean) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) "aloquei errado ou está calculando errado?"
-- ------------------------------------------------------------
-- Há um caso em que o número sai estranho e NÃO é alocação errada: o
-- ECD traz o ENCERRAMENTO DO EXERCÍCIO. Em dezembro o sistema contábil
-- transfere o saldo acumulado de toda conta de resultado para o PL,
-- zerando as 3.x. Esse lançamento está no I155 como movimento — então a
-- DRE de dezembro sai com o NEGATIVO do acumulado de janeiro a novembro,
-- e a DRE do ano soma zero.
--
-- O motor já corrige isso, mas procurando o histórico em
-- `lancamentos_diario` ("Transferido Para Conta ... Resultado"). O ECD
-- não escreve lá. Logo a correção nunca alcança dado vindo de ECD.
--
-- Corrigir de verdade exigiria o detalhe do lançamento (I200/I250) — do
-- saldo sozinho é IMPOSSÍVEL separar o encerramento do movimento
-- genuíno de dezembro: as duas incógnitas satisfazem a mesma equação.
-- Então esta função não adivinha: ela DETECTA e diz. Ver um número
-- estranho com a causa escrita ao lado é outra conversa.
CREATE OR REPLACE FUNCTION public.ecd_encerramento(_importacao_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH resultado AS (
    SELECT s.competencia, s.codigo, s.saldo_inicial, s.saldo_final,
           s.debitos, s.creditos
      FROM public.ecd_saldo s
      JOIN public.ecd_conta c
        ON c.importacao_id = s.importacao_id AND c.codigo = s.codigo
     WHERE s.importacao_id = _importacao_id
       AND COALESCE(c.tipo, 'A') <> 'S'
       -- conta de resultado pela classificação efetiva
       AND left(COALESCE(nullif(c.classificacao, ''), c.codigo), 1) IN ('3', '4', '5', '6')
  ),
  zeradas AS (
    SELECT competencia,
           count(*) FILTER (WHERE abs(saldo_final) < 0.005
                              AND abs(saldo_inicial) >= 0.005) AS contas_zeradas,
           sum(abs(saldo_inicial)) FILTER (WHERE abs(saldo_final) < 0.005) AS valor
      FROM resultado
     GROUP BY competencia
  )
  SELECT jsonb_build_object(
    'tem_encerramento', EXISTS (SELECT 1 FROM zeradas WHERE contas_zeradas >= 3),
    'meses', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'competencia', competencia,
                'contas_zeradas', contas_zeradas,
                'valor_transferido', round(COALESCE(valor, 0), 2))
                ORDER BY competencia)
              FROM zeradas WHERE contas_zeradas >= 3), '[]'::jsonb),
    'contas_de_resultado', (SELECT count(DISTINCT codigo) FROM resultado))
  WHERE EXISTS (SELECT 1 FROM public.ecd_importacao i
                 WHERE i.id = _importacao_id AND public.pode_acessar_empresa(i.company_id));
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_encerramento(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_encerramento(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
