CREATE TABLE public.db_metricas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  coletado_em timestamptz NOT NULL DEFAULT now(),
  tamanho_bytes bigint NOT NULL,
  conexoes integer NOT NULL,
  conexoes_ativas integer NOT NULL,
  max_conexoes integer NOT NULL
);
GRANT ALL ON public.db_metricas TO service_role;
ALTER TABLE public.db_metricas ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.db_metricas (coletado_em DESC);

CREATE OR REPLACE FUNCTION public.coletar_metricas_db()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.db_metricas (tamanho_bytes, conexoes, conexoes_ativas, max_conexoes)
  SELECT pg_database_size(current_database()),
         (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()),
         (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active'),
         current_setting('max_connections')::int;
  DELETE FROM public.db_metricas WHERE coletado_em < now() - interval '90 days';
END $$;
REVOKE ALL ON FUNCTION public.coletar_metricas_db() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.obter_saude_db()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE r jsonb;
BEGIN
  IF public.get_my_role() NOT IN ('orkestria_admin','tenant_admin') THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.db_metricas WHERE coletado_em > now() - interval '55 minutes') THEN
    PERFORM public.coletar_metricas_db();
  END IF;
  SELECT jsonb_build_object(
    'atual', (SELECT to_jsonb(m) FROM public.db_metricas m ORDER BY coletado_em DESC LIMIT 1),
    'historico', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY coletado_em)
        FROM public.db_metricas m WHERE coletado_em > now() - interval '30 days'), '[]'::jsonb),
    'cache_hit', (SELECT round(100.0 * sum(blks_hit) / NULLIF(sum(blks_hit)+sum(blks_read),0), 2)
        FROM pg_stat_database WHERE datname = current_database()),
    'consultas_lentas', COALESCE((SELECT jsonb_agg(q) FROM (
        SELECT left(regexp_replace(query, '\s+', ' ', 'g'), 140) AS consulta, calls AS chamadas,
               round(mean_exec_time::numeric, 1) AS media_ms, round(max_exec_time::numeric, 1) AS max_ms
        FROM extensions.pg_stat_statements
        WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND query NOT ILIKE '%pg_stat%'
        ORDER BY total_exec_time DESC LIMIT 5) q), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.obter_saude_db() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obter_saude_db() TO authenticated;

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('coletar-metricas-db', '0 * * * *', 'SELECT public.coletar_metricas_db()');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_cron indisponível: %', SQLERRM;
END $$;