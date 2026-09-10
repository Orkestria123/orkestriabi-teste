ALTER FUNCTION public._garantir_sinteticas_interno(uuid, uuid, text) SET statement_timeout = '300s';
ALTER FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text) SET statement_timeout = '300s';
ALTER FUNCTION public.plano_padrao_resumo(uuid) SET statement_timeout = '120s';
ALTER FUNCTION public.dfc_cobertura(uuid, uuid) SET statement_timeout = '120s';