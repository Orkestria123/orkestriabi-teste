ALTER TABLE public.plano_contas
  ADD COLUMN IF NOT EXISTS marco text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plano_contas_marco_chk') THEN
    ALTER TABLE public.plano_contas ADD CONSTRAINT plano_contas_marco_chk CHECK (
      marco IS NULL OR marco IN (
        'receita_bruta','deducoes','custos',
        'despesas_operacionais','despesas_administrativas','despesas_comerciais',
        'despesas_tributarias','outras_receitas','outras_despesas',
        'receitas_financeiras','despesas_financeiras',
        'irpj','csll','distribuicao_lucros',
        'ativo_circulante','ativo_nao_circulante','realizavel_longo_prazo',
        'investimentos','imobilizado','intangivel',
        'passivo_circulante','passivo_nao_circulante',
        'patrimonio_liquido','capital_social','reservas','lucros_acumulados'
      )
    );
  END IF;
END $$;

COMMENT ON COLUMN public.plano_contas.marco IS
  'Papel semântico da conta sintética na demonstração. Não define estrutura (a hierarquia do plano faz isso) — define onde os subtotais e os indicadores encontram seus limites.';

CREATE UNIQUE INDEX IF NOT EXISTS plano_contas_marco_unico
  ON public.plano_contas (
    tenant_id,
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    marco
  )
  WHERE marco IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plano_contas_marco
  ON public.plano_contas (tenant_id, company_id, marco)
  WHERE marco IS NOT NULL;

CREATE OR REPLACE FUNCTION public.unaccent_simples(_s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT translate(
    lower(COALESCE(_s, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
  );
$$;

CREATE OR REPLACE FUNCTION public._semear_marcos_interno(_tenant_id uuid, _company_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _regras text[][] := ARRAY[
    ARRAY['deduc',                                          'deducoes'],
    ARRAY['receita.*bruta|receita de venda|receita de prestac','receita_bruta'],
    ARRAY['custo',                                          'custos'],
    ARRAY['despesa.*administra',                            'despesas_administrativas'],
    ARRAY['despesa.*(vend|comerci)',                        'despesas_comerciais'],
    ARRAY['despesa.*tribut',                                'despesas_tributarias'],
    ARRAY['despesa.*financ',                                'despesas_financeiras'],
    ARRAY['receita.*financ',                                'receitas_financeiras'],
    ARRAY['despesa.*operac',                                'despesas_operacionais'],
    ARRAY['outras receitas',                                'outras_receitas'],
    ARRAY['outras despesas',                                'outras_despesas'],
    ARRAY['provis.*contribuic|csll|contribuic.*social',     'csll'],
    ARRAY['provis.*imposto.*renda|imposto.*renda|provis.*ir\M','irpj'],
    ARRAY['distribuic.*lucro',                              'distribuicao_lucros'],
    ARRAY['ativo.*nao circulante|nao circulante.*ativo',    'ativo_nao_circulante'],
    ARRAY['realizavel.*longo',                              'realizavel_longo_prazo'],
    ARRAY['investiment',                                    'investimentos'],
    ARRAY['imobiliz',                                       'imobilizado'],
    ARRAY['intang',                                         'intangivel'],
    ARRAY['ativo.*circulante|circulante.*ativo',            'ativo_circulante'],
    ARRAY['passivo.*nao circulante|exigivel.*longo',        'passivo_nao_circulante'],
    ARRAY['capital social',                                 'capital_social'],
    ARRAY['reserva',                                        'reservas'],
    ARRAY['lucros?.*acumulad|prejuizos?.*acumulad',         'lucros_acumulados'],
    ARRAY['patrimonio liquido',                             'patrimonio_liquido'],
    ARRAY['passivo.*circulante|circulante.*passivo',        'passivo_circulante']
  ];
  _i int;
  _rx text;
  _marco text;
  _n int;
  _total int := 0;
  _tipos text[];
BEGIN
  FOR _i IN 1 .. array_length(_regras, 1) LOOP
    _rx := _regras[_i][1];
    _marco := _regras[_i][2];

    _tipos := CASE
      WHEN _marco IN ('ativo_circulante','ativo_nao_circulante','realizavel_longo_prazo',
                      'investimentos','imobilizado','intangivel') THEN ARRAY['1-Ativo']
      WHEN _marco IN ('passivo_circulante','passivo_nao_circulante','patrimonio_liquido',
                      'capital_social','reservas','lucros_acumulados') THEN ARRAY['2-Passivo']
      ELSE ARRAY['3-DRE']
    END;

    UPDATE public.plano_contas p
       SET marco = _marco
     WHERE p.id = (
       SELECT p2.id
         FROM public.plano_contas p2
        WHERE p2.tenant_id = _tenant_id
          AND p2.company_id IS NOT DISTINCT FROM _company_id
          AND p2.is_sintetica = true
          AND p2.marco IS NULL
          AND p2.tipo = ANY(_tipos)
          AND public.unaccent_simples(p2.descricao) ~ _rx
        ORDER BY p2.nivel ASC, length(p2.classificacao) ASC, p2.classificacao ASC
        LIMIT 1
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.plano_contas p3
        WHERE p3.tenant_id = _tenant_id
          AND p3.company_id IS NOT DISTINCT FROM _company_id
          AND p3.marco = _marco
     );
    GET DIAGNOSTICS _n = ROW_COUNT;
    _total := _total + _n;
  END LOOP;

  RETURN jsonb_build_object('marcos_definidos', _total);
END;
$$;

CREATE OR REPLACE FUNCTION public.semear_marcos(_tenant_id uuid, _company_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.pode_gerenciar_tenant(_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o plano deste escritório';
  END IF;
  RETURN public._semear_marcos_interno(_tenant_id, _company_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._semear_marcos_interno(uuid, uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.semear_marcos(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.semear_marcos(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unaccent_simples(text) TO authenticated, service_role;

DO $$
DECLARE r record; _res jsonb; _total int := 0;
BEGIN
  FOR r IN SELECT DISTINCT tenant_id, company_id FROM public.plano_contas LOOP
    _res := public._semear_marcos_interno(r.tenant_id, r.company_id);
    _total := _total + COALESCE((_res->>'marcos_definidos')::int, 0);
  END LOOP;
  RAISE NOTICE 'Marcos semeados: %', _total;
END $$;