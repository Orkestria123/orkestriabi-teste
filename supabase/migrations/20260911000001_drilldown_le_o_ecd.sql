-- ============================================================
-- AJUSTE 38 — o drill-down passa a enxergar o lançamento do ECD
-- ============================================================
--
-- "o drill down ainda não lê os lançamentos da ecd"
--
-- O ajuste 37 fez o ECD gravar o diário. Gravou mesmo — e ainda assim a
-- gaveta continuou vazia. O motivo é um detalhe de convenção que eu não
-- tinha visto, e que a minha própria bateria não podia ver:
--
--   `ecd_aplicar` grava com o código do PLANO PADRÃO
--       saldos_mensais.conta_codigo  = depara.conta_padrao_codigo
--       saldos_abertura.conta_codigo = depara.conta_padrao_codigo
--       lancamentos_diario (ECD)     = depara.conta_padrao_codigo
--
--   a carga do diário por CSV grava com o código PRÓPRIO da empresa
--       lancamentos_diario.conta_codigo = o código do arquivo
--
-- Duas convenções na mesma coluna. A leitura das demonstrações tolera as
-- duas por acaso (traduz na leitura, e traduzir um código que já é do
-- plano devolve ele mesmo). O `drilldown_contas`, não:
--
--   JOIN trad tr ON tr.conta_codigo = m.conta_codigo
--
-- `trad.conta_codigo` é o código PRÓPRIO da empresa. O movimento vindo do
-- ECD chega com o código do plano. O JOIN não casa — nunca casou — e a
-- consulta devolve só o que veio de CSV. Empresa que só tem ECD recebe
-- lista vazia (a gaveta não abre); empresa que tem os dois vê o diário
-- do CSV e não vê o do ECD. Foi exatamente o que você viu nos dois casos.
--
-- Por que a bateria do ajuste 37 passou em 16 de 16: ela roda na empresa
-- de teste, que usa o plano padrão direto (`usa_depara` = false) e cai no
-- OUTRO ramo da função — o que compara com o plano sem traduzir. O ramo
-- do de-para, que é o seu, nunca foi exercitado. A bateria desta vez roda
-- nos dois.
--
-- A correção não escolhe uma convenção: aceita as duas. Cada código com
-- movimento é resolvido ou como código próprio (traduzido pelo de-para)
-- ou como código que JÁ É do plano — e o que volta é o código com que a
-- linha está gravada, que é o que a tela usa para buscar o lançamento.

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

  IF NOT _usa_depara THEN
    -- Sem de-para o código do movimento já é o do plano. Inalterado.
    RETURN QUERY
    WITH com_mov AS (
      SELECT DISTINCT l.conta_codigo FROM public.lancamentos_diario l
       WHERE l.company_id = _company_id
         AND (_competencia_min IS NULL OR l.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR l.competencia <= _competencia_max)
      UNION
      SELECT DISTINCT sa.conta_codigo FROM public.saldos_abertura sa
       WHERE sa.company_id = _company_id
      UNION
      SELECT DISTINCT sm.conta_codigo FROM public.saldos_mensais sm
       WHERE sm.company_id = _company_id
         AND (_competencia_min IS NULL OR sm.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR sm.competencia <= _competencia_max)
    )
    SELECT p.codigo, p.descricao, p.classificacao
      FROM com_mov m
      JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _scope
       AND p.codigo = m.conta_codigo
     WHERE p.is_sintetica = false
       AND (p.codigo = _classificacao
            OR p.classificacao = _classificacao
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
      UNION
      SELECT DISTINCT sm.conta_codigo FROM public.saldos_mensais sm
       WHERE sm.company_id = _company_id
         AND (_competencia_min IS NULL OR sm.competencia >= _competencia_min)
         AND (_competencia_max IS NULL OR sm.competencia <= _competencia_max)
    ),
    trad AS (
      SELECT t.conta_codigo, t.conta_padrao_codigo
        FROM public.depara_traducao(_company_id) t
       WHERE NOT t.ignorada AND t.conta_padrao_codigo IS NOT NULL
    ),
    -- Cada código com movimento resolvido para a conta do plano, pelas
    -- duas convenções. `busca` é o código COM QUE A LINHA ESTÁ GRAVADA:
    -- é ele que a tela usa no `.in(conta_codigo, ...)` para trazer o
    -- lançamento. Devolver o outro é o que fazia a gaveta abrir vazia.
    resolvido AS (
      -- 1) código próprio da empresa (diário por CSV, plano próprio)
      SELECT m.conta_codigo AS busca, tr.conta_padrao_codigo AS plano
        FROM com_mov m
        JOIN trad tr ON tr.conta_codigo = m.conta_codigo
      UNION
      -- 2) código que já é do plano padrão — é assim que o ECD grava.
      --    Só onde o de-para NÃO cobre o código, senão a mesma conta
      --    entraria duas vezes.
      SELECT m.conta_codigo, m.conta_codigo
        FROM com_mov m
       WHERE NOT EXISTS (SELECT 1 FROM trad tr WHERE tr.conta_codigo = m.conta_codigo)
         AND EXISTS (
           SELECT 1 FROM public.plano_contas p2
            WHERE p2.tenant_id = _tenant
              AND p2.company_id IS NOT DISTINCT FROM _scope
              AND p2.codigo = m.conta_codigo)
    )
    SELECT r.busca, COALESCE(o.descricao, p.descricao), p.classificacao
      FROM resolvido r
      JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _scope
       AND p.codigo = r.plano
      LEFT JOIN public.plano_contas o
        ON o.tenant_id = _tenant AND o.company_id = _company_id
       AND o.codigo = r.busca
     WHERE p.is_sintetica = false
       AND (p.codigo = _classificacao
            OR p.classificacao = _classificacao
            OR left(p.classificacao, length(_classificacao) + 1) = _classificacao || '.')
     ORDER BY p.classificacao, r.busca;
  END IF;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.drilldown_contas(uuid, text, date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.drilldown_contas(uuid, text, date, date)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- O movimento do mês, quando o arquivo não trouxe partida
-- ------------------------------------------------------------
-- Nem todo ECD traz I200/I250 — e os que você já importou antes do
-- ajuste 37 não têm o diário gravado. Nesses casos a gaveta abre a conta
-- certa e não tem uma linha para mostrar.
--
-- Esta função devolve o movimento AGREGADO do mês para as contas que não
-- têm lançamento no período. A tela mostra como uma linha só, marcada, em
-- vez de dizer "sem lançamentos" para uma conta que claramente moveu.
CREATE OR REPLACE FUNCTION public.drilldown_saldo_mensal(
  _company_id uuid,
  _codigos text[],
  _competencia_min date,
  _competencia_max date
)
RETURNS TABLE (
  conta_codigo text,
  competencia date,
  debito numeric,
  credito numeric,
  do_ecd boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT sm.conta_codigo, sm.competencia,
         sm.total_debitos, sm.total_creditos,
         sm.origem_ecd IS NOT NULL
    FROM public.saldos_mensais sm
   WHERE public.pode_acessar_empresa(_company_id)
     AND sm.company_id = _company_id
     AND sm.conta_codigo = ANY(_codigos)
     AND sm.competencia BETWEEN _competencia_min AND _competencia_max
     AND (sm.total_debitos <> 0 OR sm.total_creditos <> 0)
     -- só onde NÃO existe lançamento: com diário, quem manda é o diário
     AND NOT EXISTS (
       SELECT 1 FROM public.lancamentos_diario l
        WHERE l.company_id = _company_id
          AND l.conta_codigo = sm.conta_codigo
          AND l.competencia = sm.competencia)
   ORDER BY sm.competencia, sm.conta_codigo;
$fn$;

REVOKE EXECUTE ON FUNCTION public.drilldown_saldo_mensal(uuid, text[], date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.drilldown_saldo_mensal(uuid, text[], date, date)
  TO authenticated, service_role;
