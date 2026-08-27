-- ============================================================
-- AJUSTE 27 — a classificação estrutural das contas do ECD
-- ============================================================
--
-- A tela mostrava só o COD_CTA do I050, que na maioria dos ECD é o
-- CÓDIGO REDUZIDO da conta analítica ("0001", "1094"). Sozinho ele não
-- diz nada: não dá para saber se aquela conta é banco, cliente ou
-- despesa sem abrir o nome.
--
-- A classificação estrutural ("1.01.01.1.0001") não vem num campo
-- próprio do I050 — ela está na HIERARQUIA. O registro traz
-- COD_CTA_SUP, e as contas sintéticas costumam carregar o código
-- estrutural; a analítica pendura o reduzido embaixo. Andando a cadeia
-- de pais e juntando os pedaços, a estrutural reaparece:
--
--     I050 ... |S|1|1|      |ATIVO                 →  1
--     I050 ... |S|2|1.01|1  |ATIVO CIRCULANTE      →  1.01
--     I050 ... |S|3|1.01.01|1.01|DISPONIVEL        →  1.01.01
--     I050 ... |S|4|1.01.01.1|1.01.01|CAIXA        →  1.01.01.1
--     I050 ... |A|5|0001|1.01.01.1|CAIXA GERAL     →  1.01.01.1.0001
--                    ^^^^ é isto que a tela mostrava sozinho
--
-- Duas regras, e as duas importam:
--
--   1. Se o código do filho JÁ COMEÇA com o caminho do pai seguido de
--      ponto, ele já é o caminho inteiro — não concatena (senão o ECD
--      que usa código estrutural em tudo viraria "1.01.1.01.01").
--   2. Senão, caminho do pai + "." + código do filho.
--
-- Fica gravado em `ecd_conta.classificacao` por um gatilho, então vale
-- para as importações que já estão no banco (o backfill no fim) e para
-- as próximas, sem mexer em `ecd_importar`.

ALTER TABLE public.ecd_conta
  ADD COLUMN IF NOT EXISTS classificacao text;

COMMENT ON COLUMN public.ecd_conta.classificacao IS
  'Classificação estrutural derivada da cadeia COD_CTA_SUP do I050. '
  'Quando a hierarquia do arquivo não permite deduzi-la, recebe o '
  'próprio código da conta — nunca fica nula depois de classificada.';

-- ------------------------------------------------------------
-- Recalcula a classificação de UMA importação.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ecd_classificar(_importacao_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _n int := 0;
BEGIN
  WITH RECURSIVE arvore AS (
    -- Raízes: sem pai, ou com um pai que não existe no arquivo (acontece
    -- em ECD parcial). Sem este segundo caso, a subárvore inteira ficava
    -- de fora e a classificação vinha nula sem explicação.
    SELECT c.codigo,
           c.codigo::text AS caminho,
           1               AS profundidade
      FROM public.ecd_conta c
     WHERE c.importacao_id = _importacao_id
       AND (
         c.cod_superior IS NULL
         OR btrim(c.cod_superior) = ''
         -- Conta que se declara filha de si mesma: acontece, e sem esta
         -- linha ela não é raiz nem filha — ficava sem classificação
         -- nenhuma, em silêncio.
         OR c.cod_superior = c.codigo
         OR NOT EXISTS (
           SELECT 1 FROM public.ecd_conta p
            WHERE p.importacao_id = _importacao_id
              AND p.codigo = c.cod_superior)
       )
    UNION ALL
    SELECT f.codigo,
           CASE
             -- Regra 1: o filho já traz o caminho inteiro.
             WHEN left(f.codigo, length(a.caminho) + 1) = a.caminho || '.'
               THEN f.codigo
             ELSE a.caminho || '.' || f.codigo
           END,
           a.profundidade + 1
      FROM public.ecd_conta f
      JOIN arvore a ON a.codigo = f.cod_superior
     WHERE f.importacao_id = _importacao_id
       -- Trava contra ciclo: um COD_CTA_SUP apontando para si mesmo (ou
       -- um laço) faria a recursão rodar para sempre. 15 níveis é mais
       -- fundo do que qualquer plano real.
       AND a.profundidade < 15
       AND f.codigo <> a.codigo
  )
  UPDATE public.ecd_conta c
     SET classificacao = a.caminho
    FROM arvore a
   WHERE c.importacao_id = _importacao_id
     AND c.codigo = a.codigo
     AND c.classificacao IS DISTINCT FROM a.caminho;
  GET DIAGNOSTICS _n = ROW_COUNT;

  -- Rede de segurança: o que a recursão não alcançou (um ciclo A→B→A,
  -- por exemplo) fica com o próprio código em vez de nulo. A tela então
  -- mostra exatamente o que mostrava antes deste ajuste — nada piora.
  UPDATE public.ecd_conta
     SET classificacao = codigo
   WHERE importacao_id = _importacao_id
     AND classificacao IS NULL;

  RETURN _n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_classificar(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_classificar(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Gatilho: toda carga nova já nasce classificada.
-- ------------------------------------------------------------
-- Por que gatilho e não uma linha dentro de `ecd_importar`: aquela
-- função tem 200 linhas e funciona. Mexer nela para acrescentar uma
-- chamada é risco desnecessário — o gatilho faz o mesmo e vale também
-- para qualquer outro caminho que venha a inserir contas.
CREATE OR REPLACE FUNCTION public.ecd_conta_classificar_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $tg$
DECLARE _imp uuid;
BEGIN
  FOR _imp IN SELECT DISTINCT importacao_id FROM novas LOOP
    PERFORM public.ecd_classificar(_imp);
  END LOOP;
  RETURN NULL;
END;
$tg$;

DROP TRIGGER IF EXISTS ecd_conta_classificar ON public.ecd_conta;
CREATE TRIGGER ecd_conta_classificar
  AFTER INSERT ON public.ecd_conta
  REFERENCING NEW TABLE AS novas
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.ecd_conta_classificar_tg();

-- ------------------------------------------------------------
-- Backfill do que já está carregado.
-- ------------------------------------------------------------
DO $do$
DECLARE _imp uuid; _t int := 0; _n int;
BEGIN
  FOR _imp IN SELECT id FROM public.ecd_importacao LOOP
    _n := public.ecd_classificar(_imp);
    _t := _t + _n;
  END LOOP;
  RAISE NOTICE 'ecd_classificar: % conta(s) classificada(s)', _t;
END;
$do$;

NOTIFY pgrst, 'reload schema';
