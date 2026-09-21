-- O Ponto de Equilíbrio lê as contas de resultado (classificacao like '3.%')
-- do plano da empresa + do plano global do tenant, ordenadas por codigo.
-- Sem índice, isso varria as ~350 mil linhas de plano_contas e estourava o
-- statement timeout. Índice parcial cobre exatamente esse recorte.
CREATE INDEX IF NOT EXISTS plano_contas_resultado_idx
  ON public.plano_contas (tenant_id, codigo)
  WHERE ativo AND classificacao LIKE '3.%';

CREATE INDEX IF NOT EXISTS plano_contas_tipo_custo_idx
  ON public.plano_contas (tenant_id, company_id)
  WHERE tipo_custo IS NOT NULL;
