-- ============================================================
-- AJUSTE 32 — conta zerada não ganha vínculo automático
-- ============================================================
--
-- Você escreveu duas frases que resolvem o desenho desta função:
--
--   "Quando o saldo é 0 pode ser muita coisa, por isso tem que ter uma
--    verificação (não é exata) de nome da conta"
--   "aí não dá pra vincular saldos zerados tmb, não faz sentido"
--
-- As duas juntas dizem: uma conta que não moveu e não tem saldo não
-- carrega prova nenhuma de quem ela é. O nome vira a ÚNICA evidência —
-- e então ele precisa ser quase certo, não apenas parecido.
--
-- TRÊS COISAS MUDAM
--
-- 1. Conta sem movimento E sem saldo só aceita regra forte:
--       classificação estrutural · código estrutural · nome idêntico
--       · nome parecido com 85% ou mais
--    O "parecido com 60%", que serve para uma conta que move dinheiro
--    (o saldo confirma depois, na virada), não serve aqui: não há
--    virada para confirmar.
--
-- 2. Duas brechas do mesmo tipo daquela do ajuste 30 continuavam
--    abertas, e eu não tinha visto:
--
--       LEFT JOIN _plano pcl  ON pcl.classificacao = e.codigo
--       LEFT JOIN _plano pcls ON pcls.classificacao = e.classificacao
--
--    No seu arquivo `e.codigo` é "119" e `e.classificacao` também era
--    "119" (ou o "149.150" que eu inventava). Se o plano do escritório
--    tiver uma classificação que por acaso se escreva do mesmo jeito, o
--    vínculo sai — pela mesma coincidência de sempre. Agora as duas só
--    valem para código com cara de estrutural e para classificação que
--    veio do ARQUIVO (I052/I051/hierarquia pontuada), nunca para a
--    classificação 'reduzido' que o ajuste 32 passou a gravar.
--
-- 3. Bug latente: `_sug` podia trazer a MESMA conta do ECD duas vezes
--    (dois destinos com a mesma classificação, por exemplo) e o INSERT
--    estourava em chave duplicada — a rodada inteira morria e nenhuma
--    sugestão era gravada. Um `DISTINCT ON` resolve, com desempate
--    determinístico para a mesma entrada dar sempre a mesma saída.

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
  -- Conta que move dinheiro: 60% de semelhança basta, porque a virada
  -- confere depois.
  _minimo  constant numeric := 0.60;
  _margem  constant numeric := 0.15;
  -- Conta zerada: o nome é a única prova, então tem que ser quase igual.
  _minimo_zerada constant numeric := 0.85;
  -- Abaixo disto é ruído de arredondamento, não saldo.
  _epsilon constant numeric := 0.005;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'Importação não encontrada';
  END IF;
  IF NOT public.pode_acessar_empresa(_company) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  -- Descarte (ajuste 31): só o que o robô escreveu, só desta importação.
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

  -- Movimento do ARQUIVO INTEIRO, não do último mês: uma conta que
  -- movimentou em março e fechou zerada em dezembro moveu dinheiro, e
  -- por isso não é "conta zerada".
  CREATE TEMP TABLE _mov ON COMMIT DROP AS
    SELECT s.codigo,
           sum(abs(s.debitos) + abs(s.creditos)) AS movimento,
           max(abs(s.saldo_inicial))             AS pico_inicial
      FROM public.ecd_saldo s
     WHERE s.importacao_id = _importacao_id
     GROUP BY s.codigo;
  CREATE INDEX ON _mov (codigo);
  ANALYZE _mov;

  CREATE TEMP TABLE _ecd ON COMMIT DROP AS
    SELECT c.codigo, c.descricao, c.classificacao, c.classificacao_origem,
           public.ecd_normalizar_texto(c.descricao) AS desc_norm,
           public.ecd_palavras(c.descricao)         AS palavras,
           s.saldo_final,
           COALESCE(m.movimento, 0)    AS movimento,
           COALESCE(m.pico_inicial, 0) AS pico_inicial
      FROM public.ecd_conta c
      LEFT JOIN public.ecd_saldo s
             ON s.importacao_id = c.importacao_id
            AND s.codigo = c.codigo
            AND s.competencia = (SELECT max(competencia) FROM public.ecd_saldo
                                  WHERE importacao_id = _importacao_id)
      LEFT JOIN _mov m ON m.codigo = c.codigo
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

  -- ---------- a cadeia, da regra mais forte para a mais fraca ----------
  -- DISTINCT ON: a mesma conta do ECD nunca sai daqui duas vezes, mesmo
  -- que dois destinos empatem numa regra. Sem isto o INSERT abaixo morria
  -- em chave duplicada e a rodada inteira não gravava nada.
  CREATE TEMP TABLE _sug ON COMMIT DROP AS
  SELECT DISTINCT ON (x.ecd_codigo) x.*
    FROM (
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
             nm.nota AS nota_nome,
             -- Não moveu, não fechou com saldo e não abriu com saldo:
             -- não há número nenhum que diga quem esta conta é.
             (e.movimento    <= _epsilon
              AND abs(COALESCE(e.saldo_final, 0)) <= _epsilon
              AND e.pico_inicial <= _epsilon) AS zerada
        FROM _ecd e
        -- 1) o código do ECD É a classificação do plano — só se o código
        --    tiver cara de estrutural. "119" não é classificação de nada.
        LEFT JOIN _plano pcl  ON pcl.classificacao = e.codigo
                             AND position('.' in e.codigo) > 0
        -- 2) a classificação do ECD bate com a do plano — só quando ela
        --    veio do ARQUIVO. A origem 'reduzido' é o próprio código de
        --    novo, e cairia na mesma coincidência.
        LEFT JOIN _plano pcls ON e.classificacao IS NOT NULL
                             AND pcls.classificacao = e.classificacao
                             AND e.classificacao_origem IN ('i052','i051','hierarquia')
        -- 3) mesmo código, também só se estrutural (ajuste 30)
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
        LEFT JOIN _nome nm ON nm.ecd_codigo = e.codigo
    ) x
   ORDER BY x.ecd_codigo,
            -- desempate determinístico: a regra mais forte, depois a
            -- melhor nota, depois o código — a mesma entrada dá sempre a
            -- mesma saída.
            CASE x.regra WHEN 'classificacao' THEN 1 WHEN 'codigo' THEN 2
                         WHEN 'saldo' THEN 3 WHEN 'descricao' THEN 4
                         WHEN 'nome' THEN 5 ELSE 9 END,
            COALESCE(x.nota_nome, 0) DESC,
            x.plano_codigo;

  -- ---------- o corte da conta zerada ----------
  -- Fica numa tabela à parte, e não num WHERE escondido no INSERT, para
  -- a resposta poder DIZER quantas foram barradas. Uma conta que some da
  -- sugestão sem explicação é o mesmo problema de antes com o sinal
  -- trocado.
  CREATE TEMP TABLE _barradas ON COMMIT DROP AS
    SELECT * FROM _sug s
     WHERE s.plano_codigo IS NOT NULL
       AND s.zerada
       AND NOT (
         s.regra IN ('classificacao', 'codigo', 'descricao')
         OR (s.regra = 'nome' AND COALESCE(s.nota_nome, 0) >= _minimo_zerada)
       );
  ANALYZE _barradas;

  INSERT INTO public.depara_contas
    (tenant_id, company_id, conta_codigo, conta_padrao_codigo, ignorada, observacao)
  SELECT _tenant, _company, s.ecd_codigo, s.plano_codigo, false,
         'ECD: sugestão automática por ' || s.regra ||
         CASE WHEN s.regra = 'nome'
              THEN ' (' || round(s.nota_nome * 100) || '% de semelhança)'
              ELSE '' END
    FROM _sug s
   WHERE s.plano_codigo IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM _barradas b WHERE b.ecd_codigo = s.ecd_codigo)
     AND NOT EXISTS (
       SELECT 1 FROM public.depara_contas d
        WHERE d.tenant_id = _tenant AND d.company_id = _company
          AND d.conta_codigo = s.ecd_codigo);

  SELECT jsonb_build_object(
           'descartadas',  _descartadas,
           'contas_ecd',   (SELECT count(*) FROM _ecd),
           'sugeridas',    (SELECT count(*) FROM _sug s
                             WHERE s.plano_codigo IS NOT NULL
                               AND NOT EXISTS (SELECT 1 FROM _barradas b
                                                WHERE b.ecd_codigo = s.ecd_codigo)),
           -- Quantas contas zeradas o sistema PREFERIU não adivinhar.
           'zeradas_barradas', (SELECT count(*) FROM _barradas),
           'zeradas',      (SELECT count(*) FROM _sug WHERE zerada),
           'pendentes',    (SELECT count(*) FROM _sug WHERE plano_codigo IS NULL),
           'por_regra',    (SELECT COALESCE(jsonb_object_agg(regra, n), '{}'::jsonb)
                              FROM (SELECT s.regra, count(*) n FROM _sug s
                                     WHERE s.regra IS NOT NULL
                                       AND NOT EXISTS (SELECT 1 FROM _barradas b
                                                        WHERE b.ecd_codigo = s.ecd_codigo)
                                     GROUP BY s.regra) t),
           'ja_vinculadas',(SELECT count(*) FROM public.depara_contas d
                             WHERE d.tenant_id = _tenant AND d.company_id = _company))
    INTO _r;
  RETURN _r;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_sugerir_depara(uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_sugerir_depara(uuid, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
