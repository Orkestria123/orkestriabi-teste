-- ============================================================
-- AJUSTE 40 — a conferência que encontrou R$ 13,5 milhões
-- ============================================================
--
-- Rodando a revisão contra o SEU banco, o resultado que o BI mostrava
-- para 2025 (jan–nov) era este:
--
--     resultado pelo BI                    − 6.400.582,03   (prejuízo)
--     resultado pelo PRÓPRIO ARQUIVO       + 7.118.880,68   (lucro)
--     diferença                             13.519.462,71
--
-- Não era cálculo. Eram TRÊS contas alocadas para um grupo de natureza
-- diferente da que o próprio arquivo declara — e uma delas responde por
-- 99,95% da diferença:
--
--   210  LUCROS DISTRIBUIDOS A PAGAR   COD_NAT 02 (PASSIVO)
--        → 3.19.01.01.01 LUCROS DISTRIBUIDOS  (linha de DRE)
--        13.523.101,00 de débito entrando na DRE como despesa.
--
--   794  VIAGENS                       COD_NAT 04 (RESULTADO)
--        → 1.01.02.07.04 ADIANTAMENTO VIAGENS (ativo)      3.403,29
--   784  VEICULOS                      COD_NAT 04 (RESULTADO)
--        → 1.01.03.01.10 VEÍCULOS (ativo)                    235,00
--
-- A conta fecha na vírgula:
--
--     −6.400.582,03  +13.523.101,00  −3.638,29  =  +7.118.880,68
--
-- (as duas de despesa entram com sinal contrário: elas estão FORA da
--  DRE, então o lucro do BI estava alto por elas e baixo pela 210.)
--
-- Mais três, sem efeito no resultado mas erradas no balanço:
--   665    ADIANTAMENTO DE CLIENTES (passivo) → CLIENTES NACIONAIS
--   24845  VECTOR IND. (passivo)              → CLIENTES NACIONAIS
--   24846  METAVILA IND. (passivo)            → CLIENTES NACIONAIS
--
-- ------------------------------------------------------------
-- Por que isso passou por três conferências suas
-- ------------------------------------------------------------
-- Porque o NOME casa. "VEICULOS" do custo de produção com "VEÍCULOS" do
-- imobilizado; "VIAGENS" com "ADIANTAMENTO VIAGENS"; "LUCROS
-- DISTRIBUIDOS A PAGAR" com "LUCROS DISTRIBUIDOS". Olhando a lista, as
-- seis parecem certas. O que denuncia não está no nome — está no
-- registro I050, no campo COD_NAT, que o SPED obriga a conta a declarar:
-- 01 ativo, 02 passivo, 03 PL, 04 resultado.
--
-- Essa conferência é barata, é objetiva e não tem falso positivo: se o
-- arquivo diz que a conta é passivo e o destino é conta de resultado,
-- uma das duas está errada, sempre. Ela devia existir desde o primeiro
-- de-para. Existe agora.

CREATE OR REPLACE FUNCTION public.ecd_conferir_natureza(_importacao_id uuid)
RETURNS TABLE (
  conta_codigo    text,
  conta_nome      text,
  cod_nat         text,
  natureza_nome   text,
  tipo_esperado   text,
  destino_codigo  text,
  destino_cls     text,
  destino_nome    text,
  destino_tipo    text,
  movimento       numeric,
  observacao      text
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
  SELECT c.codigo, c.descricao, c.natureza,
         CASE btrim(COALESCE(c.natureza, ''))
           WHEN '01' THEN 'ativo' WHEN '02' THEN 'passivo'
           WHEN '03' THEN 'patrimônio líquido' WHEN '04' THEN 'resultado'
           WHEN '05' THEN 'compensação' ELSE 'não declarada' END,
         public.ecd_tipo_do_cod_nat(c.natureza),
         d.conta_padrao_codigo, p.classificacao, p.descricao, p.tipo,
         COALESCE((SELECT sum(s.debitos - s.creditos) FROM public.ecd_saldo s
                    WHERE s.importacao_id = _importacao_id AND s.codigo = c.codigo), 0),
         d.observacao
    FROM public.ecd_conta c
    JOIN public.depara_contas d
      ON d.tenant_id = _tenant AND d.company_id = _company
     AND d.conta_codigo = c.codigo
     AND d.conta_padrao_codigo IS NOT NULL
     AND NOT COALESCE(d.ignorada, false)
    JOIN public.plano_contas p
      ON p.tenant_id = _tenant
     AND p.company_id IS NOT DISTINCT FROM _escopo
     AND p.codigo = d.conta_padrao_codigo
   WHERE c.importacao_id = _importacao_id
     AND COALESCE(c.tipo, 'A') <> 'S'
     AND public.ecd_tipo_do_cod_nat(c.natureza) IS NOT NULL
     AND p.tipo <> public.ecd_tipo_do_cod_nat(c.natureza)
   ORDER BY abs(COALESCE((SELECT sum(s.debitos - s.creditos) FROM public.ecd_saldo s
                           WHERE s.importacao_id = _importacao_id AND s.codigo = c.codigo), 0)) DESC,
            c.codigo;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_conferir_natureza(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_conferir_natureza(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- O mesmo, resumido — para a tela decidir se mostra o alarme
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ecd_resumo_natureza(_importacao_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'contas', count(*),
    'no_resultado', count(*) FILTER (
      WHERE tipo_esperado = '3-DRE' OR destino_tipo = '3-DRE'),
    'movimento_no_resultado', COALESCE(sum(movimento) FILTER (
      WHERE tipo_esperado = '3-DRE' OR destino_tipo = '3-DRE'), 0),
    'pior', (SELECT jsonb_build_object('conta', conta_codigo, 'nome', conta_nome,
                                       'valor', movimento)
               FROM public.ecd_conferir_natureza(_importacao_id)
              ORDER BY abs(movimento) DESC LIMIT 1))
    FROM public.ecd_conferir_natureza(_importacao_id);
$fn$;

REVOKE EXECUTE ON FUNCTION public.ecd_resumo_natureza(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ecd_resumo_natureza(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
