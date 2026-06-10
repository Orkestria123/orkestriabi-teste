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
