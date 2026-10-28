CREATE OR REPLACE FUNCTION public.aprovar_contas_novas_lote(_tenant_id uuid, _itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  _sep text;
  _it record;
  _pai text;
  _classif text;
  _inseridas int := 0;
  _puladas int := 0;
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

    -- Clientes/fornecedores criados automaticamente ficam todos no mesmo
    -- grupo analítico (ex.: 1.01.02.01.01.01 / 2.01.01.01.01.01), sem abrir
    -- uma classificação nova (.10, .11, ...) para cada conta.
    IF COALESCE(_it.tipo, '') IN ('4-Cli. Nac.','5-For. Nac.','6-Cli. Ex.','7-For. Ex.')
       AND NULLIF(btrim(_it.classificacao_pai), '') IS NOT NULL THEN
      _pai := btrim(_it.classificacao_pai);
      _classif := CASE WHEN array_length(string_to_array(_pai, _sep), 1) >= 6
                       THEN _pai ELSE _pai || _sep || '01' END;
    ELSIF NULLIF(btrim(_it.classificacao), '') IS NOT NULL THEN
      _classif := btrim(_it.classificacao);
    ELSE
      _pai := NULLIF(btrim(_it.classificacao_pai), '');
      IF _pai IS NULL THEN
        _puladas := _puladas + 1;
        CONTINUE;
      END IF;

      IF NOT (_seq_por_pai ? _pai) THEN
        SELECT COALESCE(max(length(ultimo_seg)), 3),
               COALESCE(max(NULLIF(regexp_replace(ultimo_seg, '\D', '', 'g'), '')::bigint), 0)
          INTO _largura, _seq
          FROM (
            SELECT split_part(p.classificacao, _sep,
                     array_length(string_to_array(p.classificacao, _sep), 1)) AS ultimo_seg
              FROM public.plano_contas p
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
$function$;