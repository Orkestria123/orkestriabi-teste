-- ============================================================
-- Seed local do Orkestria BI
--
-- O Supabase CLI aplica este arquivo automaticamente DEPOIS das
-- migrations, toda vez que você roda `supabase start` (primeira
-- subida) ou `supabase db reset`. Não precisa rodar nada à mão.
--
-- Por que isso existe: os buckets de storage `sped-files` e
-- `tenant-logos` são referenciados no código (upload de SPED, logo
-- de tenant) e têm RLS policies escritas para eles nas migrations,
-- mas o CRIAR o bucket em si nunca foi versionado em nenhuma
-- migration — foi feito manualmente no painel do projeto hospedado
-- em algum momento. Numa instância local nova, os buckets não
-- existem até você criá-los, então replicamos isso aqui.
--
-- `public = false` nos dois: o código nunca monta uma URL pública
-- direta para esses arquivos — ele sempre gera signed URL
-- (ver src/hooks/use-auth.tsx, createSignedUrl para logo) ou passa
-- pelas RLS policies de storage.objects já existentes nas
-- migrations. Se no projeto hospedado algum desses buckets estiver
-- marcado como público, ajuste aqui ou troque depois pelo Studio
-- local (http://127.0.0.1:54323 → Storage → bucket → Configuration).
-- ============================================================

insert into storage.buckets (id, name, public)
values ('sped-files', 'sped-files', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('tenant-logos', 'tenant-logos', false)
on conflict (id) do nothing;
