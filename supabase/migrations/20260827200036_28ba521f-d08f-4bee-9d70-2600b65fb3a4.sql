ALTER FUNCTION public.finalizar_upload_diario(uuid) SET statement_timeout = '300s';
ALTER FUNCTION public.agregar_saldos_mensais(uuid) SET statement_timeout = '300s';
ALTER FUNCTION public.reverter_upload_diario(uuid) SET statement_timeout = '300s';

CREATE OR REPLACE FUNCTION public.limpar_plano_contas(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _limite integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  _removidas integer;
BEGIN
  IF NOT public.pode_gerenciar_tenant(_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissao para gerenciar este escritorio';
  END IF;

  WITH alvo AS (
    SELECT ctid
    FROM public.plano_contas
    WHERE tenant_id = _tenant_id
      AND ((_company_id IS NULL AND company_id IS NULL)
           OR (_company_id IS NOT NULL AND company_id = _company_id))
    LIMIT GREATEST(_limite, 1)
  )
  DELETE FROM public.plano_contas p
  USING alvo
  WHERE p.ctid = alvo.ctid;

  GET DIAGNOSTICS _removidas = ROW_COUNT;
  RETURN _removidas;
END;
$$;

REVOKE ALL ON FUNCTION public.limpar_plano_contas(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.limpar_plano_contas(uuid, uuid, integer) TO authenticated;