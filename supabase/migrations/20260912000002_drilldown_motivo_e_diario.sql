-- ============================================================
-- AJUSTE 39 — a linha agregada passa a dizer a verdade
-- ============================================================
--
-- "Histórico sempre contém 'Movimento do mês (ECD sem partidas no
--  arquivo)'"
--
-- A gaveta abriu — essa parte funcionou. Mas o texto que ela mostra é uma
-- CONCLUSÃO que eu não tinha como tirar: "sem partidas no arquivo".
--
-- O que o banco sabe é outra coisa: que não existe lançamento gravado
-- para aquela conta naquele mês. As causas são duas e são bem diferentes:
--
--   · o ECD foi importado ANTES do ajuste 37 e o diário nunca foi lido
--     (o arquivo pode estar cheio de I200/I250) — e a saída é apertar
--     "Reler o arquivo" no painel do ECD;
--   · o diário foi lido e aquela conta realmente não tem partida no mês.
--
-- Dizer a primeira com o texto da segunda manda você procurar defeito no
-- arquivo quando o que falta é um clique. Agora a função devolve o
-- motivo, e a tela escreve o que é.

DROP FUNCTION IF EXISTS public.drilldown_saldo_mensal(uuid, text[], date, date);

CREATE OR REPLACE FUNCTION public.drilldown_saldo_mensal(
  _company_id uuid,
  _codigos text[],
  _competencia_min date,
  _competencia_max date
)
RETURNS TABLE (
  conta_codigo text,
  competencia  date,
  debito       numeric,
  credito      numeric,
  do_ecd       boolean,
  motivo       text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT sm.conta_codigo, sm.competencia,
         sm.total_debitos, sm.total_creditos,
         sm.origem_ecd IS NOT NULL,
         CASE
           WHEN sm.origem_ecd IS NULL THEN 'sem_diario'
           -- A importação que gerou este saldo tem diário gravado?
           WHEN EXISTS (SELECT 1 FROM public.ecd_lancamento l
                         WHERE l.importacao_id = sm.origem_ecd)
             THEN 'ecd_sem_partida_na_conta'
           ELSE 'ecd_diario_nao_lido'
         END
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

-- ------------------------------------------------------------
-- O estado do diário, por importação
-- ------------------------------------------------------------
-- Para o painel do ECD parar de esconder o número que importa. Hoje ele
-- diz "N contas, M meses" e nada sobre o diário — que é justamente o que
-- decide se o drill-down mostra partida ou só o total do mês.
CREATE OR REPLACE FUNCTION public.ecd_estado_diario(_importacao_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'lidos', (SELECT count(*) FROM public.ecd_lancamento l
               WHERE l.importacao_id = _importacao_id),
    'materializados', (
      SELECT COALESCE(sum(u.total_lancamentos), 0)
        FROM public.diario_uploads u
        JOIN public.ecd_importacao i ON i.id = _importacao_id
       WHERE u.company_id = i.company_id
         AND u.filename = 'ECD: ' || i.arquivo_nome),
    'contas_com_partida', (SELECT count(DISTINCT l.codigo)
                             FROM public.ecd_lancamento l
                            WHERE l.importacao_id = _importacao_id))
   WHERE EXISTS (SELECT 1 FROM public.ecd_importacao i
                  WHERE i.id = _importacao_id
                    AND public.pode_acessar_empresa(i.company_id));
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_estado_diario(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_estado_diario(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
