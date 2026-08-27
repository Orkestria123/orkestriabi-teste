-- ============================================================
-- Índice redundante em public.user_roles
--
-- A tabela já tem: UNIQUE(user_id, role) — definida na migration
-- inicial (20260610162554). Uma constraint UNIQUE(a, b) já cria
-- automaticamente um índice btree único cuja primeira coluna é
-- `a` (aqui, user_id), então esse índice já serve com boa
-- performance qualquer WHERE user_id = ... ou WHERE user_id = ...
-- AND role = ... .
--
-- O índice extra `idx_user_roles_user` (também na 20260610162554)
-- cobre exatamente a mesma coluna líder (user_id) e não acrescenta
-- nenhum plano de consulta novo — só duplica o trabalho de escrita
-- (toda INSERT/UPDATE/DELETE em user_roles mantém dois índices em
-- vez de um) e o espaço em disco. Tabela pequena hoje, mas é
-- desperdício sem nenhum ganho — remover é seguro.
-- ============================================================

DROP INDEX IF EXISTS public.idx_user_roles_user;
