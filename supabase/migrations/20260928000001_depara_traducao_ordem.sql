-- Paginação estável da tradução: sem ORDER BY, cada .range() do
-- PostgREST pega um pedaço diferente do heap e o mapa de de-para
-- fica pela metade — DRE/Balanço/Fluxo "às vezes" não batem.

CREATE OR REPLACE FUNCTION public.depara_traducao(_company_id uuid)
RETURNS TABLE (
  conta_codigo text,
  conta_padrao_codigo text,
  origem text,
  ignorada boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid;
  _tem_saldo boolean;
BEGIN
  PERFORM set_config('statement_timeout', '15s', true);

  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;

  SELECT EXISTS (SELECT 1 FROM public.saldos_mensais s WHERE s.company_id = _company_id)
      OR EXISTS (SELECT 1 FROM public.saldos_abertura a WHERE a.company_id = _company_id)
    INTO _tem_saldo;

  RETURN QUERY
  WITH com_saldo AS (
    SELECT DISTINCT sm.conta_codigo FROM public.saldos_mensais sm
     WHERE sm.company_id = _company_id
    UNION
    SELECT DISTINCT sa.conta_codigo FROM public.saldos_abertura sa
     WHERE sa.company_id = _company_id
    UNION
    SELECT DISTINCT l.conta_codigo FROM public.lancamentos_diario l
     WHERE l.company_id = _company_id
       AND NOT _tem_saldo
  )
  SELECT cs.conta_codigo,
         COALESCE(dc.conta_padrao_codigo, r.conta_padrao_codigo),
         CASE WHEN dc.conta_padrao_codigo IS NOT NULL THEN 'exato'
              WHEN r.conta_padrao_codigo IS NOT NULL THEN 'regra'
              ELSE 'sem_vinculo' END,
         COALESCE(dc.ignorada, false)
    FROM com_saldo cs
    LEFT JOIN public.plano_contas p
      ON p.tenant_id = _tenant AND p.company_id = _company_id AND p.codigo = cs.conta_codigo
    LEFT JOIN public.depara_contas dc
      ON dc.company_id = _company_id AND dc.conta_codigo = cs.conta_codigo
    LEFT JOIN LATERAL (
      SELECT dr.conta_padrao_codigo
        FROM public.depara_regras dr
       WHERE dr.company_id = _company_id
         AND (dr.tipo_conta IS NULL OR dr.tipo_conta = coalesce(p.tipo, dr.tipo_conta))
         AND (dr.classificacao_prefixo IS NULL
              OR coalesce(p.classificacao, cs.conta_codigo) = dr.classificacao_prefixo
              OR left(coalesce(p.classificacao, cs.conta_codigo), length(dr.classificacao_prefixo) + 1)
                 = dr.classificacao_prefixo || '.')
       ORDER BY length(COALESCE(dr.classificacao_prefixo, '')) DESC,
                (dr.tipo_conta IS NOT NULL) DESC
       LIMIT 1
    ) r ON true
   ORDER BY cs.conta_codigo;
END;
$fn$;

NOTIFY pgrst, 'reload schema';
