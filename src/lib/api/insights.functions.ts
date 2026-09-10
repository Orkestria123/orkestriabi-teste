import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface InsightPayload {
  company: { name: string };
  periods: string[];
  rows: Array<{ descricao: string; values: Record<string, number> }>;
}

function brl(v: number) {
  const a = Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return v < 0 ? `-R$ ${a}` : `R$ ${a}`;
}

/**
 * Gera insights automáticos a partir do DRE da empresa selecionada.
 * Usa o Lovable AI Gateway (LOVABLE_API_KEY).
 */
export const generateFinancialInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        companyId: z.string().uuid(),
        periodos: z.array(z.string()).min(1),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    // Fetch company
    const { data: company } = await supabase
      .from("companies")
      .select("name, razao_social")
      .eq("id", data.companyId)
      .maybeSingle();
    if (!company) throw new Error("Empresa não encontrada");

    const years = data.periodos
      .map((p) => Number(p.slice(0, 4)))
      .filter((n) => !isNaN(n));
    const minYear = years.length ? Math.min(...years) : 1900;
    const maxYear = years.length ? Math.max(...years) : 2999;

    const { data: dre, error } = await supabase
      .from("financial_statements")
      .select("descricao, periodo, valor, linha_ordem, is_subtotal")
      .eq("company_id", data.companyId)
      .eq("tipo_demonstracao", "DRE")
      .gte("periodo", `${minYear}-01-01`)
      .lte("periodo", `${maxYear}-12-31`);
    if (error) throw new Error(error.message);

    // Pivot into rows -> values by period
    const byRow = new Map<string, { descricao: string; values: Record<string, number>; ordem: number }>();
    const periodSet = new Set<string>();
    for (const r of dre ?? []) {
      const k = r.descricao;
      const periodo = r.periodo as string | null;
      if (!k || !periodo) continue;
      periodSet.add(periodo);
      if (!byRow.has(k)) byRow.set(k, { descricao: k, values: {}, ordem: r.linha_ordem ?? 0 });
      byRow.get(k)!.values[periodo] = Number(r.valor) || 0;
    }
    const periods = Array.from(periodSet).sort();
    const rows = Array.from(byRow.values()).sort((a, b) => a.ordem - b.ordem);

    if (rows.length === 0 || periods.length === 0) {
      return { ok: true, insights: "Sem dados suficientes para gerar análise nos períodos selecionados." };
    }

    // Build compact snapshot for the model
    const snapshot: InsightPayload = {
      company: { name: company.razao_social ?? company.name },
      periods,
      rows: rows.map((r) => ({ descricao: r.descricao, values: r.values })),
    };

    // Compose a deterministic textual summary as fallback + prompt to LLM
    const last = periods[periods.length - 1];
    const prev = periods[periods.length - 2];
    const linesPlain = rows
      .map((r) => {
        const v = r.values[last] ?? 0;
        const p = prev ? r.values[prev] ?? 0 : 0;
        const delta = prev && p !== 0 ? ((v - p) / Math.abs(p)) * 100 : null;
        return `${r.descricao}: ${brl(v)}${delta != null ? ` (${delta > 0 ? "+" : ""}${delta.toFixed(2)}% vs período anterior)` : ""}`;
      })
      .join("\n");

    const prompt = `Você é um analista financeiro contábil sênior. Analise a DRE abaixo e gere 3 a 5 insights objetivos em português brasileiro, voltados a um gestor não-técnico. Para cada insight: comece com um emoji indicador (📈 alta, 📉 queda, ⚠️ alerta, ✅ positivo, 💡 oportunidade), seja específico com números e percentuais, e cite a conta envolvida. Não invente dados — use apenas os valores fornecidos. Seja conciso (1-2 frases por insight). Não use markdown, apenas texto corrido com quebras de linha entre os insights.

Empresa: ${snapshot.company.name}
Períodos analisados: ${periods.join(", ")}

DRE consolidada (período mais recente vs anterior):
${linesPlain}`;

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return {
        ok: true,
        insights:
          "💡 Configure a chave LOVABLE_API_KEY para habilitar análise por IA.\n\nResumo automático:\n" +
          linesPlain.split("\n").slice(0, 5).join("\n"),
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
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "Você é um analista financeiro contábil brasileiro objetivo." },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        console.error("[insights] AI gateway error", res.status, txt);
        return {
          ok: true,
          insights: "⚠️ Não foi possível gerar a análise por IA no momento.\n\n" + linesPlain.split("\n").slice(0, 5).join("\n"),
        };
      }
      const json = (await res.json()) as any;
      const text = json?.choices?.[0]?.message?.content ?? "";
      return { ok: true, insights: text || linesPlain };
    } catch (e) {
      console.error("[insights] fetch failed", e);
      return {
        ok: true,
        insights: "⚠️ Falha ao contatar o serviço de IA.\n\n" + linesPlain.split("\n").slice(0, 5).join("\n"),
      };
    }
  });

