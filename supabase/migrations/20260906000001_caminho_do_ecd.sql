-- ============================================================
-- AJUSTE 32 — o galho do ECD, quando não existe código estrutural
-- ============================================================
--
-- O QUE O SEU ARQUIVO PROVOU
--
-- O `psql` que você rodou respondeu a pergunta de vez:
--
--     codigo | cod_superior | classificacao | origem     | cod_aglutinacao
--     -------+--------------+---------------+------------+----------------
--     1      |              | 1             | hierarquia |
--     149    |              | 149           | hierarquia |
--     150    | 149          | 149.150       | hierarquia |
--     2      | 1            | 1.2           | hierarquia |
--     242    | 149          | 149.242       | hierarquia |
--
-- Três fatos, e os três importam:
--
--   1. `cod_aglutinacao` vazio em tudo  → não há I052 no arquivo.
--   2. `origem = hierarquia` em tudo    → não há I051 tampouco.
--   3. As RAÍZES são 1, 149, 269, 402, 460 — números reduzidos, sem pai.
--      Num ECD que traz código estrutural, a raiz do ativo é "1" e a
--      filha é "1.01". Aqui a filha de 149 é 150. O arquivo NUMERA AS
--      CONTAS EM SEQUÊNCIA, do começo ao fim do plano, e não usa
--      estrutural em nível nenhum.
--
-- Ou seja: "149.150" não é a conta estrutural do seu plano. É um texto
-- que EU montei colando o código do pai no do filho, e depois mostrei
-- na tela com cara de código de plano de contas. Isso é pior do que não
-- mostrar nada — você pediu a estrutural três vezes e três vezes eu
-- devolvi a mesma invenção com nome diferente.
--
-- Este ajuste para de inventar.
--
-- O QUE ENTRA NO LUGAR
--
-- A hierarquia do arquivo é boa: `cod_superior` está preenchido, são 5
-- raízes, a árvore fecha. O que falta é NOME nos degraus. Então a mesma
-- cadeia que produzia "149.150" passa a produzir também:
--
--     ATIVO › ATIVO IMOBILIZADO › MAQUINAS E EQUIPAMENTOS
--
-- É a mesma informação que a estrutural daria — de que galho a conta é —
-- só que legível, e vinda do arquivo em vez de dedução. É por ela que a
-- tela agrupa e é ela que você lê para decidir o lote.
--
-- E quando o ECD TROUXER estrutural (I052, I051, ou I050 com código
-- pontuado), nada disto muda o que já funcionava: a estrutural continua
-- ganhando, com a origem carimbada. As duas convivem.

-- ------------------------------------------------------------
-- 1) As colunas novas
-- ------------------------------------------------------------
ALTER TABLE public.ecd_conta
  ADD COLUMN IF NOT EXISTS caminho_codigos text,
  ADD COLUMN IF NOT EXISTS caminho_nomes   text,
  ADD COLUMN IF NOT EXISTS profundidade    int;

COMMENT ON COLUMN public.ecd_conta.caminho_codigos IS
  'Cadeia de códigos do I050, da raiz até esta conta ("149.150"). '
  'É DEDUÇÃO: só vira classificação quando o arquivo usa código '
  'estrutural de verdade. Fica aqui para diagnóstico.';
COMMENT ON COLUMN public.ecd_conta.caminho_nomes IS
  'Cadeia de NOMES pela mesma hierarquia, separada por " > ". '
  'É o galho da conta em linguagem de gente — serve quando o arquivo '
  'não traz código estrutural nenhum.';
COMMENT ON COLUMN public.ecd_conta.profundidade IS
  'Quantos degraus da raiz até esta conta, contados pela cadeia real.';

-- A origem ganha um valor novo: 'reduzido'.
COMMENT ON COLUMN public.ecd_conta.classificacao_origem IS
  'De onde veio a classificação: i052 | i051 | hierarquia | reduzido | codigo. '
  '"reduzido" = o arquivo não tem código estrutural em lugar nenhum, '
  'então a classificação é o próprio código e o galho vive em '
  'caminho_nomes.';

