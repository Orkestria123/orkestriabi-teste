import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Claims = { session_id?: string } & Record<string, unknown>;

function sessionId(claims: unknown): string {
  const sid = (claims as Claims)?.session_id;
  if (!sid || typeof sid !== "string") throw new Error("Sessão inválida. Entre novamente.");
  return sid;
}

/**
 * Telefone usado no MFA. Admins do escritório (admin_escritorio) e superadmins
 * (orkestria_admin) são isentos da verificação em duas etapas: retornamos null.
 */
async function carregarTelefone(supabaseAdmin: any, userId: string) {
  const { normalizarTelefone } = await import("./mfa.server");
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("telefone, tipo_usuario")
    .eq("id", userId)
    .maybeSingle();
  const tipo = data?.tipo_usuario ?? null;
  if (tipo === "admin_escritorio" || tipo === "orkestria_admin") return null;
  return normalizarTelefone(data?.telefone ?? null);
}


/** Diz se a etapa de SMS é exigida e se a sessão atual já foi verificada. */
export const mfaStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { mascararTelefone } = await import("./mfa.server");
    const telefone = await carregarTelefone(supabaseAdmin, context.userId);
    if (!telefone) return { requerido: false, verificado: true, telefone: null as string | null };

    const sid = sessionId(context.claims);
    const { data } = await supabaseAdmin
      .from("mfa_sessoes")
      .select("id")
      .eq("user_id", context.userId)
      .eq("session_id", sid)
      .maybeSingle();

    return {
      requerido: true,
      verificado: Boolean(data),
      telefone: mascararTelefone(telefone),
    };
  });

/** Dispara o SMS com o código para o telefone cadastrado pelo escritório. */
export const mfaEnviarCodigo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enviarCodigoSms, mascararTelefone } = await import("./mfa.server");
    const telefone = await carregarTelefone(supabaseAdmin, context.userId);
    if (!telefone) {
      throw new Error("Nenhum telefone cadastrado. Contate seu escritório contábil.");
    }
    await enviarCodigoSms(telefone);
    return { ok: true, telefone: mascararTelefone(telefone) };
  });

/** Confere o código recebido e libera a sessão atual. */
export const mfaVerificarCodigo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ codigo: z.string().trim().min(4).max(10) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { conferirCodigoSms } = await import("./mfa.server");
    const { gravarLog } = await import("./auditoria.server");

    const telefone = await carregarTelefone(supabaseAdmin, context.userId);
    if (!telefone) throw new Error("Nenhum telefone cadastrado.");

    const aprovado = await conferirCodigoSms(telefone, data.codigo);
    if (!aprovado) throw new Error("Código inválido ou expirado.");

    const sid = sessionId(context.claims);
    await supabaseAdmin
      .from("mfa_sessoes")
      .upsert({ user_id: context.userId, session_id: sid }, { onConflict: "user_id,session_id" });

    await gravarLog(supabaseAdmin, {
      user_id: context.userId,
      acao: "login",
      entidade: "sessao",
      detalhes: { fator: "sms", provedor: "twilio_verify" },
    });

    return { ok: true };
  });
