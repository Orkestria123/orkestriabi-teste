ALTER TABLE IF EXISTS public.backup_alocacao_removida ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_alocacao_removida FROM anon, authenticated;

ALTER TABLE public.lancamentos_diario
  ADD COLUMN IF NOT EXISTS conta_nome text;

COMMENT ON COLUMN public.lancamentos_diario.conta_nome IS
  'Nome da conta como veio no arquivo de diário. Usado para pré-preencher o cadastro de contas novas no Plano Padrão.';

DROP FUNCTION IF EXISTS public.contas_novas_do_diario(uuid, int);

CREATE OR REPLACE FUNCTION public.contas_novas_do_diario(_tenant_id uuid, _limite int DEFAULT 300)
RETURNS TABLE (
  codigo text,
  nome_sugerido text,
  movimento numeric,
  lancamentos bigint,
  historico_exemplo text,
  empresas text,
  primeira_competencia date,
  ultima_competencia date
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
  WITH empresas_padrao AS (
    SELECT c.id, c.name
      FROM public.companies c
     WHERE c.tenant_id = _tenant_id
       AND COALESCE(c.plano_tipo,'padrao') = 'padrao'
  ),
  mov AS (
    SELECT l.conta_codigo,
           (array_agg(l.conta_nome ORDER BY l.conta_nome)
              FILTER (WHERE NULLIF(btrim(l.conta_nome),'') IS NOT NULL))[1] AS nome,
           SUM(l.debito - l.credito)           AS movimento,
           COUNT(*)                            AS lancamentos,
           MIN(l.competencia)                  AS primeira,
           MAX(l.competencia)                  AS ultima,
           MIN(NULLIF(btrim(l.historico), '')) AS historico,
           string_agg(DISTINCT e.name, ', ')   AS empresas
      FROM public.lancamentos_diario l
      JOIN empresas_padrao e ON e.id = l.company_id
     WHERE l.tenant_id = _tenant_id
     GROUP BY l.conta_codigo
  )
  SELECT m.conta_codigo, m.nome, m.movimento, m.lancamentos, m.historico,
         m.empresas, m.primeira, m.ultima
    FROM mov m
   WHERE NOT EXISTS (
     SELECT 1 FROM public.plano_contas p
      WHERE p.tenant_id = _tenant_id AND p.company_id IS NULL AND p.codigo = m.conta_codigo
   )
     AND NOT EXISTS (
     SELECT 1 FROM public.plano_contas_descartadas d
      WHERE d.tenant_id = _tenant_id AND d.codigo = m.conta_codigo
   )
   ORDER BY abs(m.movimento) DESC
   LIMIT GREATEST(_limite, 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.contas_novas_do_diario(uuid, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.contas_novas_do_diario(uuid, int) TO authenticated, service_role;

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
  _seq int;
  _largura int;
  _inseridas int := 0;
  _puladas int := 0;
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
        codigo text,
        descricao text,
        tipo text,
        classificacao text,
        classificacao_pai text
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

      SELECT COALESCE(max(length(seg)), 3) INTO _largura
        FROM (
          SELECT split_part(p.classificacao, _sep,
                   array_length(string_to_array(p.classificacao, _sep), 1)) AS seg
            FROM public.plano_contas p
           WHERE p.tenant_id = _tenant_id
             AND p.company_id IS NULL
             AND left(p.classificacao, length(_pai) + length(_sep)) = _pai || _sep
             AND array_length(string_to_array(p.classificacao, _sep), 1)
                 = array_length(string_to_array(_pai, _sep), 1) + 1
        ) f;

      SELECT COALESCE(max(seg_num), 0) + 1 INTO _seq
        FROM (
          SELECT NULLIF(regexp_replace(
                   split_part(p.classificacao, _sep,
                     array_length(string_to_array(p.classificacao, _sep), 1)),
                   '\D', '', 'g'), '')::bigint AS seg_num
            FROM public.plano_contas p
           WHERE p.tenant_id = _tenant_id
             AND p.company_id IS NULL
             AND left(p.classificacao, length(_pai) + length(_sep)) = _pai || _sep
             AND array_length(string_to_array(p.classificacao, _sep), 1)
                 = array_length(string_to_array(_pai, _sep), 1) + 1
        ) g;

      _classif := _pai || _sep || lpad(_seq::text, _largura, '0');

      WHILE EXISTS (
        SELECT 1 FROM public.plano_contas p
         WHERE p.tenant_id = _tenant_id AND p.company_id IS NULL
           AND p.classificacao = _classif
      ) LOOP
        _seq := _seq + 1;
        _classif := _pai || _sep || lpad(_seq::text, _largura, '0');
      END LOOP;
    END IF;

    INSERT INTO public.plano_contas (
      tenant_id, company_id, codigo, classificacao, descricao, tipo, natureza,
      nivel, is_participante, is_sintetica, conta_pai_classificacao, ativo
    ) VALUES (
      _tenant_id, NULL, _it.codigo, _classif,
      COALESCE(NULLIF(btrim(_it.descricao), ''), _it.codigo),
      COALESCE(_it.tipo, 'Indefinido'),
      'A',
      array_length(string_to_array(_classif, _sep), 1),
      COALESCE(_it.tipo, '') IN ('4-Cli. Nac.','5-For. Nac.','6-Cli. Ex.','7-For. Ex.'),
      false,
      CASE
        WHEN array_length(string_to_array(_classif, _sep), 1) > 1
        THEN array_to_string(
               (string_to_array(_classif, _sep))[
                 1 : array_length(string_to_array(_classif, _sep), 1) - 1
               ], _sep)
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

CREATE OR REPLACE FUNCTION public.sinteticas_do_plano_padrao(_tenant_id uuid)
RETURNS TABLE (
  codigo text,
  classificacao text,
  descricao text,
  tipo text,
  filhos bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _sep text;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RETURN;
  END IF;
  SELECT COALESCE(mc.separador,'.') INTO _sep
    FROM public.mascara_classificacao mc WHERE mc.tenant_id = _tenant_id LIMIT 1;
  _sep := COALESCE(_sep, '.');

  RETURN QUERY
  SELECT p.codigo, p.classificacao, p.descricao, p.tipo,
         (SELECT count(*) FROM public.plano_contas f
           WHERE f.tenant_id = _tenant_id AND f.company_id IS NULL
             AND left(f.classificacao, length(p.classificacao) + length(_sep))
                 = p.classificacao || _sep)
    FROM public.plano_contas p
   WHERE p.tenant_id = _tenant_id
     AND p.company_id IS NULL
     AND p.is_sintetica = true
   ORDER BY p.classificacao;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sinteticas_do_plano_padrao(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.sinteticas_do_plano_padrao(uuid) TO authenticated, service_role;