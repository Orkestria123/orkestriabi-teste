-- ============================================================
-- AJUSTE 02 — o Plano Padrão vira o coração do BI, gerenciado
-- FORA da empresa (nível escritório/tenant).
--
-- Mudanças de conceito:
--
--  1. Empresa marcada como 'padrao' passa a LER o Plano Padrão do
--     escritório (company_id IS NULL) em vez de ter uma cópia própria.
--     Alocar uma conta uma vez no Plano Padrão vale para todas as
--     empresas do sistema contábil — é o que faz o plano "gerar todas
--     as ferramentas de BI".
--
--  2. Empresa marcada como 'proprio' (sistema de terceiro) continua
--     com plano próprio + de-para por empresa (ajuste 01).
--
--  3. O DIÁRIO é a fonte de dados do BI. Conta que aparece em
--     lançamento e não existe no Plano Padrão vira uma PENDÊNCIA de
--     revisão — nunca entra sozinha. A aprovação é explícita.
--
-- Compatibilidade: se o Plano Padrão do tenant ainda estiver vazio,
-- a resolução de escopo CAI DE VOLTA para o plano da própria empresa.
-- Assim nada quebra em quem já tinha plano por empresa; a tela nova
-- oferece o botão de promover esse plano para Plano Padrão.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Guarda de autorização em nível de escritório
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pode_gerenciar_tenant(_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _tenant_id IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_orkestria_admin() THEN
    RETURN true;
  END IF;
  -- Plano Padrão é estrutura do escritório: só tenant_admin mexe.
  RETURN public.get_my_tenant_id() = _tenant_id
     AND public.has_role(auth.uid(), 'tenant_admin');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pode_gerenciar_tenant(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.pode_gerenciar_tenant(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2) Escopo do plano agora é dirigido por companies.plano_tipo
-- ------------------------------------------------------------
-- Substitui a versão do ajuste 01, que olhava só tenants.plano_contas_modo.
CREATE OR REPLACE FUNCTION public.plano_escopo(_company_id uuid)
RETURNS TABLE (tenant_id uuid, company_scope uuid, separador text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
  _tipo text;
  _modo text;
  _scope uuid;
  _sep text;
  _tem_padrao boolean;
BEGIN
  SELECT c.tenant_id, COALESCE(c.plano_tipo,'padrao'), COALESCE(t.plano_contas_modo,'empresa')
    INTO _tenant, _tipo, _modo
    FROM public.companies c
    JOIN public.tenants t ON t.id = c.tenant_id
   WHERE c.id = _company_id;

  IF _tenant IS NULL THEN
    RETURN;
  END IF;

  -- Aliases obrigatórios: os nomes do RETURNS TABLE (tenant_id,
  -- company_scope, separador) viram variáveis plpgsql dentro da
  -- função, então uma referência não-qualificada a `tenant_id` fica
  -- ambígua entre a variável e a coluna da tabela.
  SELECT EXISTS (
    SELECT 1 FROM public.plano_contas pc
     WHERE pc.tenant_id = _tenant AND pc.company_id IS NULL
  ) INTO _tem_padrao;

  -- Empresa do nosso sistema contábil (ou tenant em modo global):
  -- lê o Plano Padrão. Só cai para o plano próprio se o Padrão ainda
  -- não existir — evita quebrar quem configurou antes deste ajuste.
  IF (_tipo = 'padrao' OR _modo = 'global') AND _tem_padrao THEN
    _scope := NULL;
  ELSE
    _scope := _company_id;
  END IF;

  SELECT COALESCE(mc.separador, '.') INTO _sep
    FROM public.mascara_classificacao mc
   WHERE mc.tenant_id = _tenant
     AND mc.company_id IS NOT DISTINCT FROM _scope
   LIMIT 1;

  -- Sem máscara no escopo exato, usa a do tenant; por fim, o default '.'
  IF _sep IS NULL THEN
    SELECT COALESCE(mc.separador, '.') INTO _sep
      FROM public.mascara_classificacao mc
     WHERE mc.tenant_id = _tenant
     LIMIT 1;
  END IF;

  RETURN QUERY SELECT _tenant, _scope, COALESCE(_sep, '.');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.plano_escopo(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.plano_escopo(uuid) TO authenticated, service_role;

-- Versão jsonb para o cliente (o front precisa saber se usa o Padrão).
CREATE OR REPLACE FUNCTION public.escopo_plano_empresa(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid; _scope uuid; _sep text; _tipo text; _tem_padrao boolean;
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

  RETURN jsonb_build_object(
    'autorizado', true,
    'encontrado', true,
    'tenant_id', _tenant,
    'usa_plano_padrao', _scope IS NULL,
    'plano_tipo', _tipo,
    'plano_padrao_existe', _tem_padrao,
    -- true = empresa marcada como 'padrao' mas o Plano Padrão está
    -- vazio, então segue lendo o plano próprio. A tela avisa.
    'fallback_plano_proprio', (_tipo = 'padrao' AND NOT _tem_padrao),
    'separador', _sep
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.escopo_plano_empresa(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.escopo_plano_empresa(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) Contas descartadas — para não reaparecerem na fila
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plano_contas_descartadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  motivo text,
  descartado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plano_contas_descartadas_unica UNIQUE (tenant_id, codigo)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plano_contas_descartadas TO authenticated;
GRANT ALL ON public.plano_contas_descartadas TO service_role;
ALTER TABLE public.plano_contas_descartadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "descartadas tenant read" ON public.plano_contas_descartadas;
CREATE POLICY "descartadas tenant read"
  ON public.plano_contas_descartadas FOR SELECT TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

DROP POLICY IF EXISTS "descartadas tenant write" ON public.plano_contas_descartadas;
CREATE POLICY "descartadas tenant write"
  ON public.plano_contas_descartadas FOR ALL TO authenticated
  USING (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()))
  WITH CHECK (tenant_id = (select public.get_my_tenant_id()) OR (select public.is_orkestria_admin()));

-- ------------------------------------------------------------
-- 4) Contas novas vindas do DIÁRIO
-- ------------------------------------------------------------
-- O diário só carrega o CÓDIGO da conta — não traz descrição nem
-- classificação. Por isso a fila devolve as EVIDÊNCIAS (valor
-- movimentado, nº de lançamentos, histórico de exemplo, em quais
-- empresas apareceu) para o usuário decidir com contexto, e a
-- classificação/descrição é preenchida na aprovação.
CREATE OR REPLACE FUNCTION public.contas_novas_do_diario(_tenant_id uuid, _limite int DEFAULT 300)
RETURNS TABLE (
  codigo text,
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
    -- Só empresas que efetivamente usam o Plano Padrão. Conta de
    -- empresa com plano de terceiro não deve poluir o Padrão: o
    -- caminho dela é o de-para.
    SELECT c.id, c.name
      FROM public.companies c
     WHERE c.tenant_id = _tenant_id
       AND COALESCE(c.plano_tipo,'padrao') = 'padrao'
  ),
  mov AS (
    SELECT l.conta_codigo,
           SUM(l.debito - l.credito)        AS movimento,
           COUNT(*)                         AS lancamentos,
           MIN(l.competencia)               AS primeira,
           MAX(l.competencia)               AS ultima,
           MIN(NULLIF(btrim(l.historico), '')) AS historico,
           string_agg(DISTINCT e.name, ', ') AS empresas
      FROM public.lancamentos_diario l
      JOIN empresas_padrao e ON e.id = l.company_id
     WHERE l.tenant_id = _tenant_id
     GROUP BY l.conta_codigo
  )
  SELECT m.conta_codigo, m.movimento, m.lancamentos, m.historico,
         m.empresas, m.primeira, m.ultima
    FROM mov m
   WHERE NOT EXISTS (
     SELECT 1 FROM public.plano_contas p
      WHERE p.tenant_id = _tenant_id
        AND p.company_id IS NULL
        AND p.codigo = m.conta_codigo
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

-- ------------------------------------------------------------
-- 5) Aprovar contas novas -> entram no Plano Padrão
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aprovar_contas_novas(_tenant_id uuid, _itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inseridas int := 0;
  _sep text;
BEGIN
  IF NOT public.pode_gerenciar_tenant(_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Plano Padrão deste escritório';
  END IF;

  SELECT COALESCE(mc.separador,'.') INTO _sep
    FROM public.mascara_classificacao mc
   WHERE mc.tenant_id = _tenant_id LIMIT 1;
  _sep := COALESCE(_sep, '.');

  WITH entrada AS (
    SELECT DISTINCT ON (x.codigo) x.*
      FROM jsonb_to_recordset(_itens) AS x(
        codigo text,
        classificacao text,
        descricao text,
        tipo text,
        natureza text
      )
     WHERE x.codigo IS NOT NULL
       AND x.classificacao IS NOT NULL
       AND btrim(x.classificacao) <> ''
     ORDER BY x.codigo
  ),
  ins AS (
    INSERT INTO public.plano_contas (
      tenant_id, company_id, codigo, classificacao, descricao, tipo,
      natureza, nivel, is_participante, is_sintetica, conta_pai_classificacao, ativo
    )
    SELECT _tenant_id, NULL, e.codigo, e.classificacao,
           COALESCE(NULLIF(btrim(e.descricao),''), e.codigo),
           COALESCE(e.tipo, 'Indefinido'),
           -- conta com movimento no diário é, por definição, analítica
           'A',
           array_length(string_to_array(e.classificacao, _sep), 1),
           false,
           false,
           CASE
             WHEN array_length(string_to_array(e.classificacao, _sep), 1) > 1
             THEN array_to_string(
                    (string_to_array(e.classificacao, _sep))[
                      1 : array_length(string_to_array(e.classificacao, _sep), 1) - 1
                    ], _sep)
             ELSE NULL
           END,
           true
      FROM entrada e
    ON CONFLICT (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo)
    DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _inseridas FROM ins;

  INSERT INTO public.plano_atualizacoes (tenant_id, company_id, filename, total_arquivo, novas, atualizadas, inalteradas)
  VALUES (_tenant_id, NULL, 'Contas novas aprovadas do diário',
          jsonb_array_length(_itens), _inseridas, 0, 0);

  RETURN jsonb_build_object('inseridas', _inseridas);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.aprovar_contas_novas(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.aprovar_contas_novas(uuid, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 6) Descartar contas novas (não pertencem ao Plano Padrão)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.descartar_contas_novas(
  _tenant_id uuid, _codigos text[], _motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int := 0;
BEGIN
  IF NOT public.pode_gerenciar_tenant(_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Plano Padrão deste escritório';
  END IF;

  WITH ins AS (
    INSERT INTO public.plano_contas_descartadas (tenant_id, codigo, motivo, descartado_por)
    SELECT _tenant_id, c, _motivo, auth.uid()
      FROM unnest(_codigos) AS c
    ON CONFLICT (tenant_id, codigo) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM ins;

  RETURN jsonb_build_object('descartadas', _n);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.descartar_contas_novas(uuid, text[], text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.descartar_contas_novas(uuid, text[], text) TO authenticated, service_role;

-- Desfazer um descarte (volta para a fila)
CREATE OR REPLACE FUNCTION public.restaurar_conta_descartada(_tenant_id uuid, _codigo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.pode_gerenciar_tenant(_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Plano Padrão deste escritório';
  END IF;
  DELETE FROM public.plano_contas_descartadas
   WHERE tenant_id = _tenant_id AND codigo = _codigo;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restaurar_conta_descartada(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.restaurar_conta_descartada(uuid, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 7) Promover o plano de uma empresa para Plano Padrão
-- ------------------------------------------------------------
-- Caminho de migração para quem já tinha plano por empresa antes
-- deste ajuste: copia as contas (e as alocações já feitas) para o
-- Plano Padrão. Não apaga o plano da empresa — só copia o que falta.
CREATE OR REPLACE FUNCTION public.promover_plano_empresa(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
  _n int := 0;
BEGIN
  SELECT tenant_id INTO _tenant FROM public.companies WHERE id = _company_id;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'Empresa não encontrada';
  END IF;
  IF NOT public.pode_gerenciar_tenant(_tenant) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Plano Padrão deste escritório';
  END IF;

  WITH ins AS (
    INSERT INTO public.plano_contas (
      tenant_id, company_id, codigo, classificacao, descricao, tipo, natureza,
      nivel, is_participante, is_sintetica, conta_pai_classificacao, ativo,
      tipo_demonstracao, linha_demonstracao, ordem_linha, inverter_sinal,
      tipo_custo, dfc_atividade, dfc_nao_caixa
    )
    SELECT p.tenant_id, NULL, p.codigo, p.classificacao, p.descricao, p.tipo, p.natureza,
           p.nivel, p.is_participante, p.is_sintetica, p.conta_pai_classificacao, p.ativo,
           p.tipo_demonstracao, p.linha_demonstracao, p.ordem_linha, p.inverter_sinal,
           p.tipo_custo, p.dfc_atividade, p.dfc_nao_caixa
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant
       AND p.company_id = _company_id
    ON CONFLICT (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo)
    DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM ins;

  RETURN jsonb_build_object('copiadas', _n);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promover_plano_empresa(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.promover_plano_empresa(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 8) Resumo do Plano Padrão — cabeçalho da tela nova
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.plano_padrao_resumo(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total int := 0; _estruturais int := 0; _participantes int := 0;
  _alocadas int := 0; _sem_dfc int := 0; _novas int := 0; _descartadas int := 0;
  _empresas int := 0; _ultima timestamptz;
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RETURN jsonb_build_object('autorizado', false);
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE is_participante = false),
         count(*) FILTER (WHERE is_participante = true),
         count(*) FILTER (WHERE linha_demonstracao IS NOT NULL),
         count(*) FILTER (WHERE is_sintetica = false
                            AND dfc_atividade IS NULL
                            AND dfc_nao_caixa = false
                            AND tipo IN ('1-Ativo','2-Passivo'))
    INTO _total, _estruturais, _participantes, _alocadas, _sem_dfc
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
    'alocadas', _alocadas,
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
