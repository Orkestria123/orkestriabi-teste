import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Registra o evento de login/logout do usuário autenticado. */
export const registrarAcesso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ acao: z.enum(["login", "logout"]).default("login") }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { gravarLog } = await import("./auditoria.server");
    await gravarLog(supabaseAdmin, {
      user_id: context.userId,
      acao: data.acao,
      entidade: "sessao",
    });
    return { ok: true };
  });

/** Registra uma exclusão feita pela interface (ex.: segmentos, cadastros simples). */
export const registrarExclusao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        entidade: z.string().min(1),
        entidade_id: z.string().uuid().optional().nullable(),
        entidade_nome: z.string().optional().nullable(),
        detalhes: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { gravarLog } = await import("./auditoria.server");
    await gravarLog(supabaseAdmin, {
      user_id: context.userId,
      acao: "exclusao",
      entidade: data.entidade,
      entidade_id: data.entidade_id ?? null,
      entidade_nome: data.entidade_nome ?? null,
      detalhes: data.detalhes ?? {},
    });
    return { ok: true };
  });

/** Registra que um usuário abriu o BI de uma empresa. */
export const registrarAcessoEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        company_id: z.string().uuid(),
        company_nome: z.string().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { gravarLog } = await import("./auditoria.server");
    await gravarLog(supabaseAdmin, {
      user_id: context.userId,
      acao: "acesso_empresa",
      entidade: "empresa",
      entidade_id: data.company_id,
      entidade_nome: data.company_nome ?? null,
    });
    return { ok: true };
  });
