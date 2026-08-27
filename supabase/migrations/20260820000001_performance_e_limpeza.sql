-- ============================================================
-- AJUSTE 05 — timeout do cadastro em lote, índices e limpeza
--
-- CAUSA DO TIMEOUT
--
-- O aprovar_contas_novas_lote do ajuste 04 procurava os filhos de uma
-- conta pai assim:
--
--   left(p.classificacao, length(_pai)+length(_sep)) = _pai || _sep
--
-- `left(coluna, n)` é uma EXPRESSÃO sobre a coluna: o Postgres não
-- consegue usar índice e varre a tabela inteira. Pior, isso era feito
-- DUAS vezes por conta do lote (largura + próximo número), mais um
-- EXISTS por colisão. Com um plano de dezenas de milhares de contas —
-- que é o caso, porque cada cliente/fornecedor é uma conta — 30 contas
-- selecionadas viravam ~90 varreduras completas. Daí o
-- "canceling statement due to statement timeout".
--
-- E piorava a cada rodada: quanto mais fornecedores cadastrados, maior
-- a tabela, mais lenta a varredura seguinte. Bate com "na segunda vez".
--
-- A correção usa a coluna `conta_pai_classificacao`, que já existe e já
-- tem índice: filho de um pai é `conta_pai_classificacao = _pai`.
-- Igualdade indexada em vez de varredura. E a numeração passa a ser
-- calculada UMA vez por pai, não uma vez por conta.
--
-- SEGUNDA CAUSA (o erro que voltava só de recarregar a página)
--
-- plano_padrao_resumo chamava contas_novas_do_diario(_tenant_id, 100000)
-- só para contar. Essa função agrupa TODO o lancamentos_diario do
-- escritório com string_agg(DISTINCT ...) — custosa por natureza. Como o
-- resumo roda no carregamento da tela, a página inteira dependia dela.
-- Agora a contagem é uma query enxuta e direta.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Índices que faltavam
-- ------------------------------------------------------------
-- Filhos por pai (usado pela numeração em lote)
CREATE INDEX IF NOT EXISTS idx_plano_contas_pai
  ON public.plano_contas (tenant_id, company_id, conta_pai_classificacao);

-- Busca por código dentro do escopo (usada em todo lugar)
CREATE INDEX IF NOT EXISTS idx_plano_contas_codigo_escopo
  ON public.plano_contas (tenant_id, company_id, codigo);

-- Contas distintas do diário por escritório (detecção de contas novas)
CREATE INDEX IF NOT EXISTS idx_lanc_tenant_conta
  ON public.lancamentos_diario (tenant_id, conta_codigo);

-- Movimento por conta dentro da empresa (montagem de demonstrações)
CREATE INDEX IF NOT EXISTS idx_saldos_company_conta
  ON public.saldos_mensais (company_id, conta_codigo, competencia);

-- Aberturas por empresa (acúmulo do balanço)
CREATE INDEX IF NOT EXISTS idx_abertura_company_conta
  ON public.saldos_abertura (company_id, conta_codigo, data_referencia);

