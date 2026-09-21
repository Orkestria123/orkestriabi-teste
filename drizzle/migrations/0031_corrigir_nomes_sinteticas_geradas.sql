-- 1) Gerar sintéticas faltantes com nome correto:
--    prioridade: plano padrão de referência > acumulador FILHO DIRETO (.98/.99) >
--    nome único entre filhos diretos > "GRUPO x".
CREATE OR REPLACE FUNCTION public._garantir_sinteticas_interno(_tenant_id uuid, _company_id uuid DEFAULT NULL::uuid, _separador text DEFAULT '.'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
DECLARE _criadas int := 0;
BEGIN
  WITH grupos AS MATERIALIZED (
    SELECT p.classificacao,
           min(p.descricao) AS descricao,
           min(p.tipo) AS tipo
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id
       AND p.company_id IS NOT DISTINCT FROM _company_id
     GROUP BY p.classificacao
  ),
  ancestrais AS MATERIALIZED (
    SELECT DISTINCT array_to_string(
             (string_to_array(g.classificacao, _separador))[1:i], _separador
           ) AS cls
      FROM grupos g
      CROSS JOIN LATERAL generate_series(
        1, array_length(string_to_array(g.classificacao, _separador), 1) - 1
      ) AS i
  ),
  faltando AS MATERIALIZED (
    SELECT a.cls FROM ancestrais a
     WHERE a.cls <> ''
       AND NOT EXISTS (SELECT 1 FROM grupos g WHERE g.classificacao = a.cls)
  ),
  -- apenas FILHOS DIRETOS (um nível abaixo)
  filhos AS MATERIALIZED (
    SELECT f.cls,
           min(g.descricao) FILTER (
             WHERE right(g.classificacao, length(_separador) + 2)
                   IN (_separador || '98', _separador || '99')
           ) AS descricao_acumulador,
           min(g.descricao) AS descricao,
           min(g.tipo) AS tipo,
           count(DISTINCT g.descricao) AS nomes
      FROM faltando f
      LEFT JOIN grupos g
        ON g.classificacao LIKE f.cls || _separador || '%'
       AND array_length(string_to_array(g.classificacao, _separador), 1)
           = array_length(string_to_array(f.cls, _separador), 1) + 1
     GROUP BY f.cls
  ),
  ins AS (
    INSERT INTO public.plano_contas
      (tenant_id, company_id, codigo, classificacao, descricao, tipo, natureza,
       nivel, is_sintetica, is_participante, conta_pai_classificacao, ativo)
    SELECT _tenant_id, _company_id, 'S-' || f.cls, f.cls,
           COALESCE(r.descricao,
                    f.descricao_acumulador,
                    CASE WHEN f.nomes = 1 THEN f.descricao END,
                    'GRUPO ' || f.cls),
           COALESCE(r.tipo, f.tipo, '1-Ativo'), 'S',
           array_length(string_to_array(f.cls, _separador), 1),
           true, false,
           CASE WHEN position(_separador in f.cls) > 0
                THEN left(f.cls, length(f.cls) - position(_separador in reverse(f.cls)))
                ELSE NULL END,
           true
      FROM filhos f
      LEFT JOIN public.plano_padrao_referencia r ON r.classificacao = f.cls
    ON CONFLICT (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo)
      DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _criadas FROM ins;

  RETURN jsonb_build_object('sinteticas_criadas', _criadas, 'rodadas', 1);
END;
$function$;

-- 2) Corrigir nomes já gravados de sintéticas geradas automaticamente (codigo 'S-%')
UPDATE public.plano_contas p
   SET descricao = r.descricao,
       updated_at = now()
  FROM public.plano_padrao_referencia r
 WHERE r.classificacao = p.classificacao
   AND p.codigo LIKE 'S-%'
   AND p.is_sintetica
   AND upper(btrim(p.descricao)) <> upper(btrim(r.descricao));