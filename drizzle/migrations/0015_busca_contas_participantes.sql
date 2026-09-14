create or replace function public.norm_busca(_t text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select lower(translate(
    _t,
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
    'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'
  ))
$$;

create index if not exists idx_plano_contas_busca_descricao
  on public.plano_contas using gin (public.norm_busca(descricao) gin_trgm_ops);

create index if not exists idx_plano_contas_busca_codigo
  on public.plano_contas using gin (public.norm_busca(codigo) gin_trgm_ops);

create or replace function public.plano_buscar_contas(
  _company_id uuid,
  _termo text,
  _limite integer default 60
)
returns table (
  codigo text,
  descricao text,
  classificacao text,
  is_participante boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _scope uuid;
  _usa_padrao boolean;
  _t text;
begin
  if not public.pode_acessar_empresa(_company_id) then
    return;
  end if;

  select e.tenant_id, e.company_scope into _tenant, _scope
    from public.plano_escopo(_company_id) e;
  if _tenant is null then
    return;
  end if;
  _usa_padrao := _scope is null;

  _t := public.norm_busca(coalesce(_termo, ''));
  if length(_t) < 2 then
    return;
  end if;

  return query
  select pc.codigo, pc.descricao, pc.classificacao,
         coalesce(pc.is_participante, false) as is_participante
    from public.plano_contas pc
   where pc.tenant_id = _tenant
     and (case when _usa_padrao then pc.company_id is null
               else pc.company_id = _company_id end)
     and coalesce(pc.ativo, true)
     and (
       public.norm_busca(pc.descricao) like '%' || _t || '%'
       or public.norm_busca(pc.codigo) like '%' || _t || '%'
       or pc.classificacao like _t || '%'
     )
   order by coalesce(pc.is_participante, false), pc.classificacao
   limit greatest(1, least(coalesce(_limite, 60), 200));
end;
$$;

grant execute on function public.norm_busca(text) to authenticated, anon, service_role;
grant execute on function public.plano_buscar_contas(uuid, text, integer) to authenticated, service_role;