-- ------------------------------------------------------------
-- 2) Cadastro em lote — sem varredura de tabela
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aprovar_contas_novas_lote(_tenant_id uuid, _itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sep text;
  _it record;
  _pai text;
  _classif text;
  _inseridas int := 0;
  _puladas int := 0;
  -- estado da numeração POR PAI, calculado uma única vez
  _seq_por_pai jsonb := '{}'::jsonb;
  _larg_por_pai jsonb := '{}'::jsonb;
  _seq int;
  _largura int;
BEGIN
  IF NOT public.pode_gerenciar_tenant(_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Plano Padrão deste escritório';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('plano_padrao:' || _tenant_id::text));

  SELECT COALESCE(mc.separador,'.') INTO _sep
    FROM public.mascara_classificacao mc WHERE mc.tenant_id = _tenant_id LIMIT 1;
  _sep := COALESCE(_sep, '.');

  FOR _it IN
    SELECT DISTINCT ON (x.codigo) x.*
      FROM jsonb_to_recordset(_itens) AS x(
        codigo text, descricao text, tipo text,
        classificacao text, classificacao_pai text
      )
     WHERE x.codigo IS NOT NULL
     ORDER BY x.codigo
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.plano_contas p
       WHERE p.tenant_id = _tenant_id AND p.company_id IS NULL AND p.codigo = _it.codigo
    ) THEN
      _puladas := _puladas + 1;
      CONTINUE;
    END IF;

    IF NULLIF(btrim(_it.classificacao), '') IS NOT NULL THEN
      _classif := btrim(_it.classificacao);
    ELSE
      _pai := NULLIF(btrim(_it.classificacao_pai), '');
      IF _pai IS NULL THEN
        _puladas := _puladas + 1;
        CONTINUE;
      END IF;

      -- primeira conta deste pai no lote: descobre largura e último número
      IF NOT (_seq_por_pai ? _pai) THEN
        SELECT COALESCE(max(length(ultimo_seg)), 3),
               COALESCE(max(NULLIF(regexp_replace(ultimo_seg, '\D', '', 'g'), '')::bigint), 0)
          INTO _largura, _seq
          FROM (
            SELECT split_part(p.classificacao, _sep,
                     array_length(string_to_array(p.classificacao, _sep), 1)) AS ultimo_seg
              FROM public.plano_contas p
             -- IGUALDADE em coluna indexada, em vez de left(...) que
             -- forçava varredura completa da tabela
             WHERE p.tenant_id = _tenant_id
               AND p.company_id IS NULL
               AND p.conta_pai_classificacao = _pai
          ) f;
        _seq_por_pai := jsonb_set(_seq_por_pai, ARRAY[_pai], to_jsonb(_seq));
        _larg_por_pai := jsonb_set(_larg_por_pai, ARRAY[_pai], to_jsonb(_largura));
      END IF;

      _seq := (_seq_por_pai ->> _pai)::int + 1;
      _largura := (_larg_por_pai ->> _pai)::int;
      _seq_por_pai := jsonb_set(_seq_por_pai, ARRAY[_pai], to_jsonb(_seq));
      _classif := _pai || _sep || lpad(_seq::text, _largura, '0');
    END IF;

    -- Sem laço de colisão: a unicidade é garantida pelo índice. Se ainda
    -- assim colidir (classificação criada à mão), o INSERT falha e a
    -- transação inteira volta atrás — melhor que gerar duplicata.
    INSERT INTO public.plano_contas (
      tenant_id, company_id, codigo, classificacao, descricao, tipo, natureza,
      nivel, is_participante, is_sintetica, conta_pai_classificacao, ativo
    ) VALUES (
      _tenant_id, NULL, _it.codigo, _classif,
      COALESCE(NULLIF(btrim(_it.descricao), ''), _it.codigo),
      COALESCE(_it.tipo, 'Indefinido'), 'A',
      array_length(string_to_array(_classif, _sep), 1),
      COALESCE(_it.tipo, '') IN ('4-Cli. Nac.','5-For. Nac.','6-Cli. Ex.','7-For. Ex.'),
      false,
      CASE
        WHEN array_length(string_to_array(_classif, _sep), 1) > 1
        THEN array_to_string(
               (string_to_array(_classif, _sep))[
                 1 : array_length(string_to_array(_classif, _sep), 1) - 1], _sep)
        ELSE NULL
      END,
      true
    );
    _inseridas := _inseridas + 1;
  END LOOP;

  IF _inseridas > 0 THEN
    INSERT INTO public.plano_atualizacoes
      (tenant_id, company_id, filename, total_arquivo, novas, atualizadas, inalteradas)
    VALUES (_tenant_id, NULL, 'Contas novas do diário (lote)',
            jsonb_array_length(_itens), _inseridas, 0, 0);
  END IF;

  RETURN jsonb_build_object('inseridas', _inseridas, 'puladas', _puladas);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.aprovar_contas_novas_lote(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.aprovar_contas_novas_lote(uuid, jsonb) TO authenticated, service_role;

-- Reparo: contas cadastradas antes deste ajuste podem estar sem
-- conta_pai_classificacao (a numeração nova depende dela).
UPDATE public.plano_contas p
   SET conta_pai_classificacao = array_to_string(
         (string_to_array(p.classificacao, '.'))[
           1 : array_length(string_to_array(p.classificacao, '.'), 1) - 1], '.')
 WHERE p.conta_pai_classificacao IS NULL
   AND array_length(string_to_array(p.classificacao, '.'), 1) > 1;

-- ------------------------------------------------------------
-- 3) sinteticas_do_plano_padrao — contagem de filhos sem varredura
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sinteticas_do_plano_padrao(_tenant_id uuid)
RETURNS TABLE (
  codigo text, classificacao text, descricao text, tipo text, filhos bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH filhos_por_pai AS (
    SELECT p.conta_pai_classificacao AS pai, count(*) AS n
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NULL
       AND p.conta_pai_classificacao IS NOT NULL
     GROUP BY p.conta_pai_classificacao
  )
  SELECT s.codigo, s.classificacao, s.descricao, s.tipo, COALESCE(f.n, 0)
    FROM public.plano_contas s
    LEFT JOIN filhos_por_pai f ON f.pai = s.classificacao
   WHERE s.tenant_id = _tenant_id
     AND s.company_id IS NULL
     AND s.is_sintetica = true
   ORDER BY s.classificacao;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sinteticas_do_plano_padrao(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.sinteticas_do_plano_padrao(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) plano_padrao_resumo deixa de chamar a função pesada
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.plano_padrao_resumo(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total int := 0; _estruturais int := 0; _participantes int := 0;
  _marcos int := 0; _sem_dfc int := 0; _novas int := 0; _descartadas int := 0;
  _empresas int := 0; _ultima timestamptz;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RETURN jsonb_build_object('autorizado', false);
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE is_participante = false),
         count(*) FILTER (WHERE is_participante = true),
         count(*) FILTER (WHERE marco IS NOT NULL),
         count(*) FILTER (WHERE is_sintetica = false AND dfc_atividade IS NULL
                            AND dfc_nao_caixa = false AND tipo IN ('1-Ativo','2-Passivo'))
    INTO _total, _estruturais, _participantes, _marcos, _sem_dfc
    FROM public.plano_contas
   WHERE tenant_id = _tenant_id AND company_id IS NULL;

  -- Contagem direta: distintas do diário que não estão no plano nem
  -- foram descartadas. Sem string_agg, sem ordenação, sem a função cara.
  SELECT count(*) INTO _novas
    FROM (
      SELECT DISTINCT l.conta_codigo
        FROM public.lancamentos_diario l
        JOIN public.companies c
          ON c.id = l.company_id AND COALESCE(c.plano_tipo,'padrao') = 'padrao'
       WHERE l.tenant_id = _tenant_id
    ) d
   WHERE NOT EXISTS (
     SELECT 1 FROM public.plano_contas p
      WHERE p.tenant_id = _tenant_id AND p.company_id IS NULL AND p.codigo = d.conta_codigo
   )
     AND NOT EXISTS (
     SELECT 1 FROM public.plano_contas_descartadas x
      WHERE x.tenant_id = _tenant_id AND x.codigo = d.conta_codigo
   );

  SELECT count(*) INTO _descartadas FROM public.plano_contas_descartadas WHERE tenant_id = _tenant_id;
  SELECT count(*) INTO _empresas FROM public.companies
   WHERE tenant_id = _tenant_id AND COALESCE(plano_tipo,'padrao') = 'padrao';
  SELECT max(created_at) INTO _ultima FROM public.plano_atualizacoes
   WHERE tenant_id = _tenant_id AND company_id IS NULL;

  RETURN jsonb_build_object(
    'autorizado', true, 'total', _total, 'estruturais', _estruturais,
    'participantes', _participantes, 'marcos', _marcos, 'sem_dfc', _sem_dfc,
    'contas_novas', _novas, 'descartadas', _descartadas,
    'empresas_usando', _empresas, 'ultima_atualizacao', _ultima
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.plano_padrao_resumo(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.plano_padrao_resumo(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5) inverter_sinal sai do plano de contas
-- ------------------------------------------------------------
-- O saldo do diário já carrega o sinal correto (movimento = débito -
-- crédito). "Inverter" é decisão de EXIBIÇÃO — mostrar receita e
-- passivo como positivos — e isso é propriedade do papel da conta na
-- demonstração, não da conta em si.
--
-- Na prática a coluna já estava morta desde o ajuste 03: o motor lê o
-- sinal do catálogo de marcos (marcoDef().inverter), nunca do banco.
-- Manter uma coluna que ninguém lê só cria a ilusão de que dá para
-- configurar sinal por conta.
ALTER TABLE public.plano_contas DROP COLUMN IF EXISTS inverter_sinal;
