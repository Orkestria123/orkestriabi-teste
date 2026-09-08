// Geração de perfil (empresa ou escritório) a partir do conteúdo real do site.
// Passo 1: o servidor baixa o HTML e extrai o texto útil.
// Passo 2: o texto é enviado ao Lovable AI Gateway para virar um perfil estruturado.
// A IA é instruída a NÃO inventar: só usa o que veio do site.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  site: z.string().min(3),
  tipo: z.enum(["empresa", "escritorio"]).default("empresa"),
  nome: z.string().optional().default(""),
});

const LIMITE_TEXTO = 8000;

function normalizarUrl(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const comProtocolo = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(comProtocolo);
    if (!/^[\w-]+(\.[\w-]+)+$/.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Remove script/style/nav/rodapé e tags, devolvendo só o texto legível. */
function extrairTexto(html: string): string {
  const limpo = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|header|footer)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|section|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodificar(limpo)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n")
    .trim();
}

function decodificar(s: string): string {
  const mapa: Record<string, string> = {
    "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
    "&#39;": "'", "&apos;": "'", "&ldquo;": '"', "&rdquo;": '"',
  };
  return s
    .replace(/&[a-zA-Z]+;|&#\d+;/g, (m) => {
      if (mapa[m]) return mapa[m];
      const num = /^&#(\d+);$/.exec(m);
      return num ? String.fromCharCode(Number(num[1])) : " ";
    });
}

async function baixar(url: string, timeoutMs = 12000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OrkestriaBI/1.0; +perfil)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const tipo = res.headers.get("content-type") ?? "";
    if (tipo && !tipo.includes("html") && !tipo.includes("text")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Procura links de "sobre / quem somos / a empresa" na página inicial. */
function linksSobre(html: string, base: string): string[] {
  const achados: string[] = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && achados.length < 2) {
    const href = m[1];
    const texto = extrairTexto(m[2]).toLowerCase();
    const alvo = `${href.toLowerCase()} ${texto}`;
    if (!/(sobre|quem-somos|quem somos|a-empresa|a empresa|institucional|about)/.test(alvo)) continue;
    try {
      const abs = new URL(href, base).toString();
      if (!abs.startsWith("http")) continue;
      if (abs === base || achados.includes(abs)) continue;
      achados.push(abs);
    } catch { /* href inválido */ }
  }
  return achados;
}

function montarPrompt(opts: { alvo: string; origem: string; nome: string; conteudo: string }) {
  return `Abaixo está ${opts.origem}${opts.nome ? ` (${opts.nome})` : ""}.

--- INÍCIO DO CONTEÚDO ---
${opts.conteudo}
--- FIM DO CONTEÚDO ---

Escreva um perfil executivo do ${opts.alvo}, em português brasileiro, no estilo "Descrição da Empresa" de relatório executivo, em bullets objetivos, cobrindo apenas os tópicos que TÊM informação no conteúdo acima:
- Descrição geral (o que faz)
- Ramo/segmento de atuação
- Localização (matriz/sede)
- Tempo de mercado (ano de fundação)
- Porte (funcionários, área, estrutura)
- Produtos/serviços principais
- Mercados/regiões atendidas
- Pontos relevantes para análise

REGRA ABSOLUTA: use SOMENTE informações presentes no conteúdo acima. Se um dado não estiver lá (fundação, número de funcionários, etc.), OMITA o tópico inteiro. Nunca estime, deduza ou invente. Não escreva frases como "não informado". Sem introdução, sem conclusão, sem markdown de títulos — apenas os bullets começando com "- ".`;
}

async function chamarIa(prompt: string) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return { ok: false as const, erro: "Serviço de IA indisponível no momento. Preencha o perfil manualmente." };
  }
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-3.8-flash",
        messages: [
          {
            role: "system",
            content:
              "Você redige perfis empresariais para relatórios executivos, usando exclusivamente os fatos fornecidos. Nunca inventa dados.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("[perfil-ia] gateway", res.status, txt);
      if (res.status === 429)
        return { ok: false as const, erro: "Muitas solicitações à IA agora. Tente de novo em alguns instantes." };
      if (res.status === 402)
        return { ok: false as const, erro: "Créditos de IA esgotados. Adicione créditos para continuar." };
      return { ok: false as const, erro: "A IA não conseguiu gerar o perfil agora. Tente novamente ou preencha manualmente." };
    }
    const json = (await res.json()) as any;
    const perfil = (json?.choices?.[0]?.message?.content ?? "").trim();
    if (!perfil) return { ok: false as const, erro: "A IA não retornou conteúdo. Preencha o perfil manualmente." };
    return { ok: true as const, perfil };
  } catch (e) {
    console.error("[perfil-ia] fetch", e);
    return { ok: false as const, erro: "Falha ao falar com a IA. Tente novamente ou preencha manualmente." };
  }
}

const TextoSchema = z.object({
  texto: z.string().min(1),
  tipo: z.enum(["empresa", "escritorio"]).default("empresa"),
  nome: z.string().optional().default(""),
});

/** Gera o perfil a partir de um texto colado pelo admin (Instagram, Google, etc.). */
export const gerarPerfilDeTexto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => TextoSchema.parse(input))
  .handler(async ({ data }) => {
    const texto = data.texto.trim().slice(0, LIMITE_TEXTO);
    if (texto.replace(/\s/g, "").length < 60) {
      return {
        ok: false as const,
        erro: "Cole um pouco mais de informação (pelo menos algumas frases) para a IA montar o perfil.",
      };
    }
    const alvo = data.tipo === "escritorio" ? "escritório contábil" : "empresa";
    const r = await chamarIa(
      montarPrompt({
        alvo,
        origem: "um texto sobre a organização, copiado de fontes como site, Instagram ou busca do Google",
        nome: data.nome,
        conteudo: texto,
      }),
    );
    return r;
  });

export const gerarPerfilDoSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const url = normalizarUrl(data.site);
    if (!url) {
      return { ok: false as const, erro: "Endereço de site inválido. Confira e tente novamente." };
    }

    const html = await baixar(url);
    if (!html) {
      return {
        ok: false as const,
        erro: "Não foi possível ler o site. Preencha o perfil manualmente ou tente outro endereço.",
      };
    }

    let texto = extrairTexto(html);
    for (const extra of linksSobre(html, url)) {
      if (texto.length >= LIMITE_TEXTO) break;
      const h = await baixar(extra, 8000);
      if (h) texto += `\n\n${extrairTexto(h)}`;
    }
    texto = texto.slice(0, LIMITE_TEXTO);

    if (texto.replace(/\s/g, "").length < 200) {
      return {
        ok: false as const,
        erro: "O site foi acessado, mas não tem texto suficiente para gerar o perfil. Preencha manualmente.",
      };
    }

    const alvo = data.tipo === "escritorio" ? "escritório contábil" : "empresa";
    const r = await chamarIa(
      montarPrompt({
        alvo,
        origem: `o conteúdo textual extraído do site ${url}`,
        nome: data.nome,
        conteudo: texto,
      }),
    );
    if (!r.ok) return r;
    return { ...r, fonte: url };
  });
