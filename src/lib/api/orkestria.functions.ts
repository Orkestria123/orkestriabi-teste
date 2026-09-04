import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Bootstrap: o PRIMEIRO usuário a chamar essa função recebe o papel
 * de orkestria_admin (se ninguém ainda tem). Caso contrário, exige
 * que o chamador já seja orkestria_admin.
 */
export const claimOrkestriaAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "orkestria_admin");

    if ((count ?? 0) > 0) {
      // já existe — só admin pode escalar
      const { data: isAdmin } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("user_id", context.userId)
        .eq("role", "orkestria_admin")
        .maybeSingle();
      if (!isAdmin) throw new Error("Forbidden");
    }

    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: context.userId, role: "orkestria_admin" }, { onConflict: "user_id,role" });
    return { ok: true };
  });

/**
 * Cria um novo tenant + usuário admin do tenant.
 * Requer orkestria_admin.
 */
export const createTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().min(2),
        slug: z.string().min(2),
        plan: z.string().default("starter"),
        max_companies: z.number().int().min(1).default(5),
        max_users: z.number().int().min(1).default(10),
        admin_email: z.string().email(),
        admin_name: z.string().min(2),
        admin_password: z.string().min(8),
        primary_color: z.string().default("#6366F1"),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // verifica role
    const { data: isAdmin } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", context.userId)
      .eq("role", "orkestria_admin")
      .maybeSingle();
    if (!isAdmin) throw new Error("Forbidden");

    // cria tenant
    const { data: tenant, error: tErr } = await supabaseAdmin
      .from("tenants")
      .insert({
        name: data.name,
        slug: data.slug,
        plan: data.plan,
        max_companies: data.max_companies,
        max_users: data.max_users,
        primary_color: data.primary_color,
      })
      .select()
      .single();
    if (tErr) throw new Error(tErr.message);

    // cria usuário admin
    const { data: userResp, error: uErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.admin_email,
      password: data.admin_password,
      email_confirm: true,
      user_metadata: { full_name: data.admin_name },
    });
    if (uErr) throw new Error(uErr.message);
    const newUid = userResp.user!.id;

    await supabaseAdmin
      .from("profiles")
      .update({ tenant_id: tenant.id, full_name: data.admin_name })
      .eq("id", newUid);

    await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newUid, role: "tenant_admin", tenant_id: tenant.id });

    return { ok: true, tenant_id: tenant.id };
  });

/**
 * Cria um usuário cliente vinculado a uma empresa.
 * Requer tenant_admin do tenant da empresa.
 */
export const createClientUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email(),
        full_name: z.string().min(2),
        password: z.string().min(8),
        company_id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // pega tenant_id da empresa
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("tenant_id")
      .eq("id", data.company_id)
      .maybeSingle();
    if (!company) throw new Error("Empresa não encontrada");

    // verifica que chamador é tenant_admin do mesmo tenant
    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    const { data: isTenantAdmin } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", context.userId)
      .eq("role", "tenant_admin")
      .maybeSingle();
    if (!isTenantAdmin || callerProfile?.tenant_id !== company.tenant_id) {
      throw new Error("Forbidden");
    }

    const { data: userResp, error: uErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (uErr) throw new Error(uErr.message);
    const newUid = userResp.user!.id;

    await supabaseAdmin
      .from("profiles")
      .update({
        tenant_id: company.tenant_id,
        company_id: data.company_id,
        full_name: data.full_name,
      })
      .eq("id", newUid);

    await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newUid, role: "client", tenant_id: company.tenant_id });

    return { ok: true };
  });

/**
 * Exclui um usuário (auth + perfil + papéis em cascata).
 * Requer tenant_admin do mesmo tenant ou orkestria_admin. Não permite excluir a si mesmo.
 */
