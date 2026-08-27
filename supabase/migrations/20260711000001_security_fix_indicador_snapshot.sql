-- ============================================================
-- CORREÇÃO CRÍTICA — public.indicador_snapshot(_company_id)
--
-- A função original (migration 20260703181407) é SECURITY DEFINER
-- e roda com privilégios de dono da função, ou seja: ela IGNORA
-- as RLS policies de plano_contas / saldos_mensais / saldos_abertura.
-- Isso por si só é normal e intencional (é assim que ela evita
-- trazer as ~134 mil linhas de contas participantes de uma vez).
--
-- O problema é que ela nunca verifica se quem está chamando tem
-- permissão para ver os dados de `_company_id`. Ela é chamada
-- direto do navegador (src/hooks/use-indicador-data.ts, linha 40:
-- `supabase.rpc("indicador_snapshot", { _company_id })`) com a
-- publishable key + sessão do usuário logado — e como não há
-- nenhuma checagem de tenant/empresa dentro da função, QUALQUER
-- usuário autenticado (inclusive papel "client" de outro tenant)
-- pode chamar essa RPC passando o UUID de uma empresa que não é
-- dele e receber o plano de contas + saldos mensais + saldos de
-- abertura completos dessa empresa. É vazamento de dados
-- financeiros entre tenants (o núcleo do isolamento multi-tenant
-- que todo o resto do schema foi construído para garantir).
--
-- Todas as outras RPCs SECURITY DEFINER do projeto (has_role,
-- is_orkestria_admin, get_my_tenant_id, get_my_company_id,
-- agregar_saldos_mensais, reverter_upload_diario) OU não recebem
-- um identificador de outro tenant como argumento, OU (no caso das
-- duas últimas) só são chamadas a partir de um upload que o próprio
-- usuário acabou de criar. indicador_snapshot é a exceção: recebe
-- um _company_id arbitrário vindo do cliente e nunca o valida.
--
-- A correção replica o mesmo padrão já usado em outras policies do
-- schema (ex.: "Cenarios: select por tenant/empresa" em
-- orcamento_cenarios): permite se for orkestria_admin, OU se o
-- tenant da empresa bater com o tenant do usuário E (o usuário não
-- estiver restrito a uma empresa específica OU a empresa bater).
-- ============================================================

CREATE OR REPLACE FUNCTION public.indicador_snapshot(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid;
  _plano jsonb;
  _saldos jsonb;
  _aberturas jsonb;
  _my_tenant uuid;
  _my_company uuid;
BEGIN
  SELECT tenant_id INTO _tenant_id FROM public.companies WHERE id = _company_id;
  IF _tenant_id IS NULL THEN
    RETURN jsonb_build_object('plano','[]'::jsonb,'saldos','[]'::jsonb,'aberturas','[]'::jsonb);
  END IF;

  -- Autorização: precisa ser orkestria_admin, ou pertencer ao mesmo
  -- tenant da empresa (e, se o usuário estiver preso a uma empresa
  -- específica — perfil "client" — só pode ser a própria empresa).
  IF NOT public.is_orkestria_admin() THEN
    _my_tenant := public.get_my_tenant_id();
    _my_company := public.get_my_company_id();
    IF _my_tenant IS DISTINCT FROM _tenant_id
       OR (_my_company IS NOT NULL AND _my_company IS DISTINCT FROM _company_id) THEN
      RETURN jsonb_build_object('plano','[]'::jsonb,'saldos','[]'::jsonb,'aberturas','[]'::jsonb);
    END IF;
  END IF;

  -- Plano: estruturais + participantes que aparecem em saldos_mensais
  WITH codigos_movimento AS (
    SELECT DISTINCT conta_codigo FROM public.saldos_mensais WHERE company_id = _company_id
  ),
  filtrado AS (
    SELECT p.codigo, p.classificacao, p.descricao, p.natureza, p.is_sintetica, p.is_participante
    FROM public.plano_contas p
    WHERE p.tenant_id = _tenant_id
      AND (p.company_id = _company_id OR p.company_id IS NULL)
      AND (p.is_participante = false OR p.codigo IN (SELECT conta_codigo FROM codigos_movimento))
  )
  SELECT jsonb_agg(row_to_json(filtrado)) INTO _plano FROM filtrado;

  SELECT jsonb_agg(jsonb_build_object(
    'conta_codigo', conta_codigo,
    'competencia', to_char(competencia, 'YYYY-MM-DD'),
    'total_debitos', total_debitos,
    'total_creditos', total_creditos
  )) INTO _saldos
  FROM public.saldos_mensais WHERE company_id = _company_id;

  SELECT jsonb_agg(jsonb_build_object(
    'conta_codigo', conta_codigo,
    'data_referencia', to_char(data_referencia, 'YYYY-MM-DD'),
    'saldo', saldo
  )) INTO _aberturas
  FROM public.saldos_abertura WHERE company_id = _company_id;

  RETURN jsonb_build_object(
    'plano', COALESCE(_plano, '[]'::jsonb),
    'saldos', COALESCE(_saldos, '[]'::jsonb),
    'aberturas', COALESCE(_aberturas, '[]'::jsonb)
  );
END;
$$;

-- Mantém os mesmos GRANTs de antes (a proteção agora é dentro da função).
GRANT EXECUTE ON FUNCTION public.indicador_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.indicador_snapshot(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.indicador_snapshot(uuid) FROM anon, public;
