INSERT INTO public.estrutura_padrao
  (classificacao, papel, demonstracao, tipo_linha, rotulo, ordem)
VALUES
  ('3.07.01.01', 'DESPESAS_FINANCEIRAS', 'DRE', 'tag', NULL, 133),
  ('3.07.01.14', 'DESPESAS_FINANCEIRAS', 'DRE', 'tag', NULL, 134),
  ('3.07.01.02', 'RECEITAS_FINANCEIRAS', 'DRE', 'tag', NULL, 141),
  ('3.07.01.03', 'RECEITAS_FINANCEIRAS', 'DRE', 'tag', NULL, 142),
  ('3.07.01.04', 'RECEITAS_FINANCEIRAS', 'DRE', 'tag', NULL, 143)
ON CONFLICT (classificacao, papel) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cls_no_prefixo(cls text, prefixo text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT
    CASE
      WHEN c = '' OR p = '' THEN false
      WHEN c = p THEN true
      WHEN left(c, length(p) + 1) IN (p || '.', p || '-', p || '/') THEN true
      ELSE false
    END
  FROM (
    SELECT
      replace(replace(btrim(coalesce(cls, '')), ',', '.'), ' ', '') AS c,
      replace(replace(btrim(coalesce(prefixo, '')), ',', '.'), ' ', '') AS p
  ) x;
$fn$;

CREATE OR REPLACE FUNCTION public.norm_gasto(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT regexp_replace(
    translate(
      lower(coalesce(s, '')),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'
    ),
    '\s+', ' ', 'g');
$fn$;

CREATE OR REPLACE FUNCTION public.inferir_alocacao_gasto(_cls text, _descricao text)
RETURNS TABLE (classe text, tipo text)
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  c text := replace(replace(btrim(coalesce(_cls, '')), ',', '.'), ' ', '');
  n text := public.norm_gasto(_descricao);
  classe_ text;
  tipo_ text;
BEGIN
  IF c = '' OR c = '3' THEN RETURN; END IF;
  IF public.cls_no_prefixo(c, '3.01')
     OR public.cls_no_prefixo(c, '3.10')
     OR public.cls_no_prefixo(c, '3.16')
     OR public.cls_no_prefixo(c, '3.19')
     OR public.cls_no_prefixo(c, '3.99')
     OR c IN ('3.05.99', '3.01.99', '3.10.99', '3.15.99', '3.07', '3.07.01', '3.15', '3.15.01')
     OR public.cls_no_prefixo(c, '3.07.01.02')
     OR public.cls_no_prefixo(c, '3.07.01.03')
     OR public.cls_no_prefixo(c, '3.07.01.04')
     OR public.cls_no_prefixo(c, '3.15.01.01')
     OR public.cls_no_prefixo(c, '3.15.01.02')
     OR public.cls_no_prefixo(c, '3.15.01.04') THEN
    IF NOT public.cls_no_prefixo(c, '3.15.01.05') THEN
      RETURN;
    END IF;
  END IF;

  IF public.cls_no_prefixo(c, '3.02')
     OR public.cls_no_prefixo(c, '3.03')
     OR public.cls_no_prefixo(c, '3.04')
     OR public.cls_no_prefixo(c, '3.05') THEN
    classe_ := 'custo';
  ELSIF public.cls_no_prefixo(c, '3.06')
     OR public.cls_no_prefixo(c, '3.07.01.01')
     OR public.cls_no_prefixo(c, '3.07.01.14')
     OR public.cls_no_prefixo(c, '3.06.01.13')
     OR public.cls_no_prefixo(c, '3.06.01.14')
     OR public.cls_no_prefixo(c, '3.15.01.03')
     OR public.cls_no_prefixo(c, '3.15.01.05')
     OR public.cls_no_prefixo(c, '3.17')
     OR public.cls_no_prefixo(c, '3.18') THEN
    classe_ := 'despesa';
  ELSE
    RETURN;
  END IF;

  IF public.cls_no_prefixo(c, '3.06.01.01')
     OR public.cls_no_prefixo(c, '3.06.01.02')
     OR public.cls_no_prefixo(c, '3.06.01.05')
     OR public.cls_no_prefixo(c, '3.06.01.06')
     OR public.cls_no_prefixo(c, '3.06.01.07') THEN
    tipo_ := 'fixo';
  ELSE
    tipo_ := 'variavel';
  END IF;

  IF n ~ 'inss[[:space:]]+retido' OR n ~ 'produtor rural' THEN
    tipo_ := 'variavel';
  ELSIF n ~ '\yiss[[:space:]]+fixo\y' OR n ~ 'taxas municipais' OR n ~ '\yiptu\y' THEN
    tipo_ := 'fixo';
  ELSIF n ~ 'compra' OR n ~ '\yestoque' OR n ~ 'mercadoria' OR n ~ 'comiss'
     OR n ~ 'frete' OR n ~ 'desconto' OR n ~ 'juro' OR n ~ '\yiof\y'
     OR n ~ 'variac' OR n ~ 'cambial' OR n ~ 'bancari' OR n ~ 'financiamento'
     OR n ~ 'duplicata' OR n ~ 'cobranca' OR n ~ '\yicms\y' OR n ~ '\ypis\y'
     OR n ~ '\ycofins\y' OR n ~ 'royalt' OR n ~ 'amostra' OR n ~ 'brinde'
     OR n ~ 'catalogo' OR n ~ 'feira' OR n ~ 'perda' OR n ~ 'acordo comercial'
     OR n ~ 'exportacao' OR n ~ 'publicidade' OR n ~ 'propaganda'
     OR n ~ 'materia[[:space:]-]*prima' THEN
    tipo_ := 'variavel';
  ELSIF n ~ 'pro[-[:space:]]?labore' OR n ~ 'salario' OR n ~ '\y13o?\y'
     OR n ~ '\yinss\y' OR n ~ '\yfgts\y' OR n ~ 'ferias' OR n ~ 'previdencia'
     OR n ~ 'alugue[il]' OR n ~ 'condominio' OR n ~ 'depreciac' OR n ~ 'amortizac'
     OR n ~ 'honorario' OR n ~ 'assessoria' OR n ~ 'vigilanc'
     OR n ~ 'plano de saude' OR n ~ 'assist\.?[[:space:]]*medica'
     OR n ~ 'vale transporte' OR n ~ 'alimentacao' OR n ~ 'alimetacao'
     OR n ~ 'formacao profissional' OR n ~ 'treinamento' OR n ~ 'estagio'
     OR n ~ 'imposto sindical' OR n ~ 'mensalidade' OR n ~ 'anuidade'
     OR n ~ 'indenizacoes trabalhistas' OR n ~ 'horas extras' OR n ~ 'seguro'
     OR n ~ 'manutenc' OR n ~ 'conserv' THEN
    tipo_ := 'fixo';
  END IF;

  classe := classe_;
  tipo := tipo_;
  RETURN NEXT;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.cls_no_prefixo(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.norm_gasto(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inferir_alocacao_gasto(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_plano_alocar_gasto()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  _classe text;
  _tipo text;
BEGIN
  IF NEW.company_id IS NOT NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_participante, false) THEN RETURN NEW; END IF;
  IF NEW.classe_gasto IS NOT NULL AND NEW.tipo_custo IS NOT NULL THEN RETURN NEW; END IF;
  SELECT a.classe, a.tipo INTO _classe, _tipo
    FROM public.inferir_alocacao_gasto(NEW.classificacao, NEW.descricao) a;
  IF _classe IS NULL THEN RETURN NEW; END IF;
  IF NEW.classe_gasto IS NULL THEN NEW.classe_gasto := _classe; END IF;
  IF NEW.tipo_custo IS NULL THEN NEW.tipo_custo := _tipo; END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_plano_alocar_gasto ON public.plano_contas;
CREATE TRIGGER trg_plano_alocar_gasto
  BEFORE INSERT OR UPDATE OF classificacao, descricao, classe_gasto, tipo_custo
  ON public.plano_contas
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_plano_alocar_gasto();

UPDATE public.plano_contas p
   SET classe_gasto = COALESCE(p.classe_gasto, x.classe),
       tipo_custo   = COALESCE(p.tipo_custo, x.tipo)
  FROM (
    SELECT p2.id, a.classe, a.tipo
      FROM public.plano_contas p2
      JOIN LATERAL public.inferir_alocacao_gasto(p2.classificacao, p2.descricao) a ON true
     WHERE p2.company_id IS NULL
       AND NOT COALESCE(p2.is_participante, false)
       AND (p2.classe_gasto IS NULL OR p2.tipo_custo IS NULL)
  ) x
 WHERE p.id = x.id
   AND x.classe IS NOT NULL;

UPDATE public.plano_contas p
   SET tipo_custo = 'fixo'
 WHERE p.company_id IS NULL
   AND p.classe_gasto = 'despesa'
   AND public.norm_gasto(p.descricao) ~ 'taxas municipais';

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