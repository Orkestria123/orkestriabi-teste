import { getRequestHeader } from "@tanstack/react-start/server";

export type AcaoLog =
  | "login"
  | "logout"
  | "acesso_empresa"
  | "exclusao"
  | "vinculo_criado"
  | "vinculo_removido"
  | "upload"
  | "download"
  | "edicao";

export interface LogInput {
  tenant_id?: string | null;
  user_id: string;
  acao: AcaoLog;
  entidade?: string | null;
  entidade_id?: string | null;
  entidade_nome?: string | null;
  detalhes?: Record<string, unknown>;
}

function ipDaRequisicao(): string | null {
  try {
    const fwd = getRequestHeader("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim();
    return getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-real-ip") ?? null;
  } catch {
    return null;
  }
}

/**
 * Grava um evento de auditoria. Nunca lança — auditoria não pode quebrar a ação principal.
 */
export async function gravarLog(supabaseAdmin: any, input: LogInput) {
  try {
    const { data: perfil } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id, full_name, email, tipo_usuario")
      .eq("id", input.user_id)
      .maybeSingle();

    const tenantId = input.tenant_id ?? perfil?.tenant_id ?? null;
    if (!tenantId) return;

    await supabaseAdmin.from("logs_auditoria").insert({
      tenant_id: tenantId,
      user_id: input.user_id,
      user_nome: perfil?.full_name ?? perfil?.email ?? null,
      user_tipo: perfil?.tipo_usuario ?? null,
      acao: input.acao,
      entidade: input.entidade ?? null,
      entidade_id: input.entidade_id ?? null,
      entidade_nome: input.entidade_nome ?? null,
      detalhes: input.detalhes ?? {},
      ip: ipDaRequisicao(),
    });
  } catch (e) {
    console.error("[auditoria] falha ao gravar log", e);
  }
}
