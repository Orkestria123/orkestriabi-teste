REVOKE EXECUTE ON FUNCTION public.plano_padrao_resumo(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dfc_cobertura(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.garantir_sinteticas_faltantes(uuid, uuid, text) FROM PUBLIC, anon;