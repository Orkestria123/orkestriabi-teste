-- ============================================================
-- AJUSTE 28 — indicadores globais + alocação por empresa
-- ============================================================
--
-- Hoje cada empresa tem a SUA cópia de cada indicador: 17 indicadores em
-- 3 empresas são 51 linhas. Mudar a fórmula da Margem Líquida significa
-- mudar em 3 lugares — e o dia em que uma ficar para trás ninguém
-- descobre, porque as três continuam calculando alguma coisa.
--
-- A fórmula já é global por construção: os termos apontam para
-- CLASSIFICAÇÕES do plano padrão, não para códigos da empresa. O que
-- varia de empresa para empresa não é a fórmula — é se aquele indicador
-- interessa àquele cliente. Então:
--
--   • a DEFINIÇÃO passa a viver no escritório (company_id IS NULL),
--     exatamente como o plano de contas padrão;
--   • cada empresa ALOCA os que quer ver, e com qual visibilidade.
--
-- NADA É APAGADO POR ESTA MIGRAÇÃO. As cópias por empresa continuam
-- válidas e funcionando; a tela passa a mostrar as duas coisas, com a
-- origem marcada. A consolidação (transformar as 51 cópias em 17
-- definições + 51 alocações) é um BOTÃO, com simulação antes, não um
-- efeito colateral de rodar a migração.

-- ------------------------------------------------------------
-- 1) company_id nulo = definição do escritório
-- ------------------------------------------------------------
ALTER TABLE public.indicadores_empresa
  ALTER COLUMN company_id DROP NOT NULL;

COMMENT ON COLUMN public.indicadores_empresa.company_id IS
  'NULL = definição global do escritório (vale para todas as empresas, '
  'com a visibilidade escolhida em indicador_alocacao). Preenchido = '
  'indicador local daquela empresa.';

-- Dois indicadores globais com o mesmo nome seriam indistinguíveis na
-- tela de alocação. O índice é parcial: cópias por empresa podem repetir
-- nome à vontade (é o que já acontece hoje).
CREATE UNIQUE INDEX IF NOT EXISTS uq_indicador_global_nome
  ON public.indicadores_empresa (tenant_id, lower(nome))
  WHERE company_id IS NULL;

-- ------------------------------------------------------------
-- 2) Alocação: qual empresa vê qual indicador, e onde
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.indicador_alocacao (
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id)   ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  indicador_id uuid NOT NULL REFERENCES public.indicadores_empresa(id) ON DELETE CASCADE,
  -- Mesmos valores de `indicadores_empresa.visibilidade`: a alocação é
  -- uma SOBRESCRITA da visibilidade padrão do indicador, não um segundo
  -- conceito.
  visibilidade text NOT NULL DEFAULT 'indicadores'
    CHECK (visibilidade IN ('invisivel','indicadores','dashboard','ambos')),
  ordem        int,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, indicador_id)
);

CREATE INDEX IF NOT EXISTS idx_indicador_alocacao_ind
  ON public.indicador_alocacao (indicador_id);

-- GRANT antes de RLS. Foi exatamente o que faltou no ECD (ajuste 25): a
-- política estava escrita, o GRANT não, e a tela recebia lista vazia sem
-- nenhum erro visível.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.indicador_alocacao TO authenticated;
GRANT ALL ON public.indicador_alocacao TO service_role;

