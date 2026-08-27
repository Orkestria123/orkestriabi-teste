-- ============================================================
-- AJUSTE 31 — descartar as sugestões automáticas e refazer
-- ============================================================
--
-- O ajuste 30 corrigiu a REGRA, mas não adiantou nada na prática: a
-- sugestão só grava onde ainda não existe vínculo —
--
--     AND NOT EXISTS (SELECT 1 FROM depara_contas d WHERE ...)
--
-- — e isso está certo, é o que impede uma rodada automática de
-- atropelar o que você revisou à mão. Só que as sugestões ERRADAS já
-- estavam gravadas. Clicar em "Sugerir" de novo não mudava uma linha, e
-- a tela continuava mostrando "Venda de Produtos → DEPOSITOS JUDICIAIS".
--
-- Faltava a operação inversa: jogar fora o que o robô escreveu, sem
-- tocar no que gente decidiu.
--
-- A separação é pela observação, que toda gravação carimba:
--
--     'ECD: sugestão automática por ...'   ← robô, pode descartar
--     'ECD: definido manualmente'          ← você
--     'ECD: vínculo em lote'               ← você
--     'ECD: sugestão conferida'            ← você conferiu a do robô
--     'ECD: ignorada'                      ← você decidiu ignorar
--
-- Só a primeira sai. E só das contas DESTA importação.

DROP FUNCTION IF EXISTS public.ecd_sugerir_depara(uuid);

CREATE OR REPLACE FUNCTION public.ecd_sugerir_depara(
  _importacao_id uuid,
  _refazer boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _company uuid; _escopo uuid; _r jsonb; _descartadas int := 0;
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

  -- Descarte: só o que o robô escreveu, só desta importação.
  IF _refazer THEN
    WITH fora AS (
      DELETE FROM public.depara_contas d
       WHERE d.tenant_id = _tenant
         AND d.company_id = _company
         AND d.observacao ILIKE 'ECD: sugestão automática%'
         AND EXISTS (SELECT 1 FROM public.ecd_conta c
                      WHERE c.importacao_id = _importacao_id
                        AND c.codigo = d.conta_codigo)
      RETURNING 1
    ) SELECT count(*) INTO _descartadas FROM fora;
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
    LEFT JOIN _plano pcl  ON pcl.classificacao = e.codigo
    LEFT JOIN _plano pcls ON e.classificacao IS NOT NULL
                         AND pcls.classificacao = e.classificacao
    -- Só código com cara de estrutural. Um "473" solto não casa com o
    -- código interno "473" do plano: são numerações de mundos diferentes.
    LEFT JOIN _plano pc   ON pc.codigo = e.codigo
                         AND position('.' in e.codigo) > 0
    LEFT JOIN (
      SELECT su.saldo, pl.codigo
        FROM _saldo_unico su JOIN _plano pl ON pl.codigo = su.conta_codigo
    ) ps ON e.saldo_final IS NOT NULL AND e.saldo_final <> 0 AND ps.saldo = e.saldo_final
    LEFT JOIN _desc_unica du ON du.desc_norm = e.desc_norm
    LEFT JOIN _ecd_desc_unica edu ON edu.desc_norm = e.desc_norm
    LEFT JOIN _plano pd ON pd.codigo = du.codigo AND edu.desc_norm IS NOT NULL
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
           'descartadas',  _descartadas,
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

REVOKE EXECUTE ON FUNCTION public.ecd_sugerir_depara(uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_sugerir_depara(uuid, boolean) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Quantas sugestões automáticas ainda estão de pé
-- ------------------------------------------------------------
-- A tela precisa saber disto para oferecer o "refazer" só quando há o
-- que refazer — e para dizer quantas linhas o botão vai jogar fora
-- ANTES de jogar.
CREATE OR REPLACE FUNCTION public.ecd_contar_automaticas(_importacao_id uuid)
RETURNS int
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT count(*)::int
    FROM public.depara_contas d
    JOIN public.ecd_importacao i ON i.company_id = d.company_id
    JOIN public.ecd_conta c ON c.importacao_id = i.id AND c.codigo = d.conta_codigo
   WHERE i.id = _importacao_id
     AND d.observacao ILIKE 'ECD: sugestão automática%'
     AND public.pode_acessar_empresa(i.company_id);
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_contar_automaticas(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_contar_automaticas(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
