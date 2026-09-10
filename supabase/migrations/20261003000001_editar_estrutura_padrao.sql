-- Escritório precisa editar a estrutura da DRE/Balanço (papéis,
-- tipo de linha, rótulo). A tabela era só leitura — a aba mostrava
-- os vínculos e não deixava revisar.

CREATE OR REPLACE FUNCTION public.salvar_estrutura_padrao(
  _classificacao text,
  _papel text,
  _demonstracao text,
  _tipo_linha text,
  _rotulo text,
  _ordem integer,
  _papel_anterior text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.has_role(auth.uid(), 'tenant_admin')) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  _classificacao := btrim(COALESCE(_classificacao, ''));
  _papel := btrim(COALESCE(_papel, ''));
  IF _classificacao = '' OR _papel = '' THEN
    RAISE EXCEPTION 'Classificação e papel são obrigatórios';
  END IF;
  IF _demonstracao IS NOT NULL AND btrim(_demonstracao) <> ''
     AND _demonstracao NOT IN ('DRE', 'BP_ATIVO', 'BP_PASSIVO') THEN
    RAISE EXCEPTION 'Demonstração inválida';
  END IF;
  IF _tipo_linha NOT IN ('detalhe', 'bloco', 'corrido', 'tag') THEN
    RAISE EXCEPTION 'Tipo de linha inválido';
  END IF;

  IF _papel_anterior IS NOT NULL
     AND btrim(_papel_anterior) <> ''
     AND btrim(_papel_anterior) IS DISTINCT FROM _papel THEN
    DELETE FROM public.estrutura_padrao
     WHERE classificacao = _classificacao AND papel = btrim(_papel_anterior);
  END IF;

  INSERT INTO public.estrutura_padrao
    (classificacao, papel, demonstracao, tipo_linha, rotulo, ordem)
  VALUES (
    _classificacao,
    _papel,
    NULLIF(btrim(COALESCE(_demonstracao, '')), ''),
    _tipo_linha,
    NULLIF(btrim(COALESCE(_rotulo, '')), ''),
    COALESCE(_ordem, 0)
  )
  ON CONFLICT (classificacao, papel) DO UPDATE
    SET demonstracao = EXCLUDED.demonstracao,
        tipo_linha   = EXCLUDED.tipo_linha,
        rotulo       = EXCLUDED.rotulo,
        ordem        = EXCLUDED.ordem;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.apagar_estrutura_padrao(
  _classificacao text,
  _papel text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT (public.is_orkestria_admin() OR public.has_role(auth.uid(), 'tenant_admin')) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  DELETE FROM public.estrutura_padrao
   WHERE classificacao = btrim(_classificacao) AND papel = btrim(_papel);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.salvar_estrutura_padrao(text, text, text, text, text, integer, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.salvar_estrutura_padrao(text, text, text, text, text, integer, text)
  TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.apagar_estrutura_padrao(text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.apagar_estrutura_padrao(text, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
