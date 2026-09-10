-- Ocupação de espaço e sinais de desempenho (só leitura).
-- pg_catalog só via SECURITY DEFINER — o cliente autenticado não lê isso direto.

CREATE OR REPLACE FUNCTION public.saude_ocupacao(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  _tabelas jsonb;
  _tenant jsonb;
  _empresas jsonb;
  _n_lanc int;
  _n_hist int;
  _avg_hist numeric := 0;
  _ecd int := 0;
BEGIN
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant obrigatório';
  END IF;
  IF NOT (public.is_orkestria_admin() OR public.get_my_tenant_id() = _tenant_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'bytes')::bigint DESC), '[]'::jsonb)
    INTO _tabelas
  FROM (
    SELECT jsonb_build_object(
      'tabela', c.relname,
      'bytes', pg_total_relation_size(c.oid),
      'linhas_estimadas', coalesce(s.n_live_tup, 0),
      'seq_scan', coalesce(s.seq_scan, 0),
      'idx_scan', coalesce(s.idx_scan, 0)
    ) AS x
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN (
        'lancamentos_diario', 'plano_contas', 'saldos_mensais', 'saldos_abertura',
        'depara_contas', 'diario_uploads', 'ecd_lancamento', 'ecd_conta',
        'ecd_saldo', 'chart_of_accounts', 'account_balances'
      )
  ) q;

  SELECT count(*)::int,
         count(*) FILTER (WHERE historico IS NOT NULL)::int
    INTO _n_lanc, _n_hist
    FROM public.lancamentos_diario
   WHERE tenant_id = _tenant_id;

  SELECT coalesce(avg(octet_length(historico)), 0)
    INTO _avg_hist
    FROM (
      SELECT historico
        FROM public.lancamentos_diario
       WHERE tenant_id = _tenant_id AND historico IS NOT NULL
       LIMIT 500
    ) amostra;

  BEGIN
    SELECT count(*)::int INTO _ecd
      FROM public.ecd_lancamento e
      JOIN public.ecd_importacao i ON i.id = e.importacao_id
     WHERE i.tenant_id = _tenant_id;
  EXCEPTION WHEN undefined_table THEN
    _ecd := 0;
  END;

  _tenant := jsonb_build_object(
    'lancamentos', _n_lanc,
    'historico_linhas', _n_hist,
    'historico_bytes_est', round(coalesce(_avg_hist, 0) * _n_hist),
    'plano_contas', (SELECT count(*) FROM public.plano_contas WHERE tenant_id = _tenant_id),
    'depara', (SELECT count(*) FROM public.depara_contas WHERE tenant_id = _tenant_id),
    'saldos_mensais', (SELECT count(*) FROM public.saldos_mensais s
                       JOIN public.companies c ON c.id = s.company_id
                       WHERE c.tenant_id = _tenant_id),
    'ecd_lancamentos', _ecd
  );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'nome', c.name,
      'lancamentos', coalesce(n.n, 0)
    ) ORDER BY coalesce(n.n, 0) DESC, c.name), '[]'::jsonb)
    INTO _empresas
  FROM public.companies c
  LEFT JOIN (
    SELECT company_id, count(*)::int AS n
      FROM public.lancamentos_diario
     WHERE tenant_id = _tenant_id
     GROUP BY company_id
  ) n ON n.company_id = c.id
  WHERE c.tenant_id = _tenant_id;

  RETURN jsonb_build_object(
    'gerado_em', now(),
    'tenant_id', _tenant_id,
    'tabelas', _tabelas,
    'tenant', _tenant,
    'empresas', _empresas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.saude_ocupacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saude_ocupacao(uuid) TO authenticated, service_role;
