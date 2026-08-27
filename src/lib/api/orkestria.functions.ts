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

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
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

    const { error } = await supabaseAdmin.from("companies").delete().eq("id", data.company_id);
    if (error) throw new Error(error.message);
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
    return { ok: true };
  });
