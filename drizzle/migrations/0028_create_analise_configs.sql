CREATE TABLE public.analise_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  secao text not null default 'geral',
  nome text not null,
  descricao text,
  formula jsonb not null default '{"expressao": []}'::jsonb,
  formato text not null default 'reais',
  grafico text not null default 'linha',
  visivel boolean not null default true,
  ordem integer not null default 0,
  criado_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, secao, nome)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analise_configs TO authenticated;
GRANT ALL ON public.analise_configs TO service_role;

ALTER TABLE public.analise_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY analise_configs_leitura
ON public.analise_configs
FOR SELECT
TO authenticated
USING (pode_ler_tenant(tenant_id));

CREATE POLICY analise_configs_escrita
ON public.analise_configs
FOR ALL
TO authenticated
USING (pode_gerenciar_tenant(tenant_id))
WITH CHECK (pode_gerenciar_tenant(tenant_id));