export const deleteUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ user_id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.user_id === context.userId) throw new Error("Você não pode excluir a si mesmo");

    const { data: callerRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role, tenant_id")
      .eq("user_id", context.userId);
    const isOrk = callerRoles?.some((r) => r.role === "orkestria_admin");
    const tenantAdminOf = callerRoles?.find((r) => r.role === "tenant_admin")?.tenant_id ?? null;
    if (!isOrk && !tenantAdminOf) throw new Error("Forbidden");

    if (!isOrk) {
      const { data: target } = await supabaseAdmin
        .from("profiles")
        .select("tenant_id")
        .eq("id", data.user_id)
        .maybeSingle();
      if (!target || target.tenant_id !== tenantAdminOf) throw new Error("Forbidden");
      // tenant_admin não pode excluir um orkestria_admin
      const { data: targetIsOrk } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("user_id", data.user_id)
        .eq("role", "orkestria_admin")
        .maybeSingle();
      if (targetIsOrk) throw new Error("Forbidden");
    }

    const { data: alvoPerfil } = await supabaseAdmin
      .from("profiles")
      .select("full_name, email, tenant_id")
      .eq("id", data.user_id)
      .maybeSingle();
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    const { gravarLog } = await import("./auditoria.server");
    await gravarLog(supabaseAdmin, {
      user_id: context.userId,
      tenant_id: alvoPerfil?.tenant_id ?? null,
      acao: "exclusao",
      entidade: "usuario",
      entidade_id: data.user_id,
      entidade_nome: alvoPerfil?.full_name ?? alvoPerfil?.email ?? null,
    });
    return { ok: true };
  });

/**
 * Exclui um tenant inteiro: remove usuários de auth (que cascateiam profiles/roles),
 * arquivos no storage e o tenant. Apenas orkestria_admin.
 */
export const deleteTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ tenant_id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: isOrk } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", context.userId)
      .eq("role", "orkestria_admin")
      .maybeSingle();
    if (!isOrk) throw new Error("Forbidden");

    // remove arquivos do storage
    const { data: files } = await supabaseAdmin
      .from("sped_files")
      .select("file_url")
      .eq("tenant_id", data.tenant_id);
    const paths = (files ?? []).map((f) => f.file_url).filter(Boolean) as string[];
    if (paths.length) await supabaseAdmin.storage.from("sped-files").remove(paths);

    // remove logo do tenant se existir
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("logo_url")
      .eq("id", data.tenant_id)
      .maybeSingle();
    if (tenant?.logo_url && !/^https?:\/\//.test(tenant.logo_url)) {
      await supabaseAdmin.storage.from("tenant-logos").remove([tenant.logo_url]);
    }

    // exclui usuários do tenant (não exclui o chamador)
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("tenant_id", data.tenant_id);
    for (const p of profs ?? []) {
      if (p.id === context.userId) continue;
      await supabaseAdmin.auth.admin.deleteUser(p.id);
    }

    const { gravarLog } = await import("./auditoria.server");
    await gravarLog(supabaseAdmin, {
      user_id: context.userId,
      tenant_id: data.tenant_id,
      acao: "exclusao",
      entidade: "escritorio",
      entidade_id: data.tenant_id,
      entidade_nome: null,
    });
    const { error } = await supabaseAdmin.from("tenants").delete().eq("id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Exclui uma empresa (e dados derivados em cascata).
 * Requer tenant_admin do mesmo tenant ou orkestria_admin.
 */
export const deleteCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ company_id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id, tenant_id")
      .eq("id", data.company_id)
      .maybeSingle();
    if (!company) throw new Error("Empresa não encontrada");

    const { data: callerRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role, tenant_id")
      .eq("user_id", context.userId);
    const isOrk = callerRoles?.some((r) => r.role === "orkestria_admin");
    const isTenantAdmin = callerRoles?.some(
      (r) => r.role === "tenant_admin" && r.tenant_id === company.tenant_id,
    );
    if (!isOrk && !isTenantAdmin) throw new Error("Forbidden");

    // remove arquivos de storage da empresa
    const { data: files } = await supabaseAdmin
      .from("sped_files")
      .select("file_url")
      .eq("company_id", data.company_id);
    const paths = (files ?? []).map((f) => f.file_url).filter(Boolean) as string[];
    if (paths.length) await supabaseAdmin.storage.from("sped-files").remove(paths);

    const { data: compNome } = await supabaseAdmin
      .from("companies")
      .select("name")
      .eq("id", data.company_id)
      .maybeSingle();
    const { error } = await supabaseAdmin.from("companies").delete().eq("id", data.company_id);
    if (error) throw new Error(error.message);
    const { gravarLog } = await import("./auditoria.server");
    await gravarLog(supabaseAdmin, {
      user_id: context.userId,
      tenant_id: company.tenant_id,
      acao: "exclusao",
      entidade: "empresa",
      entidade_id: data.company_id,
      entidade_nome: compNome?.name ?? null,
    });
    return { ok: true };
  });


