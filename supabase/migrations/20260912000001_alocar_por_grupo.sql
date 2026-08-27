-- ============================================================
-- AJUSTE 39 — o de-para respeita o GRUPO
-- ============================================================
--
-- "Realocar também contas conforme grupo. ECD anterior Custo vai pra
--  plano padrão Custo. Despesas administrativo vai pra despesa
--  administrativo e assim por diante"
--
-- O que estava acontecendo. A alocação automática tem uma cadeia de
-- regras: classificação idêntica → código → SALDO → descrição → NOME
-- (semelhança de palavras). As duas últimas não olhavam grupo nenhum:
--
--   · a regra do NOME casa "DEPRECIAÇÕES" do custo de serviços com
--     "DEPRECIAÇÕES" da despesa administrativa — mesmo nome, grupos
--     diferentes, e ela escolhia por nota de semelhança;
--   · a regra do SALDO é pior: casa por COINCIDÊNCIA DE VALOR. Uma conta
--     de custo com saldo 12.345,67 ia parar em qualquer conta do plano
--     que tivesse esse mesmo saldo.
--
-- Nenhuma das duas tinha como saber que custo é custo. Agora tem.
--
-- ------------------------------------------------------------
-- De onde sai o grupo (sem adivinhar)
-- ------------------------------------------------------------
-- Duas fontes, as duas dentro do próprio arquivo:
--
--  1. `COD_NAT` do registro I050. O SPED obriga a conta a declarar a
--     natureza: 01 ativo, 02 passivo, 03 patrimônio líquido, 04
--     RESULTADO, 05 compensação. Isso não depende da numeração do plano
--     — e é bom que não dependa, porque muitos planos usam 3 para
--     receita e 4 para despesa enquanto o seu usa 3 para o resultado
--     inteiro. É a trava dura: conta de resultado nunca mais vai para
--     conta de balanço, aconteça o que acontecer com os nomes.
--
--  2. O GALHO da conta no próprio arquivo (`caminho_nomes`, lido no
--     ajuste 32). O nome do pai — "CUSTOS DE PRESTAÇÃO DE SERVIÇOS",
--     "DESPESAS ADMINISTRATIVAS" — é casado com o nome das SINTÉTICAS do
--     plano padrão. Casou, aquela sintética é o grupo de destino, e a
--     folha só pode ser procurada DENTRO dele.
--
-- Fora do grupo não se procura. É esta a mudança.

