-- ============================================================
-- AJUSTE 03 (parte 2) — REMOÇÃO da alocação DRE/Balanço.
--
-- Seguro de aplicar: o motor (build-statements.ts, getMapa) já foi
-- trocado e agora deriva as linhas dos MARCOS, não mais da alocação.
-- Estas colunas ficaram sem nenhum leitor.
--
-- Aplicar SEMPRE depois de 20260818000001 (que cria os marcos).
-- ============================================================

-- ------------------------------------------------------------
-- 3) Remoção da alocação DRE/Balanço
-- ------------------------------------------------------------
-- A estrutura agora vem da hierarquia do plano; estas colunas não têm
-- mais leitor. Guardamos uma cópia antes de dropar, para conferência.
-- O backup precisa ser DEFENSIVO: `CREATE TABLE IF NOT EXISTS ... AS
-- SELECT` ainda analisa as colunas do SELECT mesmo quando a tabela já
-- existe. Ou seja, numa segunda execução (ou num banco onde as colunas
-- de alocação nunca chegaram a existir), a referência a
-- tipo_demonstracao explode com "column does not exist" e a migration
-- inteira falha. SQL dinâmico dentro de um IF resolve os dois casos.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'plano_contas'
       AND column_name = 'linha_demonstracao'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'backup_alocacao_removida'
  ) THEN
    EXECUTE $sql$
      CREATE TABLE public.backup_alocacao_removida AS
      SELECT id, tenant_id, company_id, codigo, classificacao, descricao,
             tipo_demonstracao, linha_demonstracao, ordem_linha, inverter_sinal
        FROM public.plano_contas
       WHERE linha_demonstracao IS NOT NULL
    $sql$;
    RAISE NOTICE 'Backup da alocação criado em public.backup_alocacao_removida';
  ELSE
    RAISE NOTICE 'Backup dispensado (colunas de alocação ausentes ou backup já existente)';
  END IF;
END $$;

ALTER TABLE public.plano_contas
  DROP CONSTRAINT IF EXISTS plano_contas_alocacao_chk;

DROP INDEX IF EXISTS public.idx_plano_contas_alocacao;

ALTER TABLE public.plano_contas
  DROP COLUMN IF EXISTS tipo_demonstracao,
  DROP COLUMN IF EXISTS linha_demonstracao,
  DROP COLUMN IF EXISTS ordem_linha;

-- inverter_sinal permanece: continua sendo usado para exibir passivo/
-- receita como positivo, e isso é propriedade da conta, não da alocação.

-- Legado sem leitor desde o ajuste 01.
DROP TABLE IF EXISTS public.mapeamento_demonstracao CASCADE;

-- Funções que só existiam para servir a alocação removida.
DROP FUNCTION IF EXISTS public.migrar_mapeamento_para_plano();
DROP FUNCTION IF EXISTS public.plano_pendencias(uuid, int);

-- ------------------------------------------------------------
-- 4) plano_cobertura passa a medir o que importa agora
-- ------------------------------------------------------------
-- Antes media "contas sem linha de demonstração". Agora o que pode
-- faltar é: marco (subtotais/indicadores) e flag de DFC.
CREATE OR REPLACE FUNCTION public.plano_cobertura(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid; _scope uuid; _sep text;
  _com_mov int := 0; _sem_dfc int := 0; _marcos int := 0;
  _mov_total numeric := 0; _mov_sem_dfc numeric := 0;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RETURN jsonb_build_object('autorizado', false);
  END IF;
  SELECT e.tenant_id, e.company_scope, e.separador
    INTO _tenant, _scope, _sep
    FROM public.plano_escopo(_company_id) e;
  IF _tenant IS NULL THEN
    RETURN jsonb_build_object('autorizado', true, 'contas_com_movimento', 0);
  END IF;

  WITH mov AS (
    SELECT s.conta_codigo, sum(s.movimento) AS movimento
      FROM public.saldos_mensais s
     WHERE s.company_id = _company_id
     GROUP BY s.conta_codigo
  ),
  j AS (
    SELECT p.codigo, p.tipo, p.is_sintetica, p.dfc_atividade, p.dfc_nao_caixa, m.movimento
      FROM mov m
      JOIN public.plano_contas p
        ON p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _scope
       AND p.codigo = m.conta_codigo
  )
  SELECT count(*),
         count(*) FILTER (
           WHERE is_sintetica = false AND dfc_atividade IS NULL AND dfc_nao_caixa = false
             AND tipo IN ('1-Ativo','2-Passivo','4-Cli. Nac.','5-For. Nac.','6-Cli. Ex.','7-For. Ex.')
         ),
         COALESCE(sum(abs(movimento)), 0),
         COALESCE(sum(abs(movimento)) FILTER (
           WHERE is_sintetica = false AND dfc_atividade IS NULL AND dfc_nao_caixa = false
             AND tipo IN ('1-Ativo','2-Passivo','4-Cli. Nac.','5-For. Nac.','6-Cli. Ex.','7-For. Ex.')
         ), 0)
    INTO _com_mov, _sem_dfc, _mov_total, _mov_sem_dfc
    FROM j;

  SELECT count(*) INTO _marcos
    FROM public.plano_contas
   WHERE tenant_id = _tenant
     AND company_id IS NOT DISTINCT FROM _scope
     AND marco IS NOT NULL;

  RETURN jsonb_build_object(
    'autorizado', true,
    'contas_com_movimento', _com_mov,
    'contas_sem_dfc', _sem_dfc,
    'movimento_total', _mov_total,
    'movimento_sem_dfc', _mov_sem_dfc,
    'marcos_definidos', _marcos,
    'cobertura_dfc_percentual',
      CASE WHEN _mov_total = 0 THEN 100
           ELSE round(((_mov_total - _mov_sem_dfc) / _mov_total) * 100, 2) END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.plano_cobertura(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.plano_cobertura(uuid) TO authenticated, service_role;

-- plano_padrao_resumo: troca "alocadas" por "marcos"
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
         count(*) FILTER (WHERE is_sintetica = false
                            AND dfc_atividade IS NULL
                            AND dfc_nao_caixa = false
                            AND tipo IN ('1-Ativo','2-Passivo'))
    INTO _total, _estruturais, _participantes, _marcos, _sem_dfc
    FROM public.plano_contas
   WHERE tenant_id = _tenant_id AND company_id IS NULL;

  SELECT count(*) INTO _novas FROM public.contas_novas_do_diario(_tenant_id, 100000);
  SELECT count(*) INTO _descartadas FROM public.plano_contas_descartadas WHERE tenant_id = _tenant_id;
  SELECT count(*) INTO _empresas FROM public.companies
   WHERE tenant_id = _tenant_id AND COALESCE(plano_tipo,'padrao') = 'padrao';
  SELECT max(created_at) INTO _ultima FROM public.plano_atualizacoes
   WHERE tenant_id = _tenant_id AND company_id IS NULL;

  RETURN jsonb_build_object(
    'autorizado', true,
    'total', _total,
    'estruturais', _estruturais,
    'participantes', _participantes,
    'marcos', _marcos,
    'sem_dfc', _sem_dfc,
    'contas_novas', _novas,
    'descartadas', _descartadas,
    'empresas_usando', _empresas,
    'ultima_atualizacao', _ultima
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.plano_padrao_resumo(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.plano_padrao_resumo(uuid) TO authenticated, service_role;
