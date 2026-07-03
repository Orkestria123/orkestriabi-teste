// Gera análise em linguagem clara para um indicador calculado.
// Usa o Lovable AI Gateway (LOVABLE_API_KEY). Sem autenticação de contexto
// (o payload já contém apenas números derivados que o cliente possui).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  nome: z.string(),
  categoria: z.string().optional().default(""),
  formulaTexto: z.string().optional().default(""),
  modo: z.enum(["numero", "reais", "percentual", "ah_percent", "ah_valor"]),
  faixa: z.enum(["otimo", "bom", "atencao", "critico", "neutro"]),
  serie: z
    .array(z.object({ periodo: z.string(), valor: z.number().nullable() }))
    .min(1),
});

function fmt(v: number | null, modo: string): string {
  if (v == null || !isFinite(v)) return "—";
  const n = (x: number, d = 2) =>
    x.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (modo === "reais" || modo === "ah_valor")
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (modo === "percentual" || modo === "ah_percent") return `${n(v, 1)}%`;
  return n(v, 2);
}

const FAIXA_LABEL: Record<string, string> = {
  otimo: "ótimo",
  bom: "bom",
  atencao: "em atenção",
  critico: "crítico",
  neutro: "sem faixa configurada",
};

export const explicarIndicador = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const validos = data.serie.filter((p) => p.valor != null && isFinite(p.valor!)) as Array<{
      periodo: string;
      valor: number;
    }>;
    if (validos.length === 0) {
      return { texto: "Sem dados suficientes para gerar a análise deste indicador." };
    }

    const primeiro = validos[0];
    const ultimo = validos[validos.length - 1];
    const tendencia =
      validos.length < 2
        ? "único período"
        : ultimo.valor > primeiro.valor * 1.02
        ? "melhorando ao longo do período"
        : ultimo.valor < primeiro.valor * 0.98
        ? "piorando ao longo do período"
        : "estável ao longo do período";

    const serieTexto = validos
      .map((p) => `${p.periodo.slice(0, 7)}=${fmt(p.valor, data.modo)}`)
      .join(", ");

    const prompt = `Você é um consultor financeiro explicando indicadores para o dono de uma pequena/média empresa brasileira.

Indicador: ${data.nome}${data.categoria ? ` (${data.categoria})` : ""}
Fórmula: ${data.formulaTexto || "—"}
Valor mais recente (${ultimo.periodo.slice(0, 7)}): ${fmt(ultimo.valor, data.modo)}
Série: ${serieTexto}
Tendência: ${tendencia}
Faixa de saúde: ${FAIXA_LABEL[data.faixa]}

Escreva 1 a 2 frases CURTAS em português brasileiro, linguagem simples de empresário (sem jargão contábil pesado), explicando o que esse número representa NA PRÁTICA para o negócio e citando a tendência quando fizer sentido. Não use markdown, não use emojis, não repita o nome do indicador no começo. Vá direto ao ponto.`;

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return {
        texto: `Valor de ${fmt(ultimo.valor, data.modo)} em ${ultimo.periodo.slice(0, 7)} (${tendencia}).`,
      };
    }

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content:
                "Você é um consultor financeiro brasileiro que explica indicadores em linguagem simples e direta.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.error("[indicador-explicacao] gateway", res.status, txt);
        return {
          texto: `Valor de ${fmt(ultimo.valor, data.modo)} em ${ultimo.periodo.slice(0, 7)} (${tendencia}).`,
        };
      }
      const json = (await res.json()) as any;
      const texto = (json?.choices?.[0]?.message?.content ?? "").trim();
      return {
        texto:
          texto ||
          `Valor de ${fmt(ultimo.valor, data.modo)} em ${ultimo.periodo.slice(0, 7)} (${tendencia}).`,
      };
    } catch (e) {
      console.error("[indicador-explicacao] fetch", e);
      return {
        texto: `Valor de ${fmt(ultimo.valor, data.modo)} em ${ultimo.periodo.slice(0, 7)} (${tendencia}).`,
      };
    }
  });
