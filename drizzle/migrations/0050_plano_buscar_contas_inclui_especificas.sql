CREATE OR REPLACE FUNCTION public.plano_buscar_contas(_company_id uuid, _termo text, _limite integer DEFAULT 60)
RETURNS TABLE(codigo text, descricao text, classificacao text, is_participante boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
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
     and (case when _usa_padrao then (pc.company_id is null or pc.company_id = _company_id)
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
$function$;

GRANT EXECUTE ON FUNCTION public.plano_buscar_contas(uuid, text, integer) TO authenticated;