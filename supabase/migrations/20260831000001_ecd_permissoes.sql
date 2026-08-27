-- ============================================================
-- AJUSTE 25 — o ECD carregava e não aparecia: faltava GRANT
-- ============================================================
--
-- Sintoma: o carregamento confirmava "N contas e M meses em espera", e a
-- lista de contas abaixo vinha vazia. Sem vínculo, nada chegava às
-- demonstrações.
--
-- Causa: as tabelas do ajuste 24 nasceram com RLS ligada e com política
-- escrita — mas **sem GRANT** para o papel `authenticated`. RLS filtra
-- LINHAS; GRANT dá acesso à TABELA. Sem o segundo, o primeiro nem chega
-- a ser avaliado:
--
--     SET ROLE authenticated;
--     SELECT count(*) FROM ecd_importacao;
--     ERROR:  permission denied for table ecd_importacao
--
-- A gravação funcionava porque `ecd_importar` é SECURITY DEFINER e roda
-- como dono — por isso o contador dizia que tinha carregado. A leitura
-- vem do navegador, com o papel do usuário, e batia na porta fechada.
--
-- Por que passou nos meus testes: o harness conecta como superusuário,
-- que ignora GRANT e RLS. Nenhuma bateria minha exercitava permissão.
-- Corrigido junto — ver `harness/rls.ts` no pacote.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ecd_importacao TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ecd_conta      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ecd_saldo      TO authenticated;

GRANT ALL ON public.ecd_importacao TO service_role;
GRANT ALL ON public.ecd_conta      TO service_role;
GRANT ALL ON public.ecd_saldo      TO service_role;

-- `ecd_normalizar_texto` é usada pelas funções de sugestão; sem execute
-- explícito o `authenticated` também não a alcança.
GRANT EXECUTE ON FUNCTION public.ecd_normalizar_texto(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
