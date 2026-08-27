-- ============================================================
-- AJUSTE 41 — a DFC para de carregar cliente e fornecedor
-- ============================================================
--
-- "não dá pra exportar informações da dfc: canceling statement due to
--  statement timeout. E pode ocultar as variações de clientes e
--  fornecedores. Acho que carrega demais e usa muito dados, sendo que a
--  variação é simples calculável pela sintética."
--
-- Está certo, e o número é feio. No plano do escritório:
--
--     135.132 contas de 135.757 têm `dfc_codigo` gravado
--
-- Isso é herança do `aplicar_dfc_padrao` antigo, que gravava o código
-- conta a conta — as 206 mil de cliente e fornecedor inclusive. O ajuste
-- 15 aposentou esse caminho (o vínculo por classificação ganha do código
-- gravado na conta), mas as linhas ficaram lá.
--
-- E `dfc_exportar_contas` — a aba de EXCEÇÕES da planilha — varre todas
-- elas:
--
--     FROM plano_contas p JOIN suspeitas s ON s.classificacao = ...
--     WHERE p.dfc_codigo IS NOT NULL
--     ORDER BY p.classificacao, p.codigo
--     LIMIT 1000
--
-- Ordena 135 mil linhas para devolver 1.000. Aqui, com 135 mil contas:
-- 1.451 ms. No seu banco, com 206 mil e mais movimento: o timeout.
--
-- ------------------------------------------------------------
-- A correção é a que você descreveu
-- ------------------------------------------------------------
-- Participante sai das duas consultas. Não se perde nada, e a razão é
-- exatamente a sua: os 182.671 clientes dividem UMA classificação
-- (1.01.02.01.01.01) e recebem todos o mesmo código por herança. Uma
-- "exceção" numa conta de cliente não existe como conceito — não há o
-- que conferir linha a linha.
--
-- E a contagem também não se perde: a AGREGADORA de cada classificação
-- (`AGG-...`, criada no ajuste 34) não é participante, continua na
-- consulta, e é ela que carrega o saldo consolidado. A variação de
-- clientes e de fornecedores sai dela — que é a sintética, como você
-- disse.

-- ------------------------------------------------------------
-- 1) A aba de exceções para de varrer o cadastro
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dfc_exportar_contas(
  _tenant_id uuid, _company_id uuid DEFAULT NULL, _limite int DEFAULT 5000)