/**
 * Exclui um arquivo SPED (storage + registro + dados derivados em cascata).
 * Requer tenant_admin do tenant do arquivo ou orkestria_admin.
 */
export const deleteSpedFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ file_id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: file } = await supabaseAdmin
      .from("sped_files")
      .select("id, tenant_id, file_url")
      .eq("id", data.file_id)
      .maybeSingle();
    if (!file) throw new Error("Arquivo não encontrado");

    const { data: callerRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role, tenant_id")
      .eq("user_id", context.userId);
    const isOrk = callerRoles?.some((r) => r.role === "orkestria_admin");
    const isTenantAdmin = callerRoles?.some(
      (r) => r.role === "tenant_admin" && r.tenant_id === file.tenant_id,
    );
    if (!isOrk && !isTenantAdmin) throw new Error("Forbidden");

    if (file.file_url) {
      await supabaseAdmin.storage.from("sped-files").remove([file.file_url]);
    }
    const { error } = await supabaseAdmin.from("sped_files").delete().eq("id", file.id);
    if (error) throw new Error(error.message);
    const { gravarLog } = await import("./auditoria.server");
    await gravarLog(supabaseAdmin, {
      user_id: context.userId,
      tenant_id: file.tenant_id,
      acao: "exclusao",
      entidade: "arquivo",
      entidade_id: file.id,
      entidade_nome: file.file_url ?? null,
    });
    return { ok: true };
  });

/**
 * Helper: valida que o chamador é tenant_admin (ou orkestria_admin) e devolve o tenant alvo.
 */
async function assertGestorTenant(supabaseAdmin: any, callerId: string) {
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role, tenant_id")
    .eq("user_id", callerId);
  const isOrk = roles?.some((r: any) => r.role === "orkestria_admin");
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("tenant_id")
    .eq("id", callerId)
    .maybeSingle();
  const tenantAdminOf = roles?.find((r: any) => r.role === "tenant_admin")?.tenant_id ?? null;
  const tenantId = prof?.tenant_id ?? tenantAdminOf;
  if (!isOrk && !tenantAdminOf) throw new Error("Forbidden");
  if (!tenantId) throw new Error("Usuário sem escritório vinculado");
  return { tenantId: tenantId as string, isOrk: !!isOrk };
}

const usuarioBase = {
  full_name: z.string().min(2),
  telefone: z.string().optional().nullable(),
  tipo_usuario: z.enum(["admin_escritorio", "cliente"]),
  company_ids: z.array(z.string().uuid()).default([]),
};

/**
 * Cria um usuário do escritório (colaborador) ou um cliente com vínculos de empresas.
 */
