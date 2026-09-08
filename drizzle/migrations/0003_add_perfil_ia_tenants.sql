ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS site text,
  ADD COLUMN IF NOT EXISTS perfil_ia text;