// Integração com a API Twilio Verify (envio e conferência de códigos por SMS).
// Server-only: as credenciais nunca chegam ao navegador.

const BASE = "https://verify.twilio.com/v2/Services";

function credenciais() {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"];
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  const serviceSid = process.env["TWILIO_VERIFY_SERVICE_SID"];
  if (!accountSid || !authToken || !serviceSid) {
    throw new Error(
      "Verificação por SMS ainda não está configurada. Contate o administrador da plataforma.",
    );
  }
  return {
    serviceSid,
    auth: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
  };
}

/** Converte telefone digitado em formato livre para E.164 (padrão Brasil). */
export function normalizarTelefone(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const limpo = bruto.trim();
  if (limpo.startsWith("+")) {
    const so = "+" + limpo.slice(1).replace(/\D/g, "");
    return so.length >= 11 ? so : null;
  }
  const digitos = limpo.replace(/\D/g, "");
  if (digitos.length === 10 || digitos.length === 11) return `+55${digitos}`;
  if (digitos.length === 12 || digitos.length === 13) return `+${digitos}`;
  return null;
}

/** Mostra apenas os últimos dígitos: (11) *****-1234 */
export function mascararTelefone(e164: string): string {
  const fim = e164.slice(-4);
  return `${e164.slice(0, 3)} ••••• ${fim}`;
}

async function twilio(path: string, body: Record<string, string>) {
  const { serviceSid, auth } = credenciais();
  const resp = await fetch(`${BASE}/${serviceSid}${path}`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  const texto = await resp.text();
  if (!resp.ok) {
    console.error(`[Twilio Verify] ${path} falhou [${resp.status}]: ${texto}`);
    let mensagem = "Não foi possível enviar o código por SMS.";
    try {
      const j = JSON.parse(texto) as { message?: string; code?: number };
      if (j.code === 60200) mensagem = "Número de telefone inválido no cadastro.";
      else if (j.code === 60203) mensagem = "Muitas tentativas. Aguarde alguns minutos.";
      else if (j.message) mensagem = j.message;
    } catch {
      /* mantém mensagem padrão */
    }
    throw new Error(mensagem);
  }
  return JSON.parse(texto) as { status?: string; sid?: string };
}

export async function enviarCodigoSms(telefoneE164: string) {
  return twilio("/Verifications", { To: telefoneE164, Channel: "sms" });
}

export async function conferirCodigoSms(telefoneE164: string, codigo: string) {
  const r = await twilio("/VerificationCheck", { To: telefoneE164, Code: codigo });
  return r.status === "approved";
}
