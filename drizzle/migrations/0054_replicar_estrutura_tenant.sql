CREATE OR REPLACE FUNCTION public.replicar_estrutura_tenant(_origem uuid, _destino uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $fn$
DECLARE r jsonb := '{}'::jsonb; n int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_orkestria_admin() THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF _origem = _destino THEN RAISE EXCEPTION 'Origem e destino iguais'; END IF;
  IF EXISTS (SELECT 1 FROM plano_contas WHERE tenant_id = _destino AND company_id IS NULL) THEN
    RAISE EXCEPTION 'O tenant de destino já tem Plano Padrão. A replicação só pode ser feita em tenant sem plano.';
  END IF;

  INSERT INTO plano_contas (tenant_id, company_id, codigo, classificacao, descricao, tipo, natureza, nivel,
    is_participante, ativo, is_sintetica, conta_pai_classificacao, tipo_custo, dfc_atividade, dfc_nao_caixa, dfc_codigo, classe_gasto)
  SELECT _destino, NULL, codigo, classificacao, descricao, tipo, natureza, nivel,
    is_participante, ativo, is_sintetica, conta_pai_classificacao, tipo_custo, dfc_atividade, dfc_nao_caixa, dfc_codigo, classe_gasto
  FROM plano_contas WHERE tenant_id = _origem AND company_id IS NULL AND is_participante = false;
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('plano_contas', n);

  INSERT INTO dfc_vinculo (tenant_id, company_id, classificacao, codigo_dfc, origem)
  SELECT _destino, NULL, classificacao, codigo_dfc, origem FROM dfc_vinculo
  WHERE tenant_id = _origem AND company_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM dfc_vinculo d WHERE d.tenant_id = _destino AND d.company_id IS NULL AND d.classificacao = dfc_vinculo.classificacao);
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('dfc', n);

  INSERT INTO dre_linhas_config (tenant_id, ebit_classificacoes, ebitda_classificacoes, ebitda_sobre_ebit, ebit_expressao, ebitda_expressao, ebit_modo, ebitda_modo)
  SELECT _destino, ebit_classificacoes, ebitda_classificacoes, ebitda_sobre_ebit, ebit_expressao, ebitda_expressao, ebit_modo, ebitda_modo
  FROM dre_linhas_config WHERE tenant_id = _origem
  ON CONFLICT (tenant_id) DO UPDATE SET ebit_classificacoes = EXCLUDED.ebit_classificacoes,
    ebitda_classificacoes = EXCLUDED.ebitda_classificacoes, ebitda_sobre_ebit = EXCLUDED.ebitda_sobre_ebit,
    ebit_expressao = EXCLUDED.ebit_expressao, ebitda_expressao = EXCLUDED.ebitda_expressao,
    ebit_modo = EXCLUDED.ebit_modo, ebitda_modo = EXCLUDED.ebitda_modo;

  DELETE FROM dashboard_config WHERE tenant_id = _destino AND company_id IS NULL;
  INSERT INTO dashboard_config (tenant_id, company_id, bloco, visivel, ordem, config)
  SELECT _destino, NULL, bloco, visivel, ordem, config FROM dashboard_config WHERE tenant_id = _origem AND company_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('dashboard', n);

  DELETE FROM indicador_alocacao WHERE tenant_id = _destino
    AND indicador_id IN (SELECT id FROM indicadores_empresa WHERE tenant_id = _destino AND company_id IS NULL);
  DELETE FROM indicadores_empresa WHERE tenant_id = _destino AND company_id IS NULL;
  INSERT INTO indicadores_empresa (tenant_id, company_id, nome, categoria, formula, modo_analise, faixas, descricao, visibilidade, is_padrao, revisar_contas, ordem)
  SELECT _destino, NULL, nome, categoria, formula, modo_analise, faixas, descricao, visibilidade, is_padrao, revisar_contas, ordem
  FROM indicadores_empresa WHERE tenant_id = _origem AND company_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('indicadores', n);

  DELETE FROM analise_configs WHERE tenant_id = _destino;
  INSERT INTO analise_configs (tenant_id, secao, nome, descricao, formula, formato, grafico, visivel, ordem)
  SELECT _destino, secao, nome, descricao, formula, formato, grafico, visivel, ordem FROM analise_configs WHERE tenant_id = _origem;
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('analises', n);

  DELETE FROM mascara_classificacao WHERE tenant_id = _destino AND company_id IS NULL;
  INSERT INTO mascara_classificacao (tenant_id, company_id, separador, niveis, grupos, larguras)
  SELECT _destino, NULL, separador, niveis, grupos, larguras FROM mascara_classificacao WHERE tenant_id = _origem AND company_id IS NULL;

  INSERT INTO sistemas_contabeis (tenant_id, nome, layout)
  SELECT _destino, nome, layout FROM sistemas_contabeis s WHERE tenant_id = _origem
    AND NOT EXISTS (SELECT 1 FROM sistemas_contabeis x WHERE x.tenant_id = _destino AND x.nome = s.nome);
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('sistemas', n);

  INSERT INTO segmentos (tenant_id, nome)
  SELECT _destino, nome FROM segmentos s WHERE tenant_id = _origem
    AND NOT EXISTS (SELECT 1 FROM segmentos x WHERE x.tenant_id = _destino AND x.nome = s.nome);
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('segmentos', n);

  UPDATE tenants SET plano_contas_modo = (SELECT plano_contas_modo FROM tenants WHERE id = _origem) WHERE id = _destino;
  RETURN r;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.replicar_estrutura_tenant(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.replicar_estrutura_tenant(uuid, uuid) TO authenticated, service_role;