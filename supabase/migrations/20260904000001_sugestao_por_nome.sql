-- ============================================================
-- AJUSTE 30 — sugestões que faziam sentido por acidente
-- ============================================================
--
-- DEFEITO 1 — a regra "codigo" casava por coincidência.
--
-- O plano do escritório usa códigos internos curtos:
--
--     codigo | classificacao   | descricao
--     -------+-----------------+-----------------------
--     1009   | 3.01.01.01.09   | VENDAS DE PRODUTOS
--     1021   | 3.01.01.02.21   | VENDAS DE MERCADORIAS
--
-- E o ECD traz códigos reduzidos igualmente curtos ("1009", "1021").
-- A regra comparava um com o outro:
--
--     LEFT JOIN _plano pc ON pc.codigo = e.codigo
--
-- Dois números iguais que não têm NADA a ver um com o outro. É a mais
-- forte da cadeia, então ela ganhava de todas as outras — por isso as
-- sugestões "parecem bugadas": elas são sorteios com cara de regra.
--
-- Agora essa comparação só vale quando o código do ECD tem cara de
-- estrutural (tem ponto). Um "1009" solto não casa mais com nada.
--
-- DEFEITO 2 — saldo zero não distingue nada.
--
-- A regra do saldo já ignorava zeros dos dois lados, mas quem tem saldo
-- zero ficava sem nenhuma âncora: sobrava só a comparação de nome
-- EXATA, que quase nunca bate ("CAIXA GERAL" × "CAIXA"). Daí a conta
-- ficava pendente sem motivo aparente.
--
-- Entra a regra por NOME APROXIMADO — a que o Georg pediu.