RETURNS TABLE (
  codigo text, classificacao text, descricao text,
  codigo_na_conta text, codigo_efetivo text, em_vigor boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _alvo uuid;
BEGIN
  IF NOT public.pode_tenant(_tenant_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  _alvo := CASE
    WHEN _company_id IS NULL THEN NULL
    WHEN COALESCE((public.escopo_plano_empresa(_company_id)->>'usa_plano_padrao')::boolean,
                  false) THEN NULL
    ELSE _company_id END;

  RETURN QUERY
  WITH res AS MATERIALIZED (SELECT * FROM public.dfc_resolucao(_tenant_id, _alvo)),
  suspeitas AS (
    SELECT r.classificacao, r.codigo_dfc, r.ambiguo
      FROM res r WHERE r.ambiguo OR r.origem <> 'conta'
  )
  SELECT p.codigo, p.classificacao, p.descricao, p.dfc_codigo, s.codigo_dfc,
         s.codigo_dfc IS NOT DISTINCT FROM p.dfc_codigo
    FROM public.plano_contas p
    JOIN suspeitas s ON s.classificacao = p.classificacao
   WHERE p.tenant_id = _tenant_id
     AND p.company_id IS NOT DISTINCT FROM _alvo
     AND p.dfc_codigo IS NOT NULL
     AND p.ativo
     -- A LINHA QUE FALTAVA. Cliente e fornecedor fora: eles dividem uma
     -- classificação só e herdam todos o mesmo código. "Exceção" em
     -- conta de participante não é um conceito — e são elas as 200 mil.
     AND NOT COALESCE(p.is_participante, false)
     AND s.codigo_dfc IS DISTINCT FROM p.dfc_codigo
   ORDER BY p.classificacao, p.codigo
   LIMIT least(_limite, 1000);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_exportar_contas(uuid, uuid, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_exportar_contas(uuid, uuid, int) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2) A planilha principal também
-- ------------------------------------------------------------
-- Aqui o participante entrava em `grupo_plano` só para ser contado —
-- 206 mil linhas agrupadas para produzir ~90. A agregadora fica, então a
-- classificação continua aparecendo, com a contagem e o movimento dela.
CREATE OR REPLACE FUNCTION public.dfc_efetivo_escopo(
  _tenant_id uuid,
  _escopo_plano uuid,
  _company_mov uuid,
  _somente_balanco boolean DEFAULT true
)
RETURNS TABLE (
  classificacao text, descricao text, contas int, analiticas int, com_movimento int,
  codigo_dfc text, descricao_dfc text, bloco text,
  classificacao_vinculo text, origem text, ambiguo boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH vin AS MATERIALIZED (
    SELECT DISTINCT ON (v.classificacao)
           v.classificacao, v.codigo_dfc, v.origem, v.company_id
      FROM public.dfc_vinculo v
     WHERE v.tenant_id = _tenant_id
       AND (v.company_id IS NULL OR v.company_id = _escopo_plano)
     ORDER BY v.classificacao, (v.company_id IS NOT NULL) DESC
  ),
  cta AS MATERIALIZED (
    SELECT p.classificacao,
           min(p.dfc_codigo)                AS codigo_dfc,
           count(DISTINCT p.dfc_codigo) > 1 AS ambiguo
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM _escopo_plano
       AND p.dfc_codigo IS NOT NULL
       AND p.ativo
       AND NOT COALESCE(p.is_participante, false)   -- idem
     GROUP BY p.classificacao
  ),
  res AS MATERIALIZED (
    SELECT v.classificacao, v.codigo_dfc, v.origem, false AS ambiguo
      FROM vin v
    UNION ALL
    SELECT c.classificacao, c.codigo_dfc, 'conta', c.ambiguo
      FROM cta c
     WHERE NOT EXISTS (
       SELECT 1 FROM vin v
        WHERE c.classificacao = v.classificacao
           OR left(c.classificacao, length(v.classificacao) + 1) = v.classificacao || '.')
  ),
  grupo_plano AS MATERIALIZED (
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
           AND p.company_id IS NOT DISTINCT FROM _escopo_plano
           AND p.ativo
           AND NOT COALESCE(p.is_participante, false)
           AND (NOT _somente_balanco OR left(p.classificacao, 1) IN ('1', '2'))
        UNION ALL
        SELECT p.classificacao, p.codigo, p.descricao, p.is_sintetica
          FROM public.plano_contas p
          JOIN vin v ON v.classificacao = p.classificacao
         WHERE _somente_balanco
           AND p.tenant_id = _tenant_id
           AND p.company_id IS NOT DISTINCT FROM _escopo_plano
           AND p.ativo
           AND NOT COALESCE(p.is_participante, false)
           AND left(p.classificacao, 1) NOT IN ('1', '2')
      ) e
      LEFT JOIN (
        SELECT DISTINCT s.conta_codigo
          FROM public.saldos_mensais s
         WHERE s.tenant_id = _tenant_id
           AND (_company_mov IS NULL OR s.company_id = _company_mov)
      ) m ON m.conta_codigo = e.codigo
     GROUP BY e.classificacao
  ),
  grupo AS MATERIALIZED (
    SELECT * FROM grupo_plano
    UNION ALL
    SELECT v.classificacao, '(sem conta no plano)'::text, 0, 0, 0
      FROM vin v
     WHERE NOT EXISTS (SELECT 1 FROM grupo_plano g WHERE g.classificacao = v.classificacao)
       AND v.company_id IS NOT DISTINCT FROM _escopo_plano
  ),
  anc AS MATERIALIZED (
    SELECT g.classificacao, a.pos,
           array_to_string((string_to_array(g.classificacao, '.'))[1:a.pos], '.') AS ancestral
      FROM grupo g
      CROSS JOIN LATERAL generate_series(
        1, COALESCE(array_length(string_to_array(g.classificacao, '.'), 1), 1)) AS a(pos)
  ),
  escolhido AS MATERIALIZED (
    SELECT DISTINCT ON (an.classificacao)
           an.classificacao, r.classificacao AS cls_vinculo,
           r.codigo_dfc, r.origem, r.ambiguo
      FROM anc an
      JOIN res r ON r.classificacao = an.ancestral
     ORDER BY an.classificacao, an.pos DESC
  )
  SELECT g.classificacao, g.descricao, g.contas, g.analiticas, g.com_movimento,
         e.codigo_dfc, cat.descricao, cat.bloco, e.cls_vinculo,
         CASE WHEN e.cls_vinculo IS NULL           THEN 'sem alocação'
              WHEN e.cls_vinculo = g.classificacao THEN e.origem
              ELSE 'herdado' END,
         COALESCE(e.ambiguo, false)
    FROM grupo g
    LEFT JOIN escolhido e ON e.classificacao = g.classificacao
    LEFT JOIN public.dfc_catalogo cat ON cat.codigo = e.codigo_dfc
   ORDER BY g.classificacao;
$fn$;

REVOKE EXECUTE ON FUNCTION public.dfc_efetivo_escopo(uuid, uuid, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.dfc_efetivo_escopo(uuid, uuid, uuid, boolean)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) Índice parcial: as consultas acima passam a ter por onde entrar
-- ------------------------------------------------------------
-- Parcial de propósito. O índice cobre só as ~1.100 estruturais em vez
-- das 206 mil — cabe em memória e serve exatamente ao filtro novo.
CREATE INDEX IF NOT EXISTS idx_plano_contas_estruturais
  ON public.plano_contas (tenant_id, company_id, classificacao)
  WHERE NOT COALESCE(is_participante, false) AND ativo;

ANALYZE public.plano_contas;

NOTIFY pgrst, 'reload schema';
