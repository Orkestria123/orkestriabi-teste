-- 1) statement_timeout próprio nas RPCs usadas em lote na aba ECD.
-- Sem isso caem no limite padrão (~8s) e morrem com
-- 'canceling statement due to statement timeout' no meio do trabalho.
-- Quem já tem timeout configurado (ex.: aplicar_depara_em_lote, ecd_classificar) fica como está.
DO $m$
DECLARE
  alvo text[] := ARRAY[
    'ecd_alocar_automatico','ecd_alocar_por_grupo','ecd_sugerir_depara',
    'ecd_grupo_destino','ecd_gravar_referencias','ecd_diagnostico',
    'ecd_contar_automaticas','ecd_conferir_grupos_hash','ecd_conferir_natureza',
    'ecd_resumo_natureza','ecd_similaridade','ecd_debito_credito_dre',
    'aprovar_contas_novas','aprovar_contas_novas_lote','descartar_contas_novas',
    'garantir_contas_agregadoras','garantir_sinteticas_faltantes',
    'depara_carregar_origem','depara_pendencias','depara_traducao',
    'depara_traducao_pagina','plano_buscar_contas'
  ];
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = ANY (alvo)
       AND NOT EXISTS (
         SELECT 1
           FROM unnest(COALESCE(p.proconfig, '{}'::text[])) cfg
          WHERE cfg LIKE 'statement_timeout%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET statement_timeout TO %L',
                   r.oid::regprocedure::text, '120s');
  END LOOP;
END
$m$;

-- 2) Política de leitura mais barata nas tabelas quentes.
-- Mesma regra de antes, mas as funções de permissão ficam amarradas em
-- (SELECT ...) — o Postgres passa a avaliá-las UMA vez por consulta em vez
-- de uma vez por LINHA (era o que custava ~2,4s por leitura do de-para).
-- Semântica preservada:
--   orkestria_admin vê tudo;
--   mesmo tenant e (empresa própria/null ou conta do perfil não fixada);
--   cliente só o que tem vínculo em usuario_empresas.
DROP POLICY IF EXISTS depara_contas_leitura ON public.depara_contas;
CREATE POLICY depara_contas_leitura ON public.depara_contas
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_orkestria_admin())
    OR (
      (SELECT public.get_my_tenant_id()) IS NOT DISTINCT FROM depara_contas.tenant_id
      AND (depara_contas.company_id IS NULL
           OR (SELECT public.get_my_company_id()) IS NULL
           OR (SELECT public.get_my_company_id()) = depara_contas.company_id)
      AND (depara_contas.company_id IS NULL
           OR (SELECT public.sou_cliente()) = false
           OR EXISTS (
             SELECT 1 FROM public.usuario_empresas ue
              WHERE ue.user_id = auth.uid()
                AND ue.company_id = depara_contas.company_id))
    )
  );

DROP POLICY IF EXISTS lancamentos_diario_leitura ON public.lancamentos_diario;
CREATE POLICY lancamentos_diario_leitura ON public.lancamentos_diario
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_orkestria_admin())
    OR (
      (SELECT public.get_my_tenant_id()) IS NOT DISTINCT FROM lancamentos_diario.tenant_id
      AND (lancamentos_diario.company_id IS NULL
           OR (SELECT public.get_my_company_id()) IS NULL
           OR (SELECT public.get_my_company_id()) = lancamentos_diario.company_id)
      AND (lancamentos_diario.company_id IS NULL
           OR (SELECT public.sou_cliente()) = false
           OR EXISTS (
             SELECT 1 FROM public.usuario_empresas ue
              WHERE ue.user_id = auth.uid()
                AND ue.company_id = lancamentos_diario.company_id))
    )
  );

DROP POLICY IF EXISTS saldos_mensais_leitura ON public.saldos_mensais;
CREATE POLICY saldos_mensais_leitura ON public.saldos_mensais
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_orkestria_admin())
    OR (
      (SELECT public.get_my_tenant_id()) IS NOT DISTINCT FROM saldos_mensais.tenant_id
      AND (saldos_mensais.company_id IS NULL
           OR (SELECT public.get_my_company_id()) IS NULL
           OR (SELECT public.get_my_company_id()) = saldos_mensais.company_id)
      AND (saldos_mensais.company_id IS NULL
           OR (SELECT public.sou_cliente()) = false
           OR EXISTS (
             SELECT 1 FROM public.usuario_empresas ue
              WHERE ue.user_id = auth.uid()
                AND ue.company_id = saldos_mensais.company_id))
    )
  );

DROP POLICY IF EXISTS plano_contas_leitura ON public.plano_contas;
CREATE POLICY plano_contas_leitura ON public.plano_contas
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_orkestria_admin())
    OR (
      (SELECT public.get_my_tenant_id()) IS NOT DISTINCT FROM plano_contas.tenant_id
      AND (plano_contas.company_id IS NULL
           OR (SELECT public.get_my_company_id()) IS NULL
           OR (SELECT public.get_my_company_id()) = plano_contas.company_id)
      AND (plano_contas.company_id IS NULL
           OR (SELECT public.sou_cliente()) = false
           OR EXISTS (
             SELECT 1 FROM public.usuario_empresas ue
              WHERE ue.user_id = auth.uid()
                AND ue.company_id = plano_contas.company_id))
    )
  );