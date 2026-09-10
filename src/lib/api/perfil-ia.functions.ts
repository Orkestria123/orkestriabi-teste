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

// ---------------------------------------------------------------------------
// Captura de LOGO e FOTO a partir do site. É uma conveniência: devolve
// sugestões (imagem em base64) que o admin confirma ou troca por upload.
// ---------------------------------------------------------------------------

const ImagensSchema = z.object({ site: z.string().min(3) });

const LIMITE_IMAGEM = 3 * 1024 * 1024;

function absoluto(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function atributos(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z:-]+)\s*=\s*["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[2];
  return out;
}

function pontuarFormato(url: string): number {
  const u = url.toLowerCase();
  if (u.includes(".svg")) return 3;
  if (u.includes(".png") || u.includes(".webp")) return 2;
  if (u.includes(".jpg") || u.includes(".jpeg")) return 1;
  return 0;
}

/** Candidatas a logo, da mais provável para a menos. */
function candidatasLogo(html: string, base: string): string[] {
  const cands: { url: string; peso: number }[] = [];
  const push = (href: string | undefined, peso: number) => {
    if (!href) return;
    const abs = absoluto(href, base);
    if (abs) cands.push({ url: abs, peso: peso + pontuarFormato(abs) });
  };

  for (const m of html.matchAll(/<link[^>]+>/gi)) {
    const a = atributos(m[0]);
    const rel = (a["rel"] ?? "").toLowerCase();
    if (!rel.includes("icon")) continue;
    const tamanho = Number((a["sizes"] ?? "").split("x")[0]) || 0;
    push(a["href"], rel.includes("apple-touch") ? 14 : 10 + Math.min(tamanho / 64, 6));
  }

  for (const m of html.matchAll(/<img[^>]+>/gi)) {
    const a = atributos(m[0]);
    const alvo = `${a["src"] ?? ""} ${a["alt"] ?? ""} ${a["class"] ?? ""} ${a["id"] ?? ""}`.toLowerCase();
    if (/logo|brand|marca/.test(alvo)) push(a["src"], 20);
  }

  push(absoluto("/favicon.ico", base) ?? undefined, 1);

  const vistos = new Set<string>();
  return cands
    .sort((a, b) => b.peso - a.peso)
    .map((c) => c.url)
    .filter((u) => (vistos.has(u) ? false : (vistos.add(u), true)))
    .slice(0, 6);
}

/** Candidatas a foto de capa: og:image primeiro, depois imagens de conteúdo. */
function candidatasFoto(html: string, base: string): string[] {
  const cands: { url: string; peso: number }[] = [];
  const push = (href: string | undefined, peso: number) => {
    if (!href) return;
    const abs = absoluto(href, base);
    if (abs) cands.push({ url: abs, peso });
  };

  for (const m of html.matchAll(/<meta[^>]+>/gi)) {
    const a = atributos(m[0]);
    const chave = (a["property"] ?? a["name"] ?? "").toLowerCase();
    if (chave === "og:image" || chave === "og:image:secure_url") push(a["content"], 30);
    if (chave === "twitter:image") push(a["content"], 25);
  }

  for (const m of html.matchAll(/<img[^>]+>/gi)) {
    const a = atributos(m[0]);
    const alvo = `${a["src"] ?? ""} ${a["alt"] ?? ""} ${a["class"] ?? ""}`.toLowerCase();
    if (/logo|icon|sprite|avatar|pixel|banner-ads/.test(alvo)) continue;
    const largura = Number(a["width"]) || 0;
    push(a["src"], 5 + Math.min(largura / 200, 10));
  }

  const vistos = new Set<string>();
  return cands
    .sort((a, b) => b.peso - a.peso)
    .map((c) => c.url)
    .filter((u) => (vistos.has(u) ? false : (vistos.add(u), true)))
    .slice(0, 6);
}

async function baixarImagem(url: string): Promise<{ dataUrl: string; origem: string } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OrkestriaBI/1.0; +perfil)" },
    });
    if (!res.ok) return null;
    const tipo = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!tipo.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > LIMITE_IMAGEM) return null;
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return { dataUrl: `data:${tipo};base64,${btoa(bin)}`, origem: url };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function primeiraQueBaixa(urls: string[]) {
  for (const u of urls) {
    const r = await baixarImagem(u);
    if (r) return r;
  }
  return null;
}

export const capturarImagensDoSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ImagensSchema.parse(input))
  .handler(async ({ data }) => {
    const url = normalizarUrl(data.site);
    if (!url) return { ok: false as const, erro: "Endereço de site inválido. Confira e tente novamente." };

    const html = await baixar(url);
    if (!html) {
      return { ok: false as const, erro: "Não foi possível ler o site. Envie as imagens manualmente." };
    }

    const [logo, foto] = await Promise.all([
      primeiraQueBaixa(candidatasLogo(html, url)),
      primeiraQueBaixa(candidatasFoto(html, url)),
    ]);

    if (!logo && !foto) {
      return { ok: false as const, erro: "Nenhuma imagem utilizável foi encontrada no site. Envie manualmente." };
    }
    return { ok: true as const, logo, foto };
  });