ALTER TABLE public.indicador_alocacao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "indic_aloc_select" ON public.indicador_alocacao;
CREATE POLICY "indic_aloc_select"
ON public.indicador_alocacao FOR SELECT TO authenticated
USING (public.is_orkestria_admin() OR tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "indic_aloc_escrita" ON public.indicador_alocacao;
CREATE POLICY "indic_aloc_escrita"
ON public.indicador_alocacao FOR ALL TO authenticated
USING (
  public.is_orkestria_admin()
  OR (public.has_role(auth.uid(), 'tenant_admin') AND tenant_id = public.get_my_tenant_id())
)
WITH CHECK (
  public.is_orkestria_admin()
  OR (public.has_role(auth.uid(), 'tenant_admin') AND tenant_id = public.get_my_tenant_id())
);

-- ------------------------------------------------------------
-- 3) A lista efetiva de uma empresa
-- ------------------------------------------------------------
-- Regra da visibilidade, e ela importa: a alocação SOBRESCREVE; sem
-- alocação vale o que o indicador global diz. Se fosse o contrário
-- ("só aparece o que foi alocado"), ligar a migração apagaria os
-- indicadores de todas as empresas até alguém alocar um por um.
CREATE OR REPLACE FUNCTION public.indicadores_da_empresa(_company_id uuid)
RETURNS TABLE (
  id             uuid,
  nome           text,
  categoria      text,
  formula        jsonb,
  modo_analise   text,
  faixas         jsonb,
  descricao      text,
  visibilidade   text,
  is_padrao      boolean,
  revisar_contas boolean,
  ordem          int,
  escopo         text,
  alocado        boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT i.id, i.nome, i.categoria, i.formula, i.modo_analise, i.faixas,
         i.descricao,
         COALESCE(a.visibilidade, i.visibilidade) AS visibilidade,
         i.is_padrao, i.revisar_contas,
         COALESCE(a.ordem, i.ordem) AS ordem,
         CASE WHEN i.company_id IS NULL THEN 'global' ELSE 'empresa' END AS escopo,
         (a.company_id IS NOT NULL) AS alocado
    FROM public.indicadores_empresa i
    LEFT JOIN public.indicador_alocacao a
           ON a.indicador_id = i.id AND a.company_id = _company_id
   WHERE public.pode_acessar_empresa(_company_id)
     AND (
       i.company_id = _company_id
       OR (i.company_id IS NULL
           AND i.tenant_id = (SELECT c.tenant_id FROM public.companies c
                               WHERE c.id = _company_id))
     )
   ORDER BY COALESCE(a.ordem, i.ordem), i.nome;
$fn$;

REVOKE EXECUTE ON FUNCTION public.indicadores_da_empresa(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.indicadores_da_empresa(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) Alocar em lote
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.indicador_alocar(_company_id uuid, _itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _tenant uuid; _n int := 0;
BEGIN
  IF NOT public.pode_acessar_empresa(_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para alocar indicadores desta empresa';
  END IF;
  SELECT c.tenant_id INTO _tenant FROM public.companies c WHERE c.id = _company_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;

  WITH entrada AS (
    SELECT DISTINCT ON (x.indicador_id) x.*
      FROM jsonb_to_recordset(_itens)
        AS x(indicador_id uuid, visibilidade text, ordem int)
     WHERE x.indicador_id IS NOT NULL
     ORDER BY x.indicador_id
  ),
  gravadas AS (
    INSERT INTO public.indicador_alocacao
      (tenant_id, company_id, indicador_id, visibilidade, ordem)
    SELECT _tenant, _company_id, e.indicador_id,
           COALESCE(e.visibilidade, 'indicadores'), e.ordem
      FROM entrada e
      -- Só indicadores que esta empresa pode ver: o global do próprio
      -- tenant, ou uma cópia local dela mesma.
      JOIN public.indicadores_empresa i ON i.id = e.indicador_id
     WHERE i.tenant_id = _tenant
       AND (i.company_id IS NULL OR i.company_id = _company_id)
    ON CONFLICT (company_id, indicador_id) DO UPDATE SET
      visibilidade = EXCLUDED.visibilidade,
      ordem        = EXCLUDED.ordem,
      updated_at   = now()
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM gravadas;

  RETURN jsonb_build_object('gravadas', _n);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.indicador_alocar(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.indicador_alocar(uuid, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5) Consolidar as cópias por empresa em definições globais
-- ------------------------------------------------------------
-- Este é o único ponto que apaga alguma coisa, e por isso:
--   • roda só quando alguém clica;
--   • tem `_simular` — o botão mostra o que vai acontecer ANTES;
--   • só consolida grupos IDÊNTICOS (mesma fórmula, mesmo modo, mesmas
--     faixas, mesma categoria). Onde as empresas divergem, não toca em
--     nada e devolve a lista dos nomes divergentes para você olhar.
-- Consolidar um grupo divergente escolheria em silêncio qual versão
-- sobrevive — é o tipo de erro que só aparece meses depois, num número
-- que ninguém confere.
CREATE OR REPLACE FUNCTION public.indicador_consolidar(_simular boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid;
  _iguais int := 0; _empresas int := 0; _novos int := 0; _alocacoes int := 0;
  _divergentes text[] := '{}';
  _ja_global text[] := '{}';
  _g record;
BEGIN
  _tenant := public.get_my_tenant_id();
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'Sem tenant no contexto';
  END IF;
  IF NOT (public.is_orkestria_admin()
          OR public.has_role(auth.uid(), 'tenant_admin')) THEN
    RAISE EXCEPTION 'Só administrador do escritório pode consolidar indicadores';
  END IF;

  CREATE TEMP TABLE _grupos ON COMMIT DROP AS
  SELECT lower(i.nome)                        AS chave,
         min(i.nome)                          AS nome,
         count(*)                             AS copias,
         count(DISTINCT i.company_id)         AS empresas,
         count(DISTINCT i.formula::text)      AS formulas,
         count(DISTINCT i.modo_analise)       AS modos,
         count(DISTINCT COALESCE(i.faixas::text,''))    AS faixas,
         count(DISTINCT COALESCE(i.categoria,''))       AS categorias,
         false                                          AS ja_global
    FROM public.indicadores_empresa i
   WHERE i.tenant_id = _tenant AND i.company_id IS NOT NULL
   GROUP BY lower(i.nome);

  -- Em passo separado: dentro do GROUP BY, `i.nome` não está agrupado e
  -- o EXISTS correlacionado não compila.
  UPDATE _grupos g
     SET ja_global = EXISTS (
       SELECT 1 FROM public.indicadores_empresa x
        WHERE x.tenant_id = _tenant AND x.company_id IS NULL
          AND lower(x.nome) = g.chave);

  SELECT count(*), COALESCE(sum(empresas),0)
    INTO _iguais, _empresas
    FROM _grupos
   WHERE formulas = 1 AND modos = 1 AND faixas = 1 AND categorias = 1 AND NOT ja_global;

  SELECT COALESCE(array_agg(nome ORDER BY nome), '{}')
    INTO _divergentes FROM _grupos
   WHERE NOT (formulas = 1 AND modos = 1 AND faixas = 1 AND categorias = 1);

  SELECT COALESCE(array_agg(nome ORDER BY nome), '{}')
    INTO _ja_global FROM _grupos WHERE ja_global;

  IF _simular THEN
    RETURN jsonb_build_object(
      'simulacao', true,
      'consolidaveis', _iguais,
      'copias_afetadas', _empresas,
      'divergentes', to_jsonb(_divergentes),
      'ja_existe_global', to_jsonb(_ja_global));
  END IF;

  FOR _g IN
    SELECT chave, nome FROM _grupos
     WHERE formulas = 1 AND modos = 1 AND faixas = 1 AND categorias = 1 AND NOT ja_global
  LOOP
    -- Uma definição global copiada de qualquer uma das cópias (são
    -- idênticas por construção do filtro acima).
    WITH modelo AS (
      SELECT * FROM public.indicadores_empresa
       WHERE tenant_id = _tenant AND company_id IS NOT NULL AND lower(nome) = _g.chave
       ORDER BY created_at LIMIT 1
    ), novo AS (
      INSERT INTO public.indicadores_empresa
        (tenant_id, company_id, nome, categoria, formula, modo_analise, faixas,
         descricao, visibilidade, is_padrao, revisar_contas, ordem)
      SELECT _tenant, NULL, m.nome, m.categoria, m.formula, m.modo_analise, m.faixas,
             m.descricao, m.visibilidade, m.is_padrao, m.revisar_contas, m.ordem
        FROM modelo m
      RETURNING id
    ), alocadas AS (
      -- Cada empresa que tinha a cópia continua vendo o indicador, com a
      -- MESMA visibilidade que tinha. Consolidar não pode mudar o que o
      -- cliente enxerga.
      INSERT INTO public.indicador_alocacao
        (tenant_id, company_id, indicador_id, visibilidade, ordem)
      SELECT _tenant, i.company_id, (SELECT id FROM novo), i.visibilidade, i.ordem
        FROM public.indicadores_empresa i
       WHERE i.tenant_id = _tenant AND i.company_id IS NOT NULL
         AND lower(i.nome) = _g.chave
      ON CONFLICT (company_id, indicador_id) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO _alocacoes FROM alocadas;

    DELETE FROM public.indicadores_empresa
     WHERE tenant_id = _tenant AND company_id IS NOT NULL AND lower(nome) = _g.chave;

    _novos := _novos + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'simulacao', false,
    'globais_criados', _novos,
    'divergentes', to_jsonb(_divergentes),
    'ja_existe_global', to_jsonb(_ja_global));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.indicador_consolidar(boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.indicador_consolidar(boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
