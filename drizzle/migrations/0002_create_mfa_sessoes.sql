create table if not exists public.mfa_sessoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  ip text,
  verificado_em timestamptz not null default now(),
  unique (user_id, session_id)
);

grant select on public.mfa_sessoes to authenticated;
grant all on public.mfa_sessoes to service_role;

alter table public.mfa_sessoes enable row level security;

drop policy if exists "usuario le suas verificacoes mfa" on public.mfa_sessoes;
create policy "usuario le suas verificacoes mfa"
  on public.mfa_sessoes for select to authenticated
  using (user_id = auth.uid());

create index if not exists idx_mfa_sessoes_user on public.mfa_sessoes (user_id, verificado_em desc);