-- ------------------------------------------------------------
-- 2) Classificar sem inventar
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ecd_classificar(_importacao_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _n int := 0;
  _tem_estrutural boolean;
BEGIN
  -- O teste que faltava. O arquivo tem código estrutural em ALGUM lugar?
  --
  --   · I052 ou I051 em qualquer conta                     → tem
  --   · algum COD_CTA com ponto ("1.01.01.1.0001")         → tem
  --   · só números soltos (119, 406, 748) e mais nada      → NÃO tem
  --
  -- Sem esta pergunta, o `caminho` da hierarquia era promovido a
  -- classificação sempre — e num arquivo de códigos reduzidos isso
  -- fabrica "149.150", que não existe em documento nenhum.
  SELECT EXISTS (
    SELECT 1 FROM public.ecd_conta c
     WHERE c.importacao_id = _importacao_id
       AND (c.cod_aglutinacao IS NOT NULL
         OR c.cod_referencial IS NOT NULL
         OR position('.' in c.codigo) > 0)
  ) INTO _tem_estrutural;

  -- ---------- a cadeia: códigos, nomes e profundidade ----------
  WITH RECURSIVE arvore AS (
    -- Raízes: sem pai, com pai que não existe no arquivo (ECD parcial),
    -- ou filha de si mesma (acontece).
    SELECT c.codigo,
           c.codigo::text                    AS caminho,
           COALESCE(btrim(c.descricao), c.codigo) AS nomes,
           1                                 AS profundidade
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
             -- O filho já traz o caminho inteiro (ECD com estrutural em
             -- tudo): não concatena, senão vira "1.01.1.01.01".
             WHEN left(f.codigo, length(a.caminho) + 1) = a.caminho || '.'
               THEN f.codigo
             ELSE a.caminho || '.' || f.codigo
           END,
           a.nomes || ' > ' || COALESCE(btrim(f.descricao), f.codigo),
           a.profundidade + 1
      FROM public.ecd_conta f
      JOIN arvore a ON a.codigo = f.cod_superior
     WHERE f.importacao_id = _importacao_id
       AND a.profundidade < 15   -- trava contra ciclo
       AND f.codigo <> a.codigo
  )
  UPDATE public.ecd_conta c
     SET caminho_codigos = a.caminho,
         caminho_nomes   = a.nomes,
         profundidade    = a.profundidade
    FROM arvore a
   WHERE c.importacao_id = _importacao_id
     AND c.codigo = a.codigo
     AND (c.caminho_codigos IS DISTINCT FROM a.caminho
       OR c.caminho_nomes   IS DISTINCT FROM a.nomes
       OR c.profundidade    IS DISTINCT FROM a.profundidade);
  GET DIAGNOSTICS _n = ROW_COUNT;

  -- O que a recursão não alcançou (um ciclo A→B→A) fica com o próprio
  -- nome: um galho de um degrau só, em vez de nulo.
  UPDATE public.ecd_conta
     SET caminho_codigos = COALESCE(caminho_codigos, codigo),
         caminho_nomes   = COALESCE(caminho_nomes, btrim(descricao), codigo),
         profundidade    = COALESCE(profundidade, 1)
   WHERE importacao_id = _importacao_id
     AND (caminho_codigos IS NULL OR caminho_nomes IS NULL OR profundidade IS NULL);

  -- ---------- classificação, da fonte mais confiável para a menos ----------

  -- (a) O que o arquivo DIZ. Nada aqui é dedução.
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

  IF _tem_estrutural THEN
    -- (b) O arquivo usa estrutural em algum nível: colar a cadeia
    -- reconstrói o código de verdade. Aqui a dedução é legítima.
    UPDATE public.ecd_conta
       SET classificacao = caminho_codigos, classificacao_origem = 'hierarquia'
     WHERE importacao_id = _importacao_id
       AND cod_aglutinacao IS NULL
       AND cod_referencial IS NULL
       AND caminho_codigos IS NOT NULL
       AND (classificacao IS DISTINCT FROM caminho_codigos
         OR classificacao_origem IS DISTINCT FROM 'hierarquia');
  ELSE
    -- (c) O arquivo é todo de código reduzido. Colar 149 com 150 não
    -- produz classificação nenhuma — produz um número que parece uma.
    -- A classificação passa a ser o que a conta REALMENTE tem: o próprio
    -- código. O galho continua disponível, por nome, em caminho_nomes.
    UPDATE public.ecd_conta
       SET classificacao = codigo, classificacao_origem = 'reduzido'
     WHERE importacao_id = _importacao_id
       AND cod_aglutinacao IS NULL
       AND cod_referencial IS NULL
       AND (classificacao IS DISTINCT FROM codigo
         OR classificacao_origem IS DISTINCT FROM 'reduzido');
  END IF;

  -- (d) Rede de segurança: nada fica sem classificação.
  UPDATE public.ecd_conta
     SET classificacao = codigo, classificacao_origem = 'codigo'
   WHERE importacao_id = _importacao_id
     AND classificacao IS NULL;

  RETURN _n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_classificar(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_classificar(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) A forma do arquivo, em uma resposta
-- ------------------------------------------------------------
-- Para a tela dizer, em uma linha e sem download nenhum, qual dos casos
-- é o do arquivo carregado. Três vezes eu pedi diagnóstico por arquivo;
-- isto responde antes de você perguntar.
CREATE OR REPLACE FUNCTION public.ecd_forma(_importacao_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'contas',        count(*),
    'com_i052',      count(*) FILTER (WHERE cod_aglutinacao IS NOT NULL),
    'com_i051',      count(*) FILTER (WHERE cod_referencial IS NOT NULL),
    'com_pai',       count(*) FILTER (WHERE cod_superior IS NOT NULL
                                        AND btrim(cod_superior) <> ''),
    'codigo_pontuado', count(*) FILTER (WHERE position('.' in codigo) > 0),
    'profundidade_max', COALESCE(max(profundidade), 0),
    -- A conclusão, para a tela não ter que remontá-la:
    --   i052 / i051 / hierarquia → tem estrutural
    --   reduzido                 → não tem, e o galho é por nome
    'origem', (SELECT COALESCE(jsonb_object_agg(o, n), '{}'::jsonb)
                 FROM (SELECT COALESCE(classificacao_origem,'(nula)') o, count(*) n
                         FROM public.ecd_conta
                        WHERE importacao_id = _importacao_id
                        GROUP BY 1) t))
    FROM public.ecd_conta
   WHERE importacao_id = _importacao_id
     AND EXISTS (SELECT 1 FROM public.ecd_importacao i
                  WHERE i.id = _importacao_id
                    AND public.pode_acessar_empresa(i.company_id));
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_forma(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_forma(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) Reclassifica o que já está carregado
-- ------------------------------------------------------------
-- Sem isto o ajuste não vale para a importação que está na sua tela —
-- foi exatamente o erro do ajuste 30, e não se repete.
DO $do$
DECLARE _imp uuid; _t int := 0;
BEGIN
  FOR _imp IN SELECT id FROM public.ecd_importacao LOOP
    _t := _t + public.ecd_classificar(_imp);
  END LOOP;
  RAISE NOTICE 'ecd_classificar: % conta(s) com caminho recalculado', _t;
END;
$do$;

NOTIFY pgrst, 'reload schema';