export const createUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        ...usuarioBase,
        email: z.string().email(),
        password: z.string().min(8),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { tenantId } = await assertGestorTenant(supabaseAdmin, context.userId);

    const { data: userResp, error: uErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (uErr) {
      const msg = (uErr.message || "").toLowerCase();
      if (msg.includes("already been registered") || msg.includes("already exists") || (uErr as any).code === "email_exists") {
        const { data: existente } = await supabaseAdmin
          .from("profiles")
          .select("full_name, tipo_usuario, tenant_id")
          .eq("email", data.email)
          .maybeSingle();
        if (existente && existente.tenant_id === tenantId) {
          throw new Error(
            `Este e-mail já está cadastrado neste escritório${existente.full_name ? ` (${existente.full_name})` : ""}. Edite o usuário existente em vez de criar um novo.`,
          );
        }
        throw new Error("Este e-mail já está em uso por outro usuário. Utilize outro e-mail.");
      }
      throw new Error(uErr.message);
    }
    const newUid = userResp.user!.id;

    const isCliente = data.tipo_usuario === "cliente";
    await supabaseAdmin
      .from("profiles")
      .update({
        tenant_id: tenantId,
        full_name: data.full_name,
        telefone: data.telefone || null,
        tipo_usuario: data.tipo_usuario,
        company_id: isCliente ? (data.company_ids[0] ?? null) : null,
      })
      .eq("id", newUid);

    await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newUid, role: isCliente ? "client" : "tenant_admin", tenant_id: tenantId });

    if (isCliente && data.company_ids.length) {
      const { data: comps } = await supabaseAdmin
        .from("companies")
        .select("id")
        .eq("tenant_id", tenantId)
        .in("id", data.company_ids);
      const rows = (comps ?? []).map((c: any) => ({
        tenant_id: tenantId,
        user_id: newUid,
        company_id: c.id,
      }));
      if (rows.length) await supabaseAdmin.from("usuario_empresas").insert(rows);
      await registrarDiffVinculosPorEmpresa(supabaseAdmin, {
        callerId: context.userId,
        tenantId,
        userId: newUid,
        adicionadas: rows.map((r: any) => r.company_id),
        removidas: [],
      });
    }

    return { ok: true, user_id: newUid };
  });

/**
 * Atualiza dados do usuário e (para clientes) os vínculos de empresas.
 */
export const updateUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ ...usuarioBase, user_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { tenantId, isOrk } = await assertGestorTenant(supabaseAdmin, context.userId);

    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", data.user_id)
      .maybeSingle();
    if (!target) throw new Error("Usuário não encontrado");
    if (!isOrk && target.tenant_id !== tenantId) throw new Error("Forbidden");
    const alvoTenant = (target.tenant_id ?? tenantId) as string;

    const isCliente = data.tipo_usuario === "cliente";
    await supabaseAdmin
      .from("profiles")
      .update({
        full_name: data.full_name,
        telefone: data.telefone || null,
        tipo_usuario: data.tipo_usuario,
        company_id: isCliente ? (data.company_ids[0] ?? null) : null,
      })
      .eq("id", data.user_id);

    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.user_id)
      .in("role", ["tenant_admin", "client"]);
    await supabaseAdmin
      .from("user_roles")
      .insert({
        user_id: data.user_id,
        role: isCliente ? "client" : "tenant_admin",
        tenant_id: alvoTenant,
      });

    const { data: vincAntes } = await supabaseAdmin
      .from("usuario_empresas")
      .select("company_id")
      .eq("user_id", data.user_id);
    await supabaseAdmin.from("usuario_empresas").delete().eq("user_id", data.user_id);
    if (isCliente && data.company_ids.length) {
      const { data: comps } = await supabaseAdmin
        .from("companies")
        .select("id")
        .eq("tenant_id", alvoTenant)
        .in("id", data.company_ids);
      const rows = (comps ?? []).map((c: any) => ({
        tenant_id: alvoTenant,
        user_id: data.user_id,
        company_id: c.id,
      }));
      if (rows.length) await supabaseAdmin.from("usuario_empresas").insert(rows);
    }

    const compAntes: string[] = (vincAntes ?? []).map((r: any) => r.company_id);
    const compDepois: string[] = isCliente ? data.company_ids : [];
    await registrarDiffVinculosPorEmpresa(supabaseAdmin, {
      callerId: context.userId,
      tenantId: alvoTenant,
      userId: data.user_id,
      adicionadas: compDepois.filter((id) => !compAntes.includes(id)),
      removidas: compAntes.filter((id) => !compDepois.includes(id)),
    });

    return { ok: true };
  });