-- ------------------------------------------------------------
-- Similaridade de nome: Dice sobre palavras
-- ------------------------------------------------------------
-- Por que Dice sobre palavras e não distância de caracteres: nome de
-- conta é uma lista de palavras, não uma frase. "DUPLICATAS A RECEBER
-- CLIENTES" e "CLIENTES - DUPLICATAS A RECEBER" são a mesma conta e
-- distância de caracteres diria que não. Comparando conjuntos de
-- palavras, a ordem deixa de importar.
--
-- Palavras de ligação e sufixos de razão social não contam: senão duas
-- contas quaisquer já começam parecidas por causa de "DE" e "DO".
CREATE OR REPLACE FUNCTION public.ecd_palavras(_s text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(array_agg(DISTINCT w), '{}')
    FROM unnest(string_to_array(public.ecd_normalizar_texto(_s), ' ')) AS w
   WHERE length(w) > 1
     AND w NOT IN ('de','da','do','das','dos','e','a','o','as','os','no','na',
                   'nos','nas','em','com','para','por','ao','aos','ltda','sa',
                   's','me','epp','eireli','cia','the');
$$;

CREATE OR REPLACE FUNCTION public.ecd_similaridade(_a text, _b text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  WITH pa AS (SELECT public.ecd_palavras(_a) AS w),
       pb AS (SELECT public.ecd_palavras(_b) AS w),
       comuns AS (
         SELECT count(*) AS n
           FROM pa, pb, unnest(pa.w) AS x
          WHERE x = ANY (pb.w)
       )
  SELECT CASE
    WHEN COALESCE(array_length((SELECT w FROM pa),1),0)
       + COALESCE(array_length((SELECT w FROM pb),1),0) = 0 THEN 0::numeric
    ELSE round(
      2.0 * (SELECT n FROM comuns)
      / (COALESCE(array_length((SELECT w FROM pa),1),0)
       + COALESCE(array_length((SELECT w FROM pb),1),0)), 4)
  END;
$$;

GRANT EXECUTE ON FUNCTION public.ecd_palavras(text)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ecd_similaridade(text,text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Sugestão de de-para, com a cadeia corrigida
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ecd_sugerir_depara(_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _company uuid; _escopo uuid; _r jsonb;
  -- Dois números, e os dois importam:
  --   MINIMO  — abaixo disto não é parecido, é coincidência de uma
  --             palavra comum ("DESPESA", "CONTA").
  --   MARGEM  — o melhor tem que ganhar do segundo por esta distância.
  --             Sem isso, entre "BANCO ITAU" e "BANCO BRADESCO" para
  --             "BANCO ITAU S/A" a diferença seria mínima e a escolha,
  --             um sorteio silencioso.
  _minimo  constant numeric := 0.60;
  _margem  constant numeric := 0.15;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'Importação não encontrada';
  END IF;
  IF NOT public.pode_acessar_empresa(_company) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  _escopo := CASE WHEN COALESCE(
      (public.escopo_plano_empresa(_company)->>'usa_plano_padrao')::boolean, false)
    THEN NULL ELSE _company END;

  CREATE TEMP TABLE _plano ON COMMIT DROP AS
    SELECT p.codigo, p.classificacao, p.descricao,
           public.ecd_normalizar_texto(p.descricao) AS desc_norm,
           public.ecd_palavras(p.descricao)         AS palavras
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _escopo
       AND p.ativo
       AND NOT p.is_sintetica
       AND NOT COALESCE(p.is_participante, false);
  CREATE INDEX ON _plano (codigo);
  CREATE INDEX ON _plano (classificacao);
  CREATE INDEX ON _plano (desc_norm);
  ANALYZE _plano;

  CREATE TEMP TABLE _abert ON COMMIT DROP AS
    SELECT DISTINCT ON (a.conta_codigo) a.conta_codigo, a.saldo
      FROM public.saldos_abertura a
     WHERE a.company_id = _company
     ORDER BY a.conta_codigo, a.data_referencia DESC;
  ANALYZE _abert;

  CREATE TEMP TABLE _ecd ON COMMIT DROP AS
    SELECT c.codigo, c.descricao, c.classificacao,
           public.ecd_normalizar_texto(c.descricao) AS desc_norm,
           public.ecd_palavras(c.descricao)         AS palavras,
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

  -- ---------- nome aproximado ----------
  -- Só pares que compartilham ALGUMA palavra entram na conta — evita
  -- comparar todas as contas do ECD com todas as 950 do plano.
  CREATE TEMP TABLE _tok_ecd ON COMMIT DROP AS
    SELECT e.codigo, w FROM _ecd e, unnest(e.palavras) w;
  CREATE TEMP TABLE _tok_plano ON COMMIT DROP AS
    SELECT p.codigo, w FROM _plano p, unnest(p.palavras) w;
  CREATE INDEX ON _tok_ecd (w);
  CREATE INDEX ON _tok_plano (w);
  ANALYZE _tok_ecd; ANALYZE _tok_plano;

  CREATE TEMP TABLE _dice ON COMMIT DROP AS
    SELECT te.codigo AS ecd_codigo,
           tp.codigo AS plano_codigo,
           round(2.0 * count(*) /
                 (COALESCE(array_length(e.palavras,1),0)
                + COALESCE(array_length(p.palavras,1),0)), 4) AS nota
      FROM _tok_ecd te
      JOIN _tok_plano tp ON tp.w = te.w
      JOIN _ecd   e ON e.codigo = te.codigo
      JOIN _plano p ON p.codigo = tp.codigo
     GROUP BY te.codigo, tp.codigo, e.palavras, p.palavras;
  ANALYZE _dice;

  CREATE TEMP TABLE _nome ON COMMIT DROP AS
    SELECT d.ecd_codigo, d.plano_codigo, d.nota,
           (SELECT max(d2.nota) FROM _dice d2
             WHERE d2.ecd_codigo = d.ecd_codigo
               AND d2.plano_codigo <> d.plano_codigo) AS segundo
      FROM (SELECT DISTINCT ON (ecd_codigo) *
              FROM _dice ORDER BY ecd_codigo, nota DESC, plano_codigo) d
     WHERE d.nota >= _minimo;
  DELETE FROM _nome
   WHERE segundo IS NOT NULL AND (nota - segundo) < _margem;
  ANALYZE _nome;

  -- ---------- a cadeia, da regra mais forte para a mais fraca ----------
  CREATE TEMP TABLE _sug ON COMMIT DROP AS
  SELECT e.codigo AS ecd_codigo,
         COALESCE(pcl.codigo, pcls.codigo, pc.codigo, ps.codigo, pd.codigo, nm.plano_codigo)
           AS plano_codigo,
         CASE WHEN pcl.codigo  IS NOT NULL THEN 'classificacao'
              WHEN pcls.codigo IS NOT NULL THEN 'classificacao'
              WHEN pc.codigo   IS NOT NULL THEN 'codigo'
              WHEN ps.codigo   IS NOT NULL THEN 'saldo'
              WHEN pd.codigo   IS NOT NULL THEN 'descricao'
              WHEN nm.plano_codigo IS NOT NULL THEN 'nome'
         END AS regra,
         nm.nota AS nota_nome
    FROM _ecd e
    -- 1) o código do ECD É a classificação do plano
    LEFT JOIN _plano pcl  ON pcl.classificacao = e.codigo
    -- 2) a classificação estrutural do ECD (I052/I051/hierarquia) bate
    LEFT JOIN _plano pcls ON e.classificacao IS NOT NULL
                         AND pcls.classificacao = e.classificacao
    -- 3) mesmo código — SÓ se o código do ECD tiver cara de estrutural.
    --    Sem esta condição, "1009" do ECD casava com o código interno
    --    "1009" do plano, que é outro universo de numeração.
    LEFT JOIN _plano pc   ON pc.codigo = e.codigo
                         AND position('.' in e.codigo) > 0
    -- 4) saldo de virada idêntico, e único dos dois lados
    LEFT JOIN (
      SELECT su.saldo, pl.codigo
        FROM _saldo_unico su JOIN _plano pl ON pl.codigo = su.conta_codigo
    ) ps ON e.saldo_final IS NOT NULL AND e.saldo_final <> 0 AND ps.saldo = e.saldo_final
    -- 5) nome idêntico e único dos dois lados
    LEFT JOIN _desc_unica du ON du.desc_norm = e.desc_norm
    LEFT JOIN _ecd_desc_unica edu ON edu.desc_norm = e.desc_norm
    LEFT JOIN _plano pd ON pd.codigo = du.codigo AND edu.desc_norm IS NOT NULL
    -- 6) nome PARECIDO, com folga sobre o segundo colocado
    LEFT JOIN _nome nm ON nm.ecd_codigo = e.codigo;

  INSERT INTO public.depara_contas
    (tenant_id, company_id, conta_codigo, conta_padrao_codigo, ignorada, observacao)
  SELECT _tenant, _company, s.ecd_codigo, s.plano_codigo, false,
         'ECD: sugestão automática por ' || s.regra ||
         CASE WHEN s.regra = 'nome'
              THEN ' (' || round(s.nota_nome * 100) || '% de semelhança)'
              ELSE '' END
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
-- Diagnóstico: o que o arquivo REALMENTE trouxe
-- ------------------------------------------------------------
-- Duas vezes seguidas eu deduzi a forma do ECD pelo layout e pelo
-- exemplo, e duas vezes a classificação saiu como o código reduzido.
-- Em vez de uma terceira dedução, isto: um botão que devolve o que está
-- gravado, para o arquivo dizer a resposta em vez de eu adivinhar.
CREATE OR REPLACE FUNCTION public.ecd_diagnostico(_importacao_id uuid, _limite int DEFAULT 40)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'importacao', (SELECT jsonb_build_object(
                     'arquivo', i.arquivo_nome, 'periodo_inicio', i.periodo_inicio,
                     'periodo_fim', i.periodo_fim, 'resumo', i.resumo)
                     FROM public.ecd_importacao i WHERE i.id = _importacao_id),
    'totais', (SELECT jsonb_build_object(
                 'contas', count(*),
                 'com_i052', count(*) FILTER (WHERE cod_aglutinacao IS NOT NULL),
                 'com_i051', count(*) FILTER (WHERE cod_referencial IS NOT NULL),
                 'com_pai',  count(*) FILTER (WHERE cod_superior IS NOT NULL
                                                AND btrim(cod_superior) <> ''),
                 'sinteticas', count(*) FILTER (WHERE tipo = 'S'),
                 'classificacao_com_ponto',
                    count(*) FILTER (WHERE position('.' in COALESCE(classificacao,'')) > 0))
                 FROM public.ecd_conta WHERE importacao_id = _importacao_id),
    'origem_da_classificacao',
      (SELECT COALESCE(jsonb_object_agg(o, n), '{}'::jsonb)
         FROM (SELECT COALESCE(classificacao_origem,'(nula)') o, count(*) n
                 FROM public.ecd_conta WHERE importacao_id = _importacao_id
                GROUP BY 1) t),
    -- Uma amostra SEM nome de conta: só a forma dos códigos, que é o que
    -- eu preciso ver. Nada identificável sai daqui.
    'amostra',
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'codigo', codigo, 'pai', cod_superior, 'nivel', nivel, 'tipo', tipo,
                 'i051', cod_referencial, 'i052', cod_aglutinacao,
                 'classificacao', classificacao, 'origem', classificacao_origem,
                 'palavras_no_nome', COALESCE(array_length(public.ecd_palavras(descricao),1),0))
               ORDER BY tipo DESC, codigo), '[]'::jsonb)
         FROM (SELECT * FROM public.ecd_conta
                WHERE importacao_id = _importacao_id
                ORDER BY tipo DESC, codigo LIMIT _limite) x)
  )
  WHERE EXISTS (SELECT 1 FROM public.ecd_importacao i
                 WHERE i.id = _importacao_id AND public.pode_acessar_empresa(i.company_id));
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_diagnostico(uuid, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_diagnostico(uuid, int) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- A CONFERÊNCIA DA VIRADA — comparando com a data certa
-- ============================================================
--
-- O que não fazia sentido: a conferência pegava, para cada conta, a
-- abertura MAIS RECENTE que existisse no sistema, qualquer que fosse a
-- data dela:
--
--     SELECT DISTINCT ON (conta_codigo) ... ORDER BY data_referencia DESC
--
-- Se o ECD cobre 2023 e a empresa tem abertura em 31/12/2024, ele
-- comparava o fechamento de dezembro de 2023 com a abertura de um ano
-- depois. Os números não têm por que bater — e a tela dizia "a virada
-- não fecha" sem dizer contra o quê estava comparando.
--
-- Agora a data é escolhida de propósito e SAI NA RESPOSTA:
--
--   data_virada   = último dia do último mês do ECD (o fim do que ele cobre)
--   data_abertura = a abertura do sistema mais próxima DEPOIS dessa data
--
-- E se não existir abertura nenhuma depois da virada, a conferência diz
-- isso — em vez de comparar com o que achar pela frente. Não ter com o
-- que comparar é uma resposta legítima; comparar com a data errada não.
--
-- A abertura que o PRÓPRIO ECD grava (em `primeiro mês − 1 dia`) fica de
-- fora da escolha: comparar o ECD com ele mesmo daria "bate" sempre.
CREATE OR REPLACE FUNCTION public.ecd_conferencia(_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _company uuid; _r jsonb;
  _ultimo date; _primeiro date; _virada date; _data_abert date;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  SELECT max(competencia), min(competencia) INTO _ultimo, _primeiro
    FROM public.ecd_saldo WHERE importacao_id = _importacao_id;
  _virada := (date_trunc('month', _ultimo) + INTERVAL '1 month - 1 day')::date;

  SELECT min(a.data_referencia) INTO _data_abert
    FROM public.saldos_abertura a
   WHERE a.company_id = _company
     AND a.data_referencia >= _virada
     AND a.data_referencia IS DISTINCT FROM (_primeiro - INTERVAL '1 day')::date;

  RETURN (
  WITH vinc AS (
    SELECT d.conta_codigo, d.conta_padrao_codigo, d.ignorada
      FROM public.depara_contas d
     WHERE d.tenant_id = _tenant AND d.company_id = _company
  ),
  por_periodo AS (
    SELECT s.competencia,
           count(*)                                                  AS contas,
           count(*) FILTER (WHERE v.conta_padrao_codigo IS NOT NULL)  AS vinculadas,
           count(*) FILTER (WHERE COALESCE(v.ignorada,false))         AS ignoradas,
           sum(s.debitos)                                            AS debitos,
           sum(s.creditos)                                           AS creditos,
           sum(CASE WHEN v.conta_padrao_codigo IS NULL AND NOT COALESCE(v.ignorada,false)
                    THEN abs(s.debitos) + abs(s.creditos) ELSE 0 END) AS movimento_sem_vinculo
      FROM public.ecd_saldo s
      LEFT JOIN vinc v ON v.conta_codigo = s.codigo
     WHERE s.importacao_id = _importacao_id
     GROUP BY s.competencia
  ),
  ecd_fim AS (
    SELECT v.conta_padrao_codigo AS codigo, sum(s.saldo_final) AS saldo
      FROM public.ecd_saldo s
      JOIN vinc v ON v.conta_codigo = s.codigo AND v.conta_padrao_codigo IS NOT NULL
     WHERE s.importacao_id = _importacao_id AND s.competencia = _ultimo
     GROUP BY 1
  ),
  abert AS (
    -- Uma data só, escolhida acima. Sem `_data_abert` não há com o que
    -- comparar, e a lista sai vazia de propósito.
    SELECT a.conta_codigo AS codigo, sum(a.saldo) AS saldo
      FROM public.saldos_abertura a
     WHERE a.company_id = _company
       AND _data_abert IS NOT NULL
       AND a.data_referencia = _data_abert
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'ultimo_periodo', _ultimo,
    'periodos', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'competencia', competencia, 'contas', contas,
                    'vinculadas', vinculadas, 'ignoradas', ignoradas,
                    'debitos', debitos, 'creditos', creditos,
                    'movimento_sem_vinculo', movimento_sem_vinculo)
                    ORDER BY competencia), '[]'::jsonb) FROM por_periodo),
    'virada', (SELECT jsonb_build_object(
                 'data_virada',   _virada,
                 'data_abertura', _data_abert,
                 -- Quando isto é verdadeiro, "0 diferem" não quer dizer
                 -- que fechou: quer dizer que não havia com o que fechar.
                 'sem_referencia', (_data_abert IS NULL),
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
                      ORDER BY abs(e2.saldo - a2.saldo) DESC
                      LIMIT 10) x), '[]'::jsonb))
               FROM ecd_fim e FULL JOIN abert a ON a.codigo = e.codigo)
  ));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_conferencia(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_conferencia(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