-- ------------------------------------------------------------
-- 1) COD_NAT → tipo da conta no plano
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ecd_tipo_do_cod_nat(_cod_nat text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE btrim(COALESCE(_cod_nat, ''))
    WHEN '01' THEN '1-Ativo'
    WHEN '1'  THEN '1-Ativo'
    WHEN '02' THEN '2-Passivo'
    WHEN '2'  THEN '2-Passivo'
    -- Patrimônio líquido mora dentro do passivo no plano do escritório
    -- (2.05). Um plano que separe PL num tipo próprio precisa mudar
    -- aqui — e só aqui.
    WHEN '03' THEN '2-Passivo'
    WHEN '3'  THEN '2-Passivo'
    WHEN '04' THEN '3-DRE'
    WHEN '4'  THEN '3-DRE'
    ELSE NULL          -- 05 compensação, 09 outras: sem trava
  END;
$fn$;

-- ------------------------------------------------------------
-- 1b) O que é vínculo DO ROBÔ — e o que é decisão SUA
-- ------------------------------------------------------------
-- Isto aqui é uma correção de um erro grave que eu quase te entreguei.
--
-- A primeira versão protegia o trabalho manual assim:
--
--     AND COALESCE(observacao,'') LIKE 'ECD:%'   -- "nunca o manual"
--
-- Olhando o SEU banco: das 646 linhas do de-para, NENHUMA começa com
-- outra coisa. As suas decisões estão gravadas como
--
--     'ECD: vínculo em lote'        506
--     'ECD: definido manualmente'    80
--     'ECD: sugestão conferida'      60
--
-- Ou seja: a guarda que eu escrevi para proteger o seu trabalho pegava
-- exatamente ele. "Realocar por grupo" teria reescrito as 646, inclusive
-- as 80 que você fez à mão e as 60 que você conferiu uma a uma.
--
-- A regra certa não é um prefixo — é a LISTA do que o robô escreve.
-- Qualquer outra observação é sua e é intocável. Se amanhã nascer uma
-- frase nova do robô, ela entra aqui; enquanto não entrar, o pior que
-- acontece é o robô não mexer em algo que ele mesmo escreveu — que é o
-- lado seguro de errar.
CREATE OR REPLACE FUNCTION public.ecd_vinculo_do_robo(_observacao text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(_observacao, '') LIKE 'ECD: sugestão automática%'
      OR COALESCE(_observacao, '') = 'ECD: classificação idêntica no plano'
      OR COALESCE(_observacao, '') LIKE 'ECD: alocada no grupo %'
      OR COALESCE(_observacao, '') LIKE 'ECD: realocada para o grupo %';
$fn$;

-- ------------------------------------------------------------
-- 2) O grupo de destino de cada conta do ECD
-- ------------------------------------------------------------
-- Devolve uma linha por conta ANALÍTICA do ECD dizendo em que grupo do
-- plano ela deve cair, e por quê. Serve para alocar e serve para você
-- conferir antes de alocar.
CREATE OR REPLACE FUNCTION public.ecd_grupo_destino(_importacao_id uuid)
RETURNS TABLE (
  codigo              text,
  descricao           text,
  cod_nat             text,
  tipo_alvo           text,
  grupo_classificacao text,
  grupo_descricao     text,
  galho_no_arquivo    text,
  nota                numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _tenant uuid; _company uuid; _escopo uuid;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_acessar_empresa(_company) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  _escopo := CASE WHEN COALESCE(
      (public.escopo_plano_empresa(_company)->>'usa_plano_padrao')::boolean, false)
    THEN NULL ELSE _company END;

  RETURN QUERY
  WITH conta AS (
    SELECT c.codigo, c.descricao, c.natureza AS cod_nat,
           public.ecd_tipo_do_cod_nat(c.natureza) AS tipo_alvo,
           c.caminho_nomes
      FROM public.ecd_conta c
     WHERE c.importacao_id = _importacao_id
       AND COALESCE(c.tipo, 'A') <> 'S'
  ),
  -- Os ancestrais, do mais próximo da folha para o mais distante. A
  -- folha (último segmento) fica de fora: ela é o que se quer casar
  -- DEPOIS, dentro do grupo.
  ancestral AS (
    SELECT ct.codigo, seg.nome, seg.ord,
           ct.tipo_alvo,
           row_number() OVER (PARTITION BY ct.codigo ORDER BY seg.ord DESC) AS distancia
      FROM conta ct
      CROSS JOIN LATERAL (
        SELECT s AS nome, i AS ord
          FROM unnest(string_to_array(COALESCE(ct.caminho_nomes, ''), ' > '))
               WITH ORDINALITY AS t(s, i)
      ) seg
     WHERE seg.ord < COALESCE(
             array_length(string_to_array(COALESCE(ct.caminho_nomes, ''), ' > '), 1), 0)
       AND btrim(seg.nome) <> ''
  ),
  -- Só os nomes DISTINTOS: um plano tem dezenas de galhos, não milhares.
  nome_ancestral AS (
    SELECT DISTINCT a.nome, a.tipo_alvo FROM ancestral a
  ),
  -- As sintéticas do plano: são elas que dão nome aos grupos.
  grupo AS (
    SELECT p.classificacao, p.descricao, p.tipo,
           public.ecd_normalizar_texto(p.descricao) AS norm,
           public.ecd_palavras(p.descricao)         AS palavras
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _escopo
       AND p.ativo AND p.is_sintetica
       AND COALESCE(p.classificacao, '') <> ''
  ),
  -- Dice entre o nome do galho do ARQUIVO e o nome do grupo do PLANO.
  -- Mesmo cálculo da sugestão por nome, só que aplicado ao PAI.
  par AS (
    SELECT na.nome, na.tipo_alvo, g.classificacao, g.descricao,
           round(2.0 * count(*) /
                 (COALESCE(array_length(public.ecd_palavras(na.nome), 1), 0)
                + COALESCE(array_length(g.palavras, 1), 0)), 4) AS nota
      FROM nome_ancestral na
      CROSS JOIN LATERAL unnest(public.ecd_palavras(na.nome)) AS w(palavra)
      JOIN grupo g ON g.palavras @> ARRAY[w.palavra]
     WHERE na.tipo_alvo IS NULL OR g.tipo = na.tipo_alvo
     GROUP BY na.nome, na.tipo_alvo, g.classificacao, g.descricao, g.palavras
  ),
  -- O melhor grupo para cada nome de galho. Empate desfeito pela
  -- classificação MAIS PROFUNDA: "DESPESAS ADMINISTRATIVAS" tem que
  -- ganhar de "DESPESAS OPERACIONAIS", que é o avô dela.
  melhor_grupo AS (
    SELECT DISTINCT ON (p.nome, p.tipo_alvo)
           p.nome, p.tipo_alvo, p.classificacao, p.descricao, p.nota
      FROM par p
     WHERE p.nota >= 0.5
     ORDER BY p.nome, p.tipo_alvo, p.nota DESC,
              length(p.classificacao) DESC, p.classificacao
  ),
  -- Para cada conta: o galho MAIS PRÓXIMO da folha que casou.
  escolhido AS (
    SELECT DISTINCT ON (a.codigo)
           a.codigo, mg.classificacao, mg.descricao, a.nome, mg.nota
      FROM ancestral a
      JOIN melhor_grupo mg
        ON mg.nome = a.nome
       AND mg.tipo_alvo IS NOT DISTINCT FROM a.tipo_alvo
     ORDER BY a.codigo, a.distancia, mg.nota DESC
  )
  SELECT ct.codigo, ct.descricao, ct.cod_nat, ct.tipo_alvo,
         e.classificacao, e.descricao, e.nome, e.nota
    FROM conta ct
    LEFT JOIN escolhido e ON e.codigo = ct.codigo
   ORDER BY ct.codigo;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_grupo_destino(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_grupo_destino(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) Realocar respeitando o grupo
-- ------------------------------------------------------------
-- O que ela faz, em ordem:
--
--   · calcula o grupo de destino de cada conta (acima);
--   · dentro do grupo, procura a folha do plano que casa com o nome da
--     conta do ECD — nome idêntico primeiro, semelhança depois;
--   · GRAVA o vínculo novo, e REESCREVE o vínculo antigo quando o
--     destino dele está fora do grupo;
--   · nunca encosta em vínculo que você fez à mão. A marca é a
--     `observacao`: tudo que o robô escreve começa com "ECD:".
--
-- `_so_conferir = true` não grava nada: devolve o mesmo relatório para
-- você olhar antes.
CREATE OR REPLACE FUNCTION public.ecd_alocar_por_grupo(
  _importacao_id uuid,
  _so_conferir boolean DEFAULT false,
  _minimo numeric DEFAULT 0.34
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _company uuid; _escopo uuid;
  _novas int := 0; _movidas int := 0; _mantidas int := 0;
  _sem_grupo int; _sem_folha int; _manuais int; _fora jsonb;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_acessar_empresa(_company) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  _escopo := CASE WHEN COALESCE(
      (public.escopo_plano_empresa(_company)->>'usa_plano_padrao')::boolean, false)
    THEN NULL ELSE _company END;

  CREATE TEMP TABLE _grp ON COMMIT DROP AS
    SELECT * FROM public.ecd_grupo_destino(_importacao_id);
  CREATE INDEX ON _grp (codigo);
  ANALYZE _grp;

  -- As folhas do plano, com nome normalizado e palavras.
  CREATE TEMP TABLE _folha ON COMMIT DROP AS
    SELECT p.codigo, p.classificacao, p.descricao, p.tipo,
           public.ecd_normalizar_texto(p.descricao) AS norm,
           public.ecd_palavras(p.descricao)         AS palavras
      FROM public.plano_contas p
     WHERE p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _escopo
       AND p.ativo AND NOT p.is_sintetica
       AND NOT COALESCE(p.is_participante, false);
  CREATE INDEX ON _folha (classificacao);
  ANALYZE _folha;

  -- Candidatas: folha DENTRO do grupo, com o tipo certo.
  CREATE TEMP TABLE _cand ON COMMIT DROP AS
    SELECT g.codigo AS ecd_codigo, f.codigo AS plano_codigo,
           (public.ecd_normalizar_texto(g.descricao) = f.norm) AS nome_igual,
           round(2.0 * (
             SELECT count(*) FROM unnest(public.ecd_palavras(g.descricao)) w
              WHERE f.palavras @> ARRAY[w]
           ) / NULLIF(
             COALESCE(array_length(public.ecd_palavras(g.descricao), 1), 0)
           + COALESCE(array_length(f.palavras, 1), 0), 0), 4) AS nota
      FROM _grp g
      JOIN _folha f
        ON (f.classificacao = g.grupo_classificacao
            OR left(f.classificacao, length(g.grupo_classificacao) + 1)
               = g.grupo_classificacao || '.')
       AND (g.tipo_alvo IS NULL OR f.tipo = g.tipo_alvo)
     WHERE g.grupo_classificacao IS NOT NULL;
  ANALYZE _cand;

  -- A melhor de cada conta: nome idêntico ganha; senão a maior nota.
  CREATE TEMP TABLE _alvo ON COMMIT DROP AS
    SELECT DISTINCT ON (c.ecd_codigo)
           c.ecd_codigo, c.plano_codigo, c.nome_igual, c.nota
      FROM _cand c
     WHERE c.nome_igual OR c.nota >= _minimo
     ORDER BY c.ecd_codigo, c.nome_igual DESC, c.nota DESC, c.plano_codigo;
  ANALYZE _alvo;

  -- Relatório: o que está fora do grupo HOJE. É a lista que interessa —
  -- são estas as contas mal alocadas.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'conta'), '[]'::jsonb) INTO _fora
    FROM (
      SELECT jsonb_build_object(
               'conta',   d.conta_codigo,
               'nome',    g.descricao,
               'hoje',    d.conta_padrao_codigo,
               'hoje_em', pa.classificacao,
               'grupo',   g.grupo_classificacao,
               'grupo_nome', g.grupo_descricao,
               'passa_a_ser', a.plano_codigo,
               'motivo',  d.observacao) AS x
        FROM public.depara_contas d
        JOIN _grp g ON g.codigo = d.conta_codigo
        LEFT JOIN _alvo a ON a.ecd_codigo = d.conta_codigo
        LEFT JOIN public.plano_contas pa
               ON pa.tenant_id = _tenant
              AND pa.company_id IS NOT DISTINCT FROM _escopo
              AND pa.codigo = d.conta_padrao_codigo
       WHERE d.tenant_id = _tenant AND d.company_id = _company
         AND d.conta_padrao_codigo IS NOT NULL
         AND g.grupo_classificacao IS NOT NULL
         AND pa.classificacao IS NOT NULL
         AND NOT (pa.classificacao = g.grupo_classificacao
               OR left(pa.classificacao, length(g.grupo_classificacao) + 1)
                  = g.grupo_classificacao || '.')
       LIMIT 500
    ) t;

  IF NOT _so_conferir THEN
    -- MOVE o que o robô alocou fora do grupo.
    WITH movidas AS (
      UPDATE public.depara_contas d
         SET conta_padrao_codigo = a.plano_codigo,
             observacao = 'ECD: realocada para o grupo ' || g.grupo_descricao,
             updated_at = now()
        FROM _grp g, _alvo a,
             public.plano_contas pa
       WHERE g.codigo = d.conta_codigo
         AND a.ecd_codigo = d.conta_codigo
         AND d.tenant_id = _tenant AND d.company_id = _company
         AND d.conta_padrao_codigo IS NOT NULL
         AND public.ecd_vinculo_do_robo(d.observacao)   -- nunca o seu
         AND g.grupo_classificacao IS NOT NULL
         AND pa.tenant_id = _tenant
         AND pa.company_id IS NOT DISTINCT FROM _escopo
         AND pa.codigo = d.conta_padrao_codigo
         AND NOT (pa.classificacao = g.grupo_classificacao
               OR left(pa.classificacao, length(g.grupo_classificacao) + 1)
                  = g.grupo_classificacao || '.')
         AND a.plano_codigo IS DISTINCT FROM d.conta_padrao_codigo
      RETURNING 1
    ) SELECT count(*) INTO _movidas FROM movidas;

    -- GRAVA quem ainda não tem vínculo.
    WITH novas AS (
      INSERT INTO public.depara_contas
        (tenant_id, company_id, conta_codigo, conta_padrao_codigo, ignorada, observacao)
      SELECT _tenant, _company, a.ecd_codigo, a.plano_codigo, false,
             'ECD: alocada no grupo ' || g.grupo_descricao ||
             CASE WHEN a.nome_igual THEN ' (nome idêntico)'
                  ELSE ' (' || round(a.nota * 100) || '% de semelhança)' END
        FROM _alvo a JOIN _grp g ON g.codigo = a.ecd_codigo
       WHERE NOT EXISTS (
         SELECT 1 FROM public.depara_contas d
          WHERE d.tenant_id = _tenant AND d.company_id = _company
            AND d.conta_codigo = a.ecd_codigo)
      RETURNING 1
    ) SELECT count(*) INTO _novas FROM novas;
  END IF;

  SELECT count(*) FILTER (WHERE g.grupo_classificacao IS NULL),
         count(*) FILTER (WHERE g.grupo_classificacao IS NOT NULL
                            AND NOT EXISTS (SELECT 1 FROM _alvo a WHERE a.ecd_codigo = g.codigo))
    INTO _sem_grupo, _sem_folha
    FROM _grp g;

  SELECT count(*) INTO _manuais
    FROM public.depara_contas d
    JOIN _grp g ON g.codigo = d.conta_codigo
   WHERE d.tenant_id = _tenant AND d.company_id = _company
     AND NOT public.ecd_vinculo_do_robo(d.observacao);

  SELECT count(*) INTO _mantidas
    FROM public.depara_contas d
    JOIN _grp g ON g.codigo = d.conta_codigo
    JOIN public.plano_contas pa
      ON pa.tenant_id = _tenant AND pa.company_id IS NOT DISTINCT FROM _escopo
     AND pa.codigo = d.conta_padrao_codigo
   WHERE d.tenant_id = _tenant AND d.company_id = _company
     AND g.grupo_classificacao IS NOT NULL
     AND (pa.classificacao = g.grupo_classificacao
       OR left(pa.classificacao, length(g.grupo_classificacao) + 1)
          = g.grupo_classificacao || '.');

  RETURN jsonb_build_object(
    'so_conferir',    _so_conferir,
    'realocadas',     _movidas,
    'novas',          _novas,
    'ja_no_grupo',    _mantidas,
    'sem_grupo',      _sem_grupo,
    'sem_folha_no_grupo', _sem_folha,
    'manuais_preservados', _manuais,
    'fora_do_grupo',  _fora);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_alocar_por_grupo(uuid, boolean, numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_alocar_por_grupo(uuid, boolean, numeric)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) A alocação automática passa a alocar por grupo
-- ------------------------------------------------------------
-- A ordem importa e é esta:
--
--   1. classificação estrutural idêntica  — é código de plano dos dois
--      lados, não tem o que conferir;
--   2. POR GRUPO — é a regra nova, e ela cobre nome e semelhança sem
--      poder atravessar de custo para despesa;
--   3. a cadeia antiga (código, saldo, descrição, nome), só para o que
--      sobrou sem grupo nenhum.
--
-- A regra do SALDO continua existindo por último porque, para uma conta
-- sem galho e sem nome parecido, um saldo idêntico ainda é a melhor
-- pista que existe. Mas agora ela só pega o resto do resto.
CREATE OR REPLACE FUNCTION public.ecd_alocar_automatico(
  _importacao_id uuid,
  _refazer boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _tenant uuid; _company uuid; _escopo uuid;
  _exatas int := 0; _sug jsonb; _grupo jsonb; _pendentes int;
BEGIN
  SELECT i.tenant_id, i.company_id INTO _tenant, _company
    FROM public.ecd_importacao i WHERE i.id = _importacao_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF NOT public.pode_acessar_empresa(_company) THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  _escopo := CASE WHEN COALESCE(
      (public.escopo_plano_empresa(_company)->>'usa_plano_padrao')::boolean, false)
    THEN NULL ELSE _company END;

  IF _refazer THEN
    DELETE FROM public.depara_contas d
     WHERE d.tenant_id = _tenant AND d.company_id = _company
       AND public.ecd_vinculo_do_robo(d.observacao)
       AND EXISTS (SELECT 1 FROM public.ecd_conta c
                    WHERE c.importacao_id = _importacao_id AND c.codigo = d.conta_codigo);
  END IF;

  -- ---------- 1) regra exata: mesma classificação estrutural ----------
  WITH par AS (
    SELECT DISTINCT ON (e.codigo) e.codigo AS ecd_codigo, p.codigo AS plano_codigo
      FROM public.ecd_conta e
      JOIN public.plano_contas p
        ON p.classificacao = e.classificacao
       AND p.tenant_id = _tenant
       AND p.company_id IS NOT DISTINCT FROM _escopo
       AND p.ativo AND NOT p.is_sintetica
       AND NOT COALESCE(p.is_participante, false)
     WHERE e.importacao_id = _importacao_id
       AND COALESCE(e.tipo, 'A') <> 'S'
       AND e.classificacao_origem IN ('i052', 'i051', 'hierarquia')
       AND position('.' in e.classificacao) > 0
     ORDER BY e.codigo, p.codigo
  ),
  gravadas AS (
    INSERT INTO public.depara_contas
      (tenant_id, company_id, conta_codigo, conta_padrao_codigo, ignorada, observacao)
    SELECT _tenant, _company, par.ecd_codigo, par.plano_codigo, false,
           'ECD: classificação idêntica no plano'
      FROM par
     WHERE NOT EXISTS (
       SELECT 1 FROM public.depara_contas d
        WHERE d.tenant_id = _tenant AND d.company_id = _company
          AND d.conta_codigo = par.ecd_codigo)
    RETURNING 1
  ) SELECT count(*) INTO _exatas FROM gravadas;

  -- ---------- 2) por GRUPO ----------
  _grupo := public.ecd_alocar_por_grupo(_importacao_id, false);

  -- ---------- 3) o resto, pela cadeia antiga ----------
  _sug := public.ecd_sugerir_depara(_importacao_id, false);

  SELECT count(*) INTO _pendentes
    FROM public.ecd_conta c
   WHERE c.importacao_id = _importacao_id
     AND COALESCE(c.tipo, 'A') <> 'S'
     AND NOT EXISTS (
       SELECT 1 FROM public.depara_contas d
        WHERE d.tenant_id = _tenant AND d.company_id = _company
          AND d.conta_codigo = c.codigo);

  RETURN jsonb_build_object(
    'exatas', _exatas,
    'por_grupo', COALESCE((_grupo->>'novas')::int, 0),
    'realocadas', COALESCE((_grupo->>'realocadas')::int, 0),
    'sugeridas', COALESCE((_sug->>'sugeridas')::int, 0),
    'zeradas_barradas', COALESCE((_sug->>'zeradas_barradas')::int, 0),
    'pendentes', _pendentes,
    'grupo', _grupo - 'fora_do_grupo',
    'por_regra', COALESCE(_sug->'por_regra', '{}'::jsonb));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_alocar_automatico(uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_alocar_automatico(uuid, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
