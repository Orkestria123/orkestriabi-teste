// Textos do Relatório Executivo escritos pela Perplexity (Agent API,
// sem ferramentas de busca → usa só os números enviados). Fallback: Lovable AI.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CHAVES = ["escritorio", "empresa", "resumo", "dre", "bp", "custos", "dfc", "caixa", "patrimonio", "indicadores", "faturamento", "notas", "conclusoes"] as const;

const SISTEMA = `Você é um contador e controller brasileiro com mais de 20 anos de experiência, redigindo o relatório executivo mensal apresentado ao empresário.
Linguagem formal, impessoal, sóbria, técnica porém acessível. Use APENAS os números fornecidos; nunca invente fatos, políticas contábeis, contingências ou dados ausentes (diga "não disponível" quando faltar). Valores em reais no padrão pt-BR. Sem markdown, sem emojis, sem listas com marcadores; parágrafos corridos.`;

function promptUsuario(d: { empresa: string; escritorio: string; perfilEmpresa: string; perfilEscritorio: string; numeros: string }) {
  return `Escritório: ${d.escritorio}
Perfil do escritório: ${d.perfilEscritorio || "não informado"}
Empresa: ${d.empresa}
Perfil da empresa: ${d.perfilEmpresa || "não informado"}

Números do BI:
${d.numeros}

Responda SOMENTE com um objeto JSON válido com as chaves: ${CHAVES.join(", ")}.
- escritorio: 1 parágrafo apresentando o escritório como responsável pela apresentação dos resultados.
- empresa: 1 a 2 parágrafos sobre a empresa, a partir do perfil.
- resumo: 2 parágrafos com os principais resultados do mês e comparação com o mês anterior.
- dre, bp, dfc: 1 a 2 parágrafos de análise de cada demonstração, com mês anterior e acumulado quando disponíveis.
- custos: 1 parágrafo analisando composição de custos e despesas. Custo de materiais é componente do CPV, não somar novamente.
- caixa: 1 parágrafo conciliando caixa inicial, FCO, FCI, FCF e caixa final. Destacar a contribuição da variação de fornecedores, que não é faturamento.
- patrimonio: 1 parágrafo sobre evolução do PL; não atribuir natureza a movimentos não documentados nem afirmar DMPL completa.
- indicadores: 1 a 2 parágrafos interpretando liquidez, margens, endividamento e rentabilidade.
- faturamento: 1 parágrafo sobre a evolução dos últimos 12 meses (meses sem dados não são zero).
- notas: exatamente 16 notas, separadas por \\n, no formato "Nota N — Título: texto". Use 45 a 65 palavras por nota. Temas em ordem: contexto operacional; base de preparação; caixa e aplicações; clientes e estoques; imobilizado e intangível; fornecedores; obrigações bancárias e demais passivos; tributos e capital de giro; patrimônio líquido; receita e deduções; custos e despesas; lucro e EBITDA; DFC indireta; conciliação de caixa; políticas/contingências não informadas; completude e revisão técnica. Incluir números pertinentes disponíveis. Nunca afirmar políticas não cadastradas.
- conclusoes: 4 tópicos no formato "01 · Título: texto", um por parágrafo, com recomendações prudentes. EBITDA não é caixa disponível. Dívida bancária líquida negativa não elimina risco de liquidez. Não criar ratings universais.`;
}

function extrairJson(txt: string): Record<string, string> | null {
  const i = txt.indexOf("{"), j = txt.lastIndexOf("}");
  if (i < 0 || j < i) return null;
  try {
    const o = JSON.parse(txt.slice(i, j + 1));
    const out: Record<string, string> = {};
    for (const k of CHAVES) if (typeof o[k] === "string") out[k] = o[k].trim();
    return out;
  } catch { return null; }
}

async function viaPerplexity(prompt: string): Promise<{ texto: string | null; erro?: string }> {
  const key = process.env.PERPLEXITY_KEY ?? process.env.PERPLEXITY_API_KEY;
  if (!key) return { texto: null, erro: "sem chave" };
  const res = await fetch("https://api.perplexity.ai/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "perplexity/sonar", instructions: SISTEMA, input: prompt }),
  });
  if (!res.ok) {
    const b = await res.text().catch(() => "");
    console.error("[relatorio-ia] perplexity", res.status, b.slice(0, 300));
    return { texto: null, erro: `Perplexity ${res.status}` };
  }
  const j = (await res.json()) as any;
  const texto = (j?.output ?? []).flatMap((o: any) => o?.content ?? []).map((c: any) => c?.text ?? "").join("");
  return { texto: texto || null };
}

async function viaLovable(prompt: string): Promise<string | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: [{ role: "system", content: SISTEMA }, { role: "user", content: prompt }] }),
  });
  if (!res.ok) { console.error("[relatorio-ia] lovable", res.status); return null; }
  const j = (await res.json()) as any;
  return j?.choices?.[0]?.message?.content ?? null;
}

export const gerarTextosRelatorio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    empresa: z.string().max(300), escritorio: z.string().max(300),
    perfilEmpresa: z.string().max(6000).default(""), perfilEscritorio: z.string().max(6000).default(""),
    numeros: z.string().max(30000),
  }).parse(i))
  .handler(async ({ data }) => {
    const prompt = promptUsuario(data);
    let p = await viaPerplexity(prompt).catch((e) => {
      console.error("[relatorio-ia] perplexity exceção", String(e?.message ?? e));
      return { texto: null, erro: String(e?.message ?? e) };
    });
    let textos = p.texto ? extrairJson(p.texto) : null;
    if (p.texto && !textos) {
      console.error("[relatorio-ia] perplexity sem JSON válido:", "len=" + p.texto.length, "tail=", p.texto.slice(-200));
      // Resposta possivelmente truncada: tenta uma segunda vez.
      p = await viaPerplexity(prompt).catch(() => ({ texto: null }));
      textos = p.texto ? extrairJson(p.texto) : null;
    }
    let fonte = "Perplexity";
    if (!textos) {
      const l = await viaLovable(prompt).catch(() => null);
      textos = l ? extrairJson(l) : null;
      fonte = "IA alternativa";
    }
    if (!textos) return { ok: false as const, erro: "Não foi possível gerar os textos agora. Tente novamente em instantes." };
    return { ok: true as const, textos, fonte };
  });
