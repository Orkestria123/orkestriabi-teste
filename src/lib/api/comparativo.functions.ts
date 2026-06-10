import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const KW = {
  receita: ["receita líquida", "receita liquida", "receita bruta"],
  custo: ["custo dos produtos", "custo das mercadorias", "custo dos serviços", "custo dos servicos", "cmv", "cpv"],
  lucroBruto: ["lucro bruto", "resultado bruto"],
  despesasOp: ["despesas operacionais", "despesas administrativas", "despesas com vendas"],
  ebitda: ["ebitda", "lajida"],
  lucro: ["lucro líquido", "lucro liquido", "resultado líquido"],
};

function sumKw(rows: Array<{ descricao: string | null; valor: number | string | null }>, kws: string[]): number | null {
  const k = kws.map((s) => s.toLowerCase());
  const matched = rows.filter((r) => k.some((kw) => (r.descricao ?? "").toLowerCase().includes(kw)));
  if (matched.length === 0) return null;
  // Use the first match per descricao (avoids double counting subtotal variants); fallback to first match overall
  const seen = new Map<string, number>();
  matched.forEach((m) => {
    const key = (m.descricao ?? "").toLowerCase();
    if (!seen.has(key)) seen.set(key, Number(m.valor) || 0);
  });
  // Return the largest absolute value (typically the main subtotal line)
  return Array.from(seen.values()).reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
}

export const compareCompanies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        companyIds: z.array(z.string().uuid()).min(2).max(6),
        periodo: z.string().optional(), // YYYY-MM-DD; if absent uses each company's latest
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: companies, error: cErr } = await supabase
      .from("companies")
      .select("id, name, razao_social, cnpj")
      .in("id", data.companyIds);
    if (cErr) throw new Error(cErr.message);

    const { data: rows, error: rErr } = await supabase
      .from("financial_statements")
      .select("company_id, descricao, periodo, valor, tipo_demonstracao")
      .in("company_id", data.companyIds)
      .in("tipo_demonstracao", ["DRE", "BP"]);
    if (rErr) throw new Error(rErr.message);

    const result = (companies ?? []).map((c) => {
      const cRows = (rows ?? []).filter((r) => r.company_id === c.id);
      const periodos = Array.from(new Set(cRows.map((r) => r.periodo as string))).sort();
      const periodo = data.periodo && periodos.includes(data.periodo)
        ? data.periodo
        : periodos[periodos.length - 1];
      const prev = periodo ? periodos[periodos.indexOf(periodo) - 1] ?? null : null;

      const slice = (p: string | null, tipo: string) =>
        p ? cRows.filter((r) => r.periodo === p && r.tipo_demonstracao === tipo) : [];

      const dre = slice(periodo, "DRE");
      const dreP = slice(prev, "DRE");
      const bp = slice(periodo, "BP");

      const k = (rs: typeof dre, kws: string[]) => sumKw(rs, kws);

      const receita = k(dre, KW.receita);
      const receitaPrev = k(dreP, KW.receita);
      const lucro = k(dre, KW.lucro);
      const lucroPrev = k(dreP, KW.lucro);
      const ebitda = k(dre, KW.ebitda);
      const lucroBruto = k(dre, KW.lucroBruto);
      const ativoTotal = sumKw(bp, ["ativo total", "total do ativo"]);
      const patrimonio = sumKw(bp, ["patrimônio líquido", "patrimonio liquido"]);
      const passivoCirc = sumKw(bp, ["passivo circulante"]);
      const ativoCirc = sumKw(bp, ["ativo circulante"]);

      const pct = (a: number | null, b: number | null) =>
        a != null && b != null && b !== 0 ? (a / Math.abs(b)) * 100 : null;
      const variac = (a: number | null, b: number | null) =>
        a != null && b != null && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null;

      return {
        id: c.id,
        name: c.razao_social ?? c.name,
        cnpj: c.cnpj,
        periodo,
        prev,
        kpis: {
          receita,
          lucro,
          ebitda,
          lucroBruto,
          margemLiquida: pct(lucro, receita),
          margemBruta: pct(lucroBruto, receita),
          margemEbitda: pct(ebitda, receita),
          variacaoReceita: variac(receita, receitaPrev),
          variacaoLucro: variac(lucro, lucroPrev),
          ativoTotal,
          patrimonio,
          liquidezCorrente:
            ativoCirc != null && passivoCirc != null && passivoCirc !== 0
              ? ativoCirc / passivoCirc
              : null,
          endividamento:
            ativoTotal != null && patrimonio != null && ativoTotal !== 0
              ? ((ativoTotal - patrimonio) / ativoTotal) * 100
              : null,
        },
      };
    });

    return { companies: result };
  });
