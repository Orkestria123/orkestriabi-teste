-- ============================================================
-- AJUSTE 23 — a exportação da DFC dava timeout
-- ============================================================
--
-- Sintoma medido no banco do escritório:
--   dfc_exportar → "canceling statement due to statement timeout"
--
-- A função existe e está correta. O problema é tempo: no plano com
-- 135.792 contas ela passava do limite de 8 s do servidor.
--
-- Duas causas, as duas medidas:
--
-- 1. BUSCA DO PREFIXO MAIS LONGO. Para descobrir de qual classificação
--    cada uma herda o código, a consulta comparava cada classificação
--    com TODAS as do mapa, com operações de texto:
--
--        left(g.classificacao, length(x.classificacao)+1) = x.classificacao || '.'
--
--    São ~500 × ~500 comparações de string. Aqui isso custava 198 ms; num
--    Docker mais lento, muito mais.
--
--    A troca: em vez de procurar quem é prefixo, GERAR os ancestrais de
--    cada classificação ('1.01.02.03' → '1', '1.01', '1.01.02',
--    '1.01.02.03') e casar por IGUALDADE. São no máximo ~7 chaves por
--    linha, resolvidas por hash. Sai de N×M comparações de texto para
--    N×profundidade buscas exatas.
--
-- 2. PLANO GENÉRICO. O corpo da consulta roda em 209 ms escrito à mão e
--    em 2,26 s dentro da função — os mesmos dados, o mesmo SQL. É o
--    planejador escolhendo pior quando os valores chegam por parâmetro.
--
--    A troca: `AS MATERIALIZED` em cada passo, o que obriga o
--    planejador a calcular uma vez e reaproveitar, em vez de reavaliar
--    dentro do laço. (Tabela temporária resolveria também, mas exigiria
--    marcar a função como VOLATILE — `STABLE` não permite CREATE TABLE.)
--
-- Nada muda no RESULTADO — só no tempo. As colunas, os valores e a
-- regra de precedência continuam iguais.

DROP FUNCTION IF EXISTS public.dfc_efetivo(uuid, uuid, boolean);

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
  -- A regra de resolução vem INLINE, não pela função `dfc_resolucao`.
  --
  -- Medido: `grupo` sozinho custa 72 ms e `dfc_resolucao` sozinha 76 ms,
  -- mas as duas na mesma consulta davam 2,2 s. A fronteira da função
  -- esconde o custo do planejador, que passa a reexecutá-la. Trazendo o
  -- corpo para cá ele enxerga tudo e resolve numa passada.
  --
  -- `dfc_resolucao` continua existindo e é a mesma regra — o motor da
  -- DFC (`dfc_mapa`) segue usando ela.
  WITH vin AS MATERIALIZED (
    SELECT DISTINCT ON (v.classificacao)
           v.classificacao, v.codigo_dfc, v.origem
      FROM public.dfc_vinculo v
     WHERE v.tenant_id = _tenant_id
       AND (v.company_id IS NULL OR v.company_id = _company_id)
     ORDER BY v.classificacao, (v.company_id IS NOT NULL) DESC
  ),
  cta AS MATERIALIZED (
    SELECT p.classificacao,
           min(p.dfc_codigo)                AS codigo_dfc,
           count(DISTINCT p.dfc_codigo) > 1 AS ambiguo
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM _company_id
       AND p.dfc_codigo IS NOT NULL
       AND p.ativo
     GROUP BY p.classificacao
  ),
  res AS MATERIALIZED (
    SELECT v.classificacao, v.codigo_dfc, v.origem, false AS ambiguo
      FROM vin v
    UNION ALL
    -- o código gravado na conta só vale onde NENHUM vínculo cobre
    SELECT c.classificacao, c.codigo_dfc, 'conta', c.ambiguo
      FROM cta c
     WHERE NOT EXISTS (
       SELECT 1 FROM vin v
        WHERE c.classificacao = v.classificacao
           OR left(c.classificacao, length(v.classificacao) + 1) = v.classificacao || '.')
  ),
  grupo AS MATERIALIZED (
    SELECT e.classificacao,
           COALESCE(min(e.descricao) FILTER (WHERE e.is_sintetica),
                    min(e.descricao))                             AS descricao,
           count(*)::int                                          AS contas,
           count(*) FILTER (WHERE NOT e.is_sintetica)::int         AS analiticas,
           count(*) FILTER (WHERE m.conta_codigo IS NOT NULL)::int AS com_movimento
      FROM (
        SELECT p.classificacao, p.codigo, p.descricao, p.is_sintetica
          FROM public.plano_contas p
         WHERE p.tenant_id = _tenant_id
           AND p.company_id IS NOT DISTINCT FROM _company_id
           AND p.ativo
           AND (NOT _somente_balanco OR left(p.classificacao, 1) IN ('1', '2'))
      ) e
      LEFT JOIN (
        SELECT DISTINCT s.conta_codigo
          FROM public.saldos_mensais s
         WHERE s.tenant_id = _tenant_id
           AND (_company_id IS NULL OR s.company_id = _company_id)
      ) m ON m.conta_codigo = e.codigo
     GROUP BY e.classificacao
  ),
  -- ancestrais de cada classificação: '1.01.02' -> '1', '1.01', '1.01.02'
  anc AS MATERIALIZED (
    SELECT g.classificacao,
           a.pos,
           array_to_string((string_to_array(g.classificacao, '.'))[1:a.pos], '.') AS ancestral
      FROM grupo g
      CROSS JOIN LATERAL generate_series(
        1, COALESCE(array_length(string_to_array(g.classificacao, '.'), 1), 1)) AS a(pos)
  ),
  -- o ancestral mais PROFUNDO com código é o prefixo mais longo
  escolhido AS MATERIALIZED (
    SELECT DISTINCT ON (an.classificacao)
           an.classificacao,
           r.classificacao AS cls_vinculo,
           r.codigo_dfc,
           r.origem,
           r.ambiguo
      FROM anc an
      JOIN res r ON r.classificacao = an.ancestral
     ORDER BY an.classificacao, an.pos DESC
  )
  SELECT g.classificacao,
         g.descricao,
         g.contas,
         g.analiticas,
         g.com_movimento,
         e.codigo_dfc,
         cat.descricao,
         cat.bloco,
         e.cls_vinculo,
         CASE WHEN e.cls_vinculo IS NULL           THEN 'sem alocação'
              WHEN e.cls_vinculo = g.classificacao THEN e.origem
              ELSE 'herdado' END,
         COALESCE(e.ambiguo, false)
    FROM grupo g
    LEFT JOIN escolhido e ON e.classificacao = g.classificacao
    LEFT JOIN public.dfc_catalogo cat ON cat.codigo = e.codigo_dfc
   ORDER BY g.classificacao;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_efetivo(uuid, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_efetivo(uuid, uuid, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
