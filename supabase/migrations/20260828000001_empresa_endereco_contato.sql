-- ============================================================
-- AJUSTE 22 — endereço e contato no cadastro da empresa
-- ============================================================
--
-- Só COLUNAS NOVAS. `ADD COLUMN IF NOT EXISTS` não reescreve linha
-- nenhuma e não toca no que já existe: as empresas cadastradas continuam
-- exatamente como estão, com os campos novos vazios.
--
-- Entra com `npx supabase migration up`. Não precisa de `db reset` — e
-- não deve usar `db reset`, que apagaria os dados carregados.
--
-- Nenhuma coluna é obrigatória, de propósito: cadastro de empresa é
-- preenchido aos poucos, e travar o salvamento por causa de um CEP que
-- ainda não se sabe atrapalha mais do que ajuda.

ALTER TABLE public.companies
  -- endereço
  ADD COLUMN IF NOT EXISTS cep          text,
  ADD COLUMN IF NOT EXISTS logradouro   text,
  ADD COLUMN IF NOT EXISTS numero       text,
  ADD COLUMN IF NOT EXISTS complemento  text,
  ADD COLUMN IF NOT EXISTS bairro       text,
  ADD COLUMN IF NOT EXISTS municipio    text,
  ADD COLUMN IF NOT EXISTS uf           text,
  -- contato
  ADD COLUMN IF NOT EXISTS telefone     text,
  ADD COLUMN IF NOT EXISTS email        text,
  ADD COLUMN IF NOT EXISTS responsavel  text;

COMMENT ON COLUMN public.companies.uf IS 'Sigla da UF, 2 letras. Sem restrição: é cadastro, não validação.';

-- A política "Tenant admins manage their companies" é ALL sobre a tabela
-- inteira, então já cobre as colunas novas — não há o que ajustar em RLS.

-- O PostgREST guarda um cache do schema; sem isto as colunas novas
-- existem no banco e a API responde que não conhece.
NOTIFY pgrst, 'reload schema';