/**
 * Dupla-via: define os clientes com acesso a UMA empresa.
 * Escreve na mesma tabela usuario_empresas usada no cadastro de usuário.
 */
export const setEmpresaUsuarios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        company_id: z.string().uuid(),
        user_ids: z.array(z.string().uuid()).default([]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { tenantId, isOrk } = await assertGestorTenant(supabaseAdmin, context.userId);

    const { data: comp } = await supabaseAdmin
      .from("companies")
      .select("id, tenant_id")
      .eq("id", data.company_id)
      .maybeSingle();
    if (!comp) throw new Error("Empresa não encontrada");
    if (!isOrk && comp.tenant_id !== tenantId) throw new Error("Forbidden");

    // Só clientes do mesmo escritório podem ser vinculados.
    const { data: alvos } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("tenant_id", comp.tenant_id)
      .eq("tipo_usuario", "cliente")
      .in("id", data.user_ids.length ? data.user_ids : ["00000000-0000-0000-0000-000000000000"]);

    const { data: antes } = await supabaseAdmin
      .from("usuario_empresas")
      .select("user_id")
      .eq("company_id", data.company_id);
    await supabaseAdmin.from("usuario_empresas").delete().eq("company_id", data.company_id);
    const rows = (alvos ?? []).map((u: any) => ({
      tenant_id: comp.tenant_id,
      user_id: u.id,
      company_id: data.company_id,
    }));
    if (rows.length) await supabaseAdmin.from("usuario_empresas").insert(rows);

    const antesIds: string[] = (antes ?? []).map((r: any) => r.user_id);
    const depoisIds: string[] = rows.map((r) => r.user_id);
    await registrarDiffVinculos(supabaseAdmin, {
      callerId: context.userId,
      tenantId: comp.tenant_id,
      companyId: data.company_id,
      adicionados: depoisIds.filter((id) => !antesIds.includes(id)),
      removidos: antesIds.filter((id) => !depoisIds.includes(id)),
    });
    return { ok: true, total: rows.length };
  });

/**
 * Resumo do escritório para o dashboard do admin:
 * contadores de empresas/usuários, espaço em storage e
 * distribuição da carteira por segmento e porte.
 */
export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { tenantId } = await assertGestorTenant(supabaseAdmin, context.userId);

    const [companiesRes, profilesRes, segmentosRes] = await Promise.all([
      supabaseAdmin.from("companies").select("id, segmento_id, porte").eq("tenant_id", tenantId),
      supabaseAdmin.from("profiles").select("id, tipo_usuario").eq("tenant_id", tenantId),
      supabaseAdmin.from("segmentos").select("id, nome").eq("tenant_id", tenantId),
    ]);

    const companies = companiesRes.data ?? [];
    const profiles = profilesRes.data ?? [];
    const segmentos = segmentosRes.data ?? [];

    const segNome = new Map<string, string>(segmentos.map((s: any) => [s.id, s.nome]));
    const porSegmento = new Map<string, number>();
    const porPorte = new Map<string, number>();
    for (const c of companies as any[]) {
      const seg = (c.segmento_id && segNome.get(c.segmento_id)) || "Não classificado";
      porSegmento.set(seg, (porSegmento.get(seg) ?? 0) + 1);
      const porte = c.porte || "Não classificado";
      porPorte.set(porte, (porPorte.get(porte) ?? 0) + 1);
    }

    // Espaço usado: soma dos objetos sob <tenantId>/<companyId>/ no bucket sped-files
    let storageBytes = 0;
    try {
      const { data: pastas } = await supabaseAdmin.storage
        .from("sped-files")
        .list(tenantId, { limit: 1000 });
      for (const pasta of pastas ?? []) {
        let offset = 0;
        // paginação simples por pasta de empresa
        for (;;) {
          const { data: objs } = await supabaseAdmin.storage
            .from("sped-files")
            .list(`${tenantId}/${pasta.name}`, { limit: 100, offset });
          const lote = objs ?? [];
          for (const o of lote as any[]) {
            storageBytes += Number(o?.metadata?.size ?? 0);
          }
          if (lote.length < 100) break;
          offset += 100;
        }
      }
    } catch {
      storageBytes = 0;
    }

    return {
      empresas: companies.length,
      usuarios: profiles.length,
      colaboradores: profiles.filter((p: any) => p.tipo_usuario === "admin_escritorio").length,
      clientes: profiles.filter((p: any) => p.tipo_usuario === "cliente").length,
      storageBytes,
      porSegmento: [...porSegmento.entries()]
        .map(([nome, total]) => ({ nome, total }))
        .sort((a, b) => b.total - a.total),
      porPorte: [...porPorte.entries()]
        .map(([nome, total]) => ({ nome, total }))
        .sort((a, b) => b.total - a.total),
    };
  });

