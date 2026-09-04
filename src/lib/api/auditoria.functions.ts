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
