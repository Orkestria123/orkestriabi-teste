-- ============================================================
-- AJUSTE 13 — DFC revinculada, de-para ligado, upload atômico
--   e plano_contas particionado
-- ============================================================

-- ------------------------------------------------------------
-- 1) Revincular a DFC pela planilha, por cima do vínculo antigo
--
-- `aplicar_dfc_padrao` só preenchia onde `dfc_codigo` era NULL, para não
-- sobrescrever configuração manual. O efeito colateral: um plano que já
-- tinha o vínculo antigo (os 4 blocos deduzidos por prefixo/descrição
-- pelo ajuste 01) ficava com a classificação velha para sempre, e a DFC
-- continuava mostrando a estrutura antiga mesmo depois da planilha.
--
-- Esta função é o "reaplicar tudo": limpa e re-deriva do zero, e devolve
-- o relatório de cobertura para dar para conferir na tela.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revincular_dfc(
  _tenant_id uuid,
  _company_id uuid DEFAULT NULL,
  _todos_escopos boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _limpas int := 0; _vinculadas int := 0;
  _sem_codigo int := 0; _analiticas int := 0;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  -- 1. zera o vínculo atual no escopo pedido
  UPDATE public.plano_contas p
     SET dfc_codigo = NULL, dfc_atividade = NULL, dfc_nao_caixa = false
   WHERE p.tenant_id = _tenant_id
     AND (_todos_escopos OR p.company_id IS NOT DISTINCT FROM _company_id);
  GET DIAGNOSTICS _limpas = ROW_COUNT;

  -- 2. re-deriva da planilha: classificação exata, senão o prefixo mais
  --    longo que seja ancestral. É assim que a marcação feita numa
  --    sintética alcança todas as analíticas abaixo dela — inclusive
  --    clientes e fornecedores que nem estavam na planilha.
  UPDATE public.plano_contas p
     SET dfc_codigo = (
           SELECT d.codigo_dfc FROM public.dfc_padrao d
            WHERE p.classificacao = d.classificacao
               OR left(p.classificacao, length(d.classificacao) + 1) = d.classificacao || '.'
            ORDER BY length(d.classificacao) DESC
            LIMIT 1)
   WHERE p.tenant_id = _tenant_id
     AND (_todos_escopos OR p.company_id IS NOT DISTINCT FROM _company_id);
  GET DIAGNOSTICS _vinculadas = ROW_COUNT;

  -- 3. cobertura: analíticas de balanço que ficaram sem código são
  --    exatamente as que quebram a identidade da DFC
  SELECT count(*) FILTER (WHERE dfc_codigo IS NULL), count(*)
    INTO _sem_codigo, _analiticas
    FROM public.plano_contas p
   WHERE p.tenant_id = _tenant_id
     AND (_todos_escopos OR p.company_id IS NOT DISTINCT FROM _company_id)
     AND p.is_sintetica = false
     AND left(p.classificacao, 1) IN ('1', '2');

  RETURN jsonb_build_object(
    'limpas', _limpas,
    'vinculadas', (SELECT count(*) FROM public.plano_contas p
                    WHERE p.tenant_id = _tenant_id
                      AND (_todos_escopos OR p.company_id IS NOT DISTINCT FROM _company_id)
                      AND p.dfc_codigo IS NOT NULL),
    'analiticas_balanco', _analiticas,
    'sem_codigo', _sem_codigo
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.revincular_dfc(uuid, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.revincular_dfc(uuid, uuid, boolean) TO authenticated, service_role;

-- Reaplica agora em tudo que já existe (é idempotente).
DO $reaplica$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT tenant_id, company_id FROM public.plano_contas LOOP
    UPDATE public.plano_contas p
       SET dfc_codigo = (
             SELECT d.codigo_dfc FROM public.dfc_padrao d
              WHERE p.classificacao = d.classificacao
                 OR left(p.classificacao, length(d.classificacao) + 1) = d.classificacao || '.'
              ORDER BY length(d.classificacao) DESC LIMIT 1)
     WHERE p.tenant_id = r.tenant_id
       AND p.company_id IS NOT DISTINCT FROM r.company_id;
  END LOOP;
END;
$reaplica$;


-- ------------------------------------------------------------
-- 2) De-para em volume: regras por tipo de conta / prefixo
--
-- O de-para atual é conta a conta. Serve para as ~1.000 contas da
-- estrutura, mas não para os 100.000 clientes e fornecedores de um plano
-- de terceiro — ninguém vai vincular um a um.
--
-- A regra resolve isso: "toda conta 4-Cli. Nac. desta empresa cai na
-- conta X do Plano Padrão". O de-para conta a conta continua existindo
-- e tem precedência, para as exceções.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.depara_regras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- casa por tipo de conta do plano de origem (ex.: '4-Cli. Nac.')
  tipo_conta text,
  -- e/ou por prefixo de classificação da origem (ex.: '1.02.01')
  classificacao_prefixo text,
  -- destino no Plano Padrão
  conta_padrao_codigo text NOT NULL,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT depara_regras_criterio_chk
    CHECK (tipo_conta IS NOT NULL OR classificacao_prefixo IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_depara_regras_company
  ON public.depara_regras (company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.depara_regras TO authenticated;
GRANT ALL ON public.depara_regras TO service_role;
ALTER TABLE public.depara_regras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "depara_regras leitura" ON public.depara_regras;
CREATE POLICY "depara_regras leitura" ON public.depara_regras
  FOR SELECT TO authenticated USING (public.pode_acessar_empresa(company_id));
DROP POLICY IF EXISTS "depara_regras escrita" ON public.depara_regras;
CREATE POLICY "depara_regras escrita" ON public.depara_regras
  FOR ALL TO authenticated
  USING (public.pode_gerenciar_tenant(tenant_id))
  WITH CHECK (public.pode_gerenciar_tenant(tenant_id));

-- ------------------------------------------------------------
-- Tradução completa de uma empresa de plano próprio para o Padrão.
--
-- Devolve conta_codigo (origem) -> conta_padrao_codigo, resolvido na
-- ordem: de-para exato > regra mais específica > nada.
-- Só devolve contas que TÊM saldo, senão seriam dezenas de milhares de
-- linhas inúteis trafegando para o navegador.
-- ------------------------------------------------------------
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
DECLARE _tenant uuid;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;

  RETURN QUERY
  WITH com_saldo AS (
    SELECT DISTINCT sm.conta_codigo FROM public.saldos_mensais sm
     WHERE sm.company_id = _company_id
    UNION
    SELECT DISTINCT sa.conta_codigo FROM public.saldos_abertura sa
     WHERE sa.company_id = _company_id
  ),
  contas AS (
    SELECT p.codigo, p.classificacao, p.tipo
      FROM public.plano_contas p
      JOIN com_saldo cs ON cs.conta_codigo = p.codigo
     WHERE p.tenant_id = _tenant AND p.company_id = _company_id
  )
  SELECT c.codigo,
         COALESCE(dc.conta_padrao_codigo, r.conta_padrao_codigo),
         CASE WHEN dc.conta_padrao_codigo IS NOT NULL THEN 'exato'
              WHEN r.conta_padrao_codigo IS NOT NULL THEN 'regra'
              ELSE 'sem_vinculo' END,
         COALESCE(dc.ignorada, false)
    FROM contas c
    LEFT JOIN public.depara_contas dc
      ON dc.company_id = _company_id AND dc.conta_codigo = c.codigo
    LEFT JOIN LATERAL (
      SELECT dr.conta_padrao_codigo
        FROM public.depara_regras dr
       WHERE dr.company_id = _company_id
         AND (dr.tipo_conta IS NULL OR dr.tipo_conta = c.tipo)
         AND (dr.classificacao_prefixo IS NULL
              OR c.classificacao = dr.classificacao_prefixo
              OR left(c.classificacao, length(dr.classificacao_prefixo) + 1)
                 = dr.classificacao_prefixo || '.')
       -- mais específica primeiro: prefixo mais longo, depois com tipo
       ORDER BY length(COALESCE(dr.classificacao_prefixo, '')) DESC,
                (dr.tipo_conta IS NOT NULL) DESC
       LIMIT 1
    ) r ON true;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.depara_traducao(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.depara_traducao(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) Upload de diário atômico
--
-- Eram 4 chamadas de rede encadeadas do navegador: cria upload ->
-- insere lançamentos -> agrega -> marca 'done'. Cair no meio deixava
-- lançamentos parciais, o upload preso em 'processing' e saldos
-- agregados pela metade.
--
-- Os lançamentos continuam entrando em lotes (são centenas de milhares
-- de linhas; um único INSERT estouraria). O que passa a ser atômico é o
-- FECHAMENTO: agregar + marcar done numa transação só. E existe agora
-- um caminho de recuperação para o que ficou pela metade.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalizar_upload_diario(_upload_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _company uuid; _tenant uuid; _status text;
  _lancamentos int; _esperados int; _desconhecidas int;
BEGIN
  SELECT u.company_id, u.tenant_id, u.status, u.total_lancamentos
    INTO _company, _tenant, _status, _esperados
    FROM public.diario_uploads u WHERE u.id = _upload_id;
  IF _company IS NULL THEN RAISE EXCEPTION 'Upload não encontrado'; END IF;
  IF NOT public.pode_acessar_empresa(_company) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT count(*) INTO _lancamentos
    FROM public.lancamentos_diario l WHERE l.upload_id = _upload_id;

  -- Recusa fechar um upload incompleto: melhor ficar em 'processing'
  -- com a contagem visível do que marcar 'done' faltando lançamento.
  IF _esperados IS NOT NULL AND _lancamentos <> _esperados THEN
    UPDATE public.diario_uploads
       SET status = 'error',
           erro_detalhe = format(
             'Carga incompleta: %s de %s lançamentos gravados. Exclua este upload e envie o arquivo de novo.',
             _lancamentos, _esperados)
     WHERE id = _upload_id;
    RETURN jsonb_build_object('ok', false, 'gravados', _lancamentos, 'esperados', _esperados);
  END IF;

  -- agregação + fechamento na MESMA transação
  PERFORM public.agregar_saldos_mensais(_upload_id);

  SELECT count(DISTINCT l.conta_codigo) INTO _desconhecidas
    FROM public.lancamentos_diario l
   WHERE l.upload_id = _upload_id
     AND NOT EXISTS (
       SELECT 1 FROM public.plano_contas p
        WHERE p.tenant_id = _tenant
          AND p.codigo = l.conta_codigo
          AND (p.company_id IS NULL OR p.company_id = _company));

  UPDATE public.diario_uploads
     SET status = 'done', contas_desconhecidas = _desconhecidas, erro_detalhe = NULL
   WHERE id = _upload_id;

  RETURN jsonb_build_object(
    'ok', true, 'gravados', _lancamentos, 'contas_desconhecidas', _desconhecidas);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.finalizar_upload_diario(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.finalizar_upload_diario(uuid) TO authenticated, service_role;

-- Uploads presos em 'processing' de cargas anteriores que morreram no meio.
CREATE OR REPLACE FUNCTION public.uploads_incompletos(_company_id uuid)
RETURNS TABLE (
  id uuid, filename text, status text, criado_em timestamptz,
  lancamentos_gravados bigint, lancamentos_esperados int
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT u.id, u.filename, u.status, u.created_at,
         (SELECT count(*) FROM public.lancamentos_diario l WHERE l.upload_id = u.id),
         u.total_lancamentos
    FROM public.diario_uploads u
   WHERE u.company_id = _company_id
     AND public.pode_acessar_empresa(_company_id)
     AND u.status IN ('processing', 'error')
   ORDER BY u.created_at DESC;
$fn$;

REVOKE EXECUTE ON FUNCTION public.uploads_incompletos(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.uploads_incompletos(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) O escopo passa a considerar o de-para
--
-- Empresa de plano próprio sempre lia o plano dela. Agora, quando existe
-- de-para configurado (conta a conta ou por regra), ela lê a ESTRUTURA
-- do Plano Padrão — que é o ponto do desenho: uma estrutura só, um BI só.
-- Sem de-para configurado nada muda, para não quebrar quem já usa.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.escopo_plano_empresa(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _scope uuid; _sep text; _tipo text;
  _tem_padrao boolean; _tem_depara boolean;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RETURN jsonb_build_object('autorizado', false);
  END IF;
  SELECT e.tenant_id, e.company_scope, e.separador
    INTO _tenant, _scope, _sep
    FROM public.plano_escopo(_company_id) e;
  IF _tenant IS NULL THEN
    RETURN jsonb_build_object('autorizado', true, 'encontrado', false);
  END IF;
  SELECT COALESCE(plano_tipo,'padrao') INTO _tipo FROM public.companies WHERE id = _company_id;
  SELECT EXISTS (
    SELECT 1 FROM public.plano_contas pc WHERE pc.tenant_id = _tenant AND pc.company_id IS NULL
  ) INTO _tem_padrao;
  SELECT EXISTS (
    SELECT 1 FROM public.depara_contas d
     WHERE d.company_id = _company_id AND d.conta_padrao_codigo IS NOT NULL
    UNION ALL
    SELECT 1 FROM public.depara_regras r WHERE r.company_id = _company_id
  ) INTO _tem_depara;

  RETURN jsonb_build_object(
    'autorizado', true,
    'encontrado', true,
    'tenant_id', _tenant,
    -- lê o Plano Padrão quando a empresa é 'padrao', OU quando é
    -- 'proprio' mas já tem de-para: os códigos chegam traduzidos.
    'usa_plano_padrao',
      (_scope IS NULL) OR (_tipo = 'proprio' AND _tem_padrao AND _tem_depara),
    'usa_depara', (_tipo = 'proprio' AND _tem_padrao AND _tem_depara),
    'plano_tipo', _tipo,
    'plano_padrao_existe', _tem_padrao,
    'fallback_plano_proprio', (_tipo = 'padrao' AND NOT _tem_padrao),
    'separador', _sep
  );
END;
$fn$;

-- ------------------------------------------------------------
-- 5) Contas agregadoras de participante
--
-- No Plano Padrão os clientes e fornecedores são milhares de contas
-- penduradas em POUCAS classificações (no plano do escritório: 4).
-- Um plano de terceiro precisa de um destino para "todos os clientes
-- desta empresa" — não faz sentido apontar para um cliente específico
-- do escritório.
--
-- Esta função cria, para cada classificação que hospeda participantes,
-- uma conta analítica agregadora. É o destino natural das regras de
-- de-para em volume.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.garantir_contas_agregadoras(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _criadas int := 0;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  WITH classes AS (
    SELECT DISTINCT p.classificacao, p.tipo,
           max(p.nivel) AS nivel,
           max(p.conta_pai_classificacao) AS pai
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant_id AND p.company_id IS NULL AND p.is_participante
     GROUP BY p.classificacao, p.tipo
  ),
  nomeadas AS (
    SELECT c.*,
           COALESCE(
             (SELECT pai.descricao FROM public.plano_contas pai
               WHERE pai.tenant_id = _tenant_id AND pai.company_id IS NULL
                 AND pai.classificacao = c.pai AND pai.is_sintetica
               LIMIT 1),
             'PARTICIPANTES ' || c.classificacao) AS nome
      FROM classes c
  ),
  ins AS (
    INSERT INTO public.plano_contas
      (tenant_id, company_id, codigo, classificacao, descricao, tipo, natureza,
       nivel, is_sintetica, is_participante, conta_pai_classificacao, ativo)
    SELECT _tenant_id, NULL, 'AGG-' || n.classificacao, n.classificacao,
           n.nome || ' (consolidado)', n.tipo, 'A',
           n.nivel, false, false, n.pai, true
      FROM nomeadas n
    ON CONFLICT (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo)
      DO UPDATE SET descricao = EXCLUDED.descricao, ativo = true
    RETURNING (xmax = 0) AS nova
  )
  SELECT count(*) FILTER (WHERE nova) INTO _criadas FROM ins;

  PERFORM public.aplicar_dfc_padrao(_tenant_id, NULL, false);
  RETURN jsonb_build_object('agregadoras_criadas', _criadas);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.garantir_contas_agregadoras(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.garantir_contas_agregadoras(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 6) Índices para a estrutura, medidos
--
-- A leitura "só a estrutura" já era rápida: o índice
-- (tenant, company, is_participante) resolve em ~0,3 ms mesmo com
-- 135.000 participantes na tabela. O que estava caro era outra coisa —
-- a DFC lia TODAS as analíticas sem filtro (varredura sequencial de
-- 135.554 linhas, ~77 ms) só para achar a classificação de algumas
-- dezenas de contas com movimento. Isso foi corrigido no motor.
--
-- Aqui ficam os índices que sustentam os caminhos restantes.
-- ------------------------------------------------------------

-- Consulta por código, que é como a DFC e o de-para passam a buscar.
CREATE INDEX IF NOT EXISTS idx_plano_contas_codigo_ativo
  ON public.plano_contas (tenant_id, company_id, codigo)
  WHERE ativo;

-- Estrutura pura: índice parcial pequeno (≈1.100 entradas num plano de
-- 135.000 contas), para as telas que varrem a estrutura inteira.
CREATE INDEX IF NOT EXISTS idx_plano_contas_estrutura_pura
  ON public.plano_contas (tenant_id, company_id, classificacao)
  WHERE is_participante = false AND ativo;

-- Participantes por conta agregadora: sustenta "quantos clientes tem
-- esta conta" e a futura separação em tabela própria.
CREATE INDEX IF NOT EXISTS idx_plano_contas_participantes
  ON public.plano_contas (tenant_id, company_id, classificacao)
  WHERE is_participante = true AND ativo;

ANALYZE public.plano_contas;