/**
 * Dashboard consolidado para tenant_admin: KPIs agregados de todas as empresas
 * do tenant no período mais recente disponível.
 */
export const getConsolidatedDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;

    const { data: companies, error: cErr } = await supabase
      .from("companies")
      .select("id, name, razao_social, cnpj")
      .eq("ativo", true);
    if (cErr) throw new Error(cErr.message);
    if (!companies || companies.length === 0) {
      return { companies: [], totals: null };
    }

    const ids = companies.map((c) => c.id);
    const { data: rows, error: rErr } = await supabase
      .from("financial_statements")
      .select("company_id, tipo_demonstracao, descricao, periodo, valor")
      .in("company_id", ids)
      .eq("tipo_demonstracao", "DRE");
    if (rErr) throw new Error(rErr.message);

    const findVal = (
      list: typeof rows,
      companyId: string,
      periodo: string,
      kws: string[],
    ): number | null => {
      const r = (list ?? []).find(
        (x) =>
          x.company_id === companyId &&
          x.periodo === periodo &&
          kws.some((k) => (x.descricao ?? "").toLowerCase().includes(k)),
      );
      return r ? Number(r.valor) || 0 : null;
    };

    // For each company, pick latest two periods that exist in its DRE
    const perCompany = companies.map((c) => {
      const periods = Array.from(
        new Set(
          (rows ?? [])
            .filter((r) => r.company_id === c.id)
            .map((r) => r.periodo as string),
        ),
      ).sort();
      const last = periods[periods.length - 1] ?? null;
      const prev = periods[periods.length - 2] ?? null;
      const receita = last ? findVal(rows, c.id, last, ["receita líquida", "receita liquida", "receita bruta"]) : null;
      const receitaPrev = prev ? findVal(rows, c.id, prev, ["receita líquida", "receita liquida", "receita bruta"]) : null;
      const lucro = last ? findVal(rows, c.id, last, ["lucro líquido", "lucro liquido", "resultado líquido"]) : null;
      const ebitda = last ? findVal(rows, c.id, last, ["ebitda", "lajida"]) : null;
      const margem = receita && receita !== 0 && lucro != null ? (lucro / receita) * 100 : null;
      const variacaoReceita =
        receita != null && receitaPrev != null && receitaPrev !== 0
          ? ((receita - receitaPrev) / Math.abs(receitaPrev)) * 100
          : null;
      return {
        id: c.id,
        name: c.razao_social ?? c.name,
        cnpj: c.cnpj,
        ultimo_periodo: last,
        receita,
        lucro,
        ebitda,
        margem,
        variacao_receita: variacaoReceita,
      };
    });

    const totals = perCompany.reduce(
      (acc, c) => {
        acc.receita += c.receita ?? 0;
        acc.lucro += c.lucro ?? 0;
        acc.ebitda += c.ebitda ?? 0;
        if (c.lucro != null && c.lucro < 0) acc.empresas_deficit += 1;
        if (c.lucro != null && c.lucro > 0) acc.empresas_lucro += 1;
        return acc;
      },
      { receita: 0, lucro: 0, ebitda: 0, empresas_lucro: 0, empresas_deficit: 0 },
    );

    return { companies: perCompany, totals };
  });