/** Helpers de auditoria de vínculos cliente x empresa. */
async function nomesDeUsuarios(supabaseAdmin: any, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const { data } = await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", ids);
  return new Map<string, string>((data ?? []).map((p: any) => [p.id, p.full_name || p.email || p.id]));
}

async function nomesDeEmpresas(supabaseAdmin: any, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const { data } = await supabaseAdmin.from("companies").select("id, name").in("id", ids);
  return new Map<string, string>((data ?? []).map((c: any) => [c.id, c.name]));
}

async function registrarDiffVinculos(
  supabaseAdmin: any,
  args: { callerId: string; tenantId: string; companyId: string; adicionados: string[]; removidos: string[] },
) {
  if (!args.adicionados.length && !args.removidos.length) return;
  const { gravarLog } = await import("./auditoria.server");
  const users = await nomesDeUsuarios(supabaseAdmin, [...args.adicionados, ...args.removidos]);
  const empresas = await nomesDeEmpresas(supabaseAdmin, [args.companyId]);
  const empresaNome = empresas.get(args.companyId) ?? null;
  for (const [lista, acao] of [
    [args.adicionados, "vinculo_criado"],
    [args.removidos, "vinculo_removido"],
  ] as const) {
    for (const uid of lista) {
      await gravarLog(supabaseAdmin, {
        user_id: args.callerId,
        tenant_id: args.tenantId,
        acao,
        entidade: "vinculo",
        entidade_id: args.companyId,
        entidade_nome: empresaNome,
        detalhes: { cliente_id: uid, cliente_nome: users.get(uid) ?? null, empresa_nome: empresaNome },
      });
    }
  }
}

async function registrarDiffVinculosPorEmpresa(
  supabaseAdmin: any,
  args: { callerId: string; tenantId: string; userId: string; adicionadas: string[]; removidas: string[] },
) {
  if (!args.adicionadas.length && !args.removidas.length) return;
  const { gravarLog } = await import("./auditoria.server");
  const empresas = await nomesDeEmpresas(supabaseAdmin, [...args.adicionadas, ...args.removidas]);
  const users = await nomesDeUsuarios(supabaseAdmin, [args.userId]);
  const clienteNome = users.get(args.userId) ?? null;
  for (const [lista, acao] of [
    [args.adicionadas, "vinculo_criado"],
    [args.removidas, "vinculo_removido"],
  ] as const) {
    for (const cid of lista) {
      await gravarLog(supabaseAdmin, {
        user_id: args.callerId,
        tenant_id: args.tenantId,
        acao,
        entidade: "vinculo",
        entidade_id: cid,
        entidade_nome: empresas.get(cid) ?? null,
        detalhes: { cliente_id: args.userId, cliente_nome: clienteNome, empresa_nome: empresas.get(cid) ?? null },
      });
    }
  }
}
