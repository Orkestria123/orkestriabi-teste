-- O plano do escritório tem 212 mil contas, das quais 211 mil são
-- clientes e fornecedores. Toda vez que a ECD monta os grupos ela
-- precisa apenas das 198 sintéticas e das ~950 folhas estruturais —
-- e estava varrendo a tabela inteira para achá-las, o que estourava o
-- tempo limite do banco na conferência de grupos.
CREATE INDEX IF NOT EXISTS idx_plano_contas_sinteticas_ativas
  ON public.plano_contas (tenant_id, company_id)
  INCLUDE (codigo, classificacao, descricao, tipo)
  WHERE is_sintetica AND ativo;

CREATE INDEX IF NOT EXISTS idx_plano_contas_folhas_estruturais
  ON public.plano_contas (tenant_id, company_id)
  INCLUDE (codigo, classificacao, descricao, tipo)
  WHERE ativo AND NOT is_sintetica AND NOT COALESCE(is_participante, false);