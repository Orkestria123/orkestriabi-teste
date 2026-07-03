// Catálogo de "linhas de demonstração" que podem ser usadas como termos
// de uma fórmula de indicador. Resolvidos usando as MESMAS convenções
// da DRE / Balanço, garantindo consistência entre indicador e demonstração.

import { descendeDe, grupoDe, nivelDe } from "@/lib/mascara/interpretar";
import {
  valorConta,
  valorContaAnalitica,
  type EngineContext,
} from "./engine";

export type LinhaOrigem = "DRE" | "BP";

export interface LinhaCatalogo {
  key: string;
  label: string;
  origem: LinhaOrigem;
  descricao?: string;
}

export const LINHAS_CATALOGO: LinhaCatalogo[] = [
  // DRE ------------------------------------------------------
  { key: "RECEITA_BRUTA", label: "Receita Bruta", origem: "DRE" },
  { key: "DEDUCOES", label: "Deduções da Receita Bruta", origem: "DRE" },
  { key: "RECEITA_LIQUIDA", label: "Receita Líquida", origem: "DRE" },
  { key: "CUSTOS", label: "Custos (CMV/CPV/CSV)", origem: "DRE" },
  { key: "LUCRO_BRUTO", label: "Lucro Bruto", origem: "DRE" },
  { key: "DESPESAS_OPERACIONAIS", label: "Despesas Operacionais", origem: "DRE" },
  { key: "DESPESAS_ADMINISTRATIVAS", label: "Despesas Administrativas", origem: "DRE" },
  { key: "DESPESAS_COMERCIAIS", label: "Despesas Comerciais", origem: "DRE" },
  { key: "EBIT", label: "Resultado Operacional (EBIT)", origem: "DRE" },
  { key: "EBITDA", label: "EBITDA", origem: "DRE" },
  { key: "RECEITAS_FINANCEIRAS", label: "Receitas Financeiras", origem: "DRE" },
  { key: "DESPESAS_FINANCEIRAS", label: "Despesas Financeiras", origem: "DRE" },
  { key: "RESULTADO_ANTES_IR", label: "Resultado antes do IR/CSLL", origem: "DRE" },
  { key: "IRPJ_CSLL", label: "IRPJ + CSLL", origem: "DRE" },
  { key: "LUCRO_LIQUIDO", label: "Lucro Líquido", origem: "DRE" },
  // BP -------------------------------------------------------
  { key: "ATIVO_TOTAL", label: "Ativo Total", origem: "BP" },
  { key: "ATIVO_CIRCULANTE", label: "Ativo Circulante", origem: "BP" },
  { key: "ATIVO_NAO_CIRCULANTE", label: "Ativo Não Circulante", origem: "BP" },
  { key: "DISPONIVEL", label: "Disponível / Caixa e Equivalentes", origem: "BP" },
  { key: "CONTAS_A_RECEBER", label: "Contas a Receber (Clientes)", origem: "BP" },
  { key: "ESTOQUES", label: "Estoques", origem: "BP" },
  { key: "IMOBILIZADO", label: "Imobilizado", origem: "BP" },
  { key: "PASSIVO_TOTAL_E_PL", label: "Passivo + Patrimônio Líquido (Total)", origem: "BP" },
  { key: "PASSIVO_CIRCULANTE", label: "Passivo Circulante", origem: "BP" },
  { key: "PASSIVO_NAO_CIRCULANTE", label: "Passivo Não Circulante", origem: "BP" },
  { key: "PATRIMONIO_LIQUIDO", label: "Patrimônio Líquido", origem: "BP" },
  { key: "FORNECEDORES", label: "Fornecedores", origem: "BP" },
  { key: "EMPRESTIMOS", label: "Empréstimos e Financiamentos", origem: "BP" },
];

export function labelLinha(key: string): string {
  return LINHAS_CATALOGO.find((l) => l.key === key)?.label ?? key;
}

// ------------------------------------------------------------
// DemoDre: valores da DRE por período (vindos de buildDRE).
// key = "descricao|periodo" → valor.
// ------------------------------------------------------------

export type DemoDre = Map<string, number>;

export const keyDre = (desc: string, periodo: string) => `${desc}|${periodo}`;

function dreVal(demo: DemoDre | undefined, desc: string, periodo: string): number {
  if (!demo) return 0;
  return demo.get(keyDre(desc, periodo)) ?? 0;
}

function dreHas(demo: DemoDre | undefined, desc: string, periodo: string): boolean {
  if (!demo) return false;
  return demo.has(keyDre(desc, periodo));
}

// ------------------------------------------------------------
// Helpers para BP (via engine sobre saldos_mensais).
// ------------------------------------------------------------

function findPrefixByDesc(
  ctx: EngineContext,
  regex: RegExp,
  grupos: string[],
): string[] {
  const candidatos = ctx.plano.filter((p) => {
    if (p.is_participante) return false;
    const g = grupoDe(p.classificacao, ctx.mascara);
    if (!grupos.includes(g)) return false;
    return regex.test(p.descricao);
  });
  // Preferir os mais próximos da raiz (menos segmentos).
  candidatos.sort(
    (a, b) => nivelDe(a.classificacao, ctx.mascara) - nivelDe(b.classificacao, ctx.mascara),
  );
  // Deduplica descendentes: se já incluí "1.01.02", descarta "1.01.02.03".
  const out: string[] = [];
  for (const c of candidatos) {
    const cls = c.classificacao;
    if (out.some((base) => descendeDe(cls, base, ctx.mascara))) continue;
    out.push(cls);
  }
  return out;
}

function sumPrefixes(ctx: EngineContext, periodo: string, prefixos: string[]): number {
  let total = 0;
  for (const pref of prefixos) total += valorConta(pref, periodo, ctx);
  return total;
}

function sumByGrupo(ctx: EngineContext, periodo: string, grupos: string[]): number {
  let total = 0;
  for (const p of ctx.plano) {
    if (p.is_sintetica) continue;
    if (p.is_participante) {
      // participantes: contam para clientes/fornecedores (ativo circulante / passivo circulante)
      // apenas se dentro do grupo pedido.
    }
    const g = grupoDe(p.classificacao, ctx.mascara);
    if (!grupos.includes(g)) continue;
    total += valorContaAnalitica(p.classificacao, periodo, ctx);
  }
  return total;
}

function sumPrefixesFromRoot(
  ctx: EngineContext,
  periodo: string,
  raizes: string[],
): number {
  // Soma todas as analíticas cuja classificação descende de alguma das raízes.
  let total = 0;
  for (const p of ctx.plano) {
    if (p.is_sintetica) continue;
    if (!raizes.some((r) => descendeDe(p.classificacao, r, ctx.mascara))) continue;
    total += valorContaAnalitica(p.classificacao, periodo, ctx);
  }
  return total;
}

// Resultado acumulado do exercício até o período (Σ movimento contas grupo 3,
// do início do ano até a competência, na natureza credora → lucro positivo).
function resultadoExercicioAte(ctx: EngineContext, periodo: string): number {
  const inicio = `${periodo.slice(0, 4)}-01`;
  let total = 0;
  for (const p of ctx.plano) {
    if (p.is_sintetica) continue;
    const g = grupoDe(p.classificacao, ctx.mascara);
    if (g !== "receita" && g !== "despesa" && g !== "resultado") continue;
    const saldos = ctx.saldosByClass.get(p.classificacao);
    if (!saldos) continue;
    const naturezaRaw = (p.natureza ?? "").toUpperCase();
    const natureza: "C" | "D" =
      naturezaRaw === "C" || naturezaRaw === "D"
        ? (naturezaRaw as "C" | "D")
        : g === "despesa"
        ? "D"
        : "C";
    for (const [comp, s] of saldos) {
      if (comp < inicio || comp > periodo) continue;
      total += natureza === "C"
        ? Number(s.total_creditos) - Number(s.total_debitos)
        : Number(s.total_debitos) - Number(s.total_creditos);
    }
  }
  return total;
}

// ------------------------------------------------------------
// Resolver
// ------------------------------------------------------------

/**
 * Devolve o valor da linha catalogada para o período.
 * Para linhas DRE, usa preferencialmente o mesmo motor que monta a DRE
 * (via `demoDre`); se ausente, retorna null.
 * Para linhas BP, computa direto sobre `ctx` (abertura + Σ movimento).
 */
export function resolverLinha(
  key: string,
  periodo: string,
  ctx: EngineContext,
  demoDre: DemoDre | undefined,
): number | null {
  switch (key) {
    // ---------------- DRE ----------------
    case "RECEITA_BRUTA":
      return dreHas(demoDre, "Receita Bruta", periodo) ? dreVal(demoDre, "Receita Bruta", periodo) : null;
    case "DEDUCOES":
      return dreVal(demoDre, "(-) Deduções da Receita Bruta", periodo);
    case "RECEITA_LIQUIDA":
      return dreHas(demoDre, "(=) Receita Líquida", periodo)
        ? dreVal(demoDre, "(=) Receita Líquida", periodo)
        : null;
    case "CUSTOS": {
      if (!demoDre) return null;
      let s = 0;
      for (const [k, v] of demoDre) {
        const [desc, p] = k.split("|");
        if (p !== periodo) continue;
        if (/^\(-\)\s*Custos?\b/i.test(desc)) s += v;
      }
      return s;
    }
    case "LUCRO_BRUTO":
      return dreHas(demoDre, "(=) Lucro Bruto", periodo)
        ? dreVal(demoDre, "(=) Lucro Bruto", periodo)
        : null;
    case "DESPESAS_OPERACIONAIS": {
      if (!demoDre) return null;
      let s = 0;
      for (const [k, v] of demoDre) {
        const [desc, p] = k.split("|");
        if (p !== periodo) continue;
        if (/^\(-\)\s*Despesas\b/i.test(desc) && !/Financeiras/i.test(desc)) s += v;
      }
      return s;
    }
    case "DESPESAS_ADMINISTRATIVAS":
      return dreHas(demoDre, "(-) Despesas Administrativas", periodo)
        ? dreVal(demoDre, "(-) Despesas Administrativas", periodo)
        : null;
    case "DESPESAS_COMERCIAIS":
      return dreHas(demoDre, "(-) Despesas Comerciais", periodo)
        ? dreVal(demoDre, "(-) Despesas Comerciais", periodo)
        : null;
    case "RECEITAS_FINANCEIRAS":
      return dreVal(demoDre, "(+) Receitas Financeiras", periodo);
    case "DESPESAS_FINANCEIRAS":
      return dreVal(demoDre, "(-) Despesas Financeiras", periodo);
    case "EBIT":
      return dreHas(demoDre, "(=) Resultado Operacional (EBIT)", periodo)
        ? dreVal(demoDre, "(=) Resultado Operacional (EBIT)", periodo)
        : null;
    case "EBITDA": {
      if (!demoDre) return null;
      const ebit = dreVal(demoDre, "(=) Resultado Operacional (EBIT)", periodo);
      let dep = 0;
      for (const [k, v] of demoDre) {
        const [desc, p] = k.split("|");
        if (p !== periodo) continue;
        if (/deprec|amortiz|exaust/i.test(desc)) dep += v;
      }
      return ebit + dep;
    }
    case "RESULTADO_ANTES_IR":
      return dreHas(demoDre, "(=) Resultado Antes do IR/CSLL", periodo)
        ? dreVal(demoDre, "(=) Resultado Antes do IR/CSLL", periodo)
        : null;
    case "IRPJ_CSLL":
      return dreVal(demoDre, "(-) IRPJ", periodo) + dreVal(demoDre, "(-) CSLL", periodo);
    case "LUCRO_LIQUIDO":
      return dreHas(demoDre, "(=) Lucro Líquido do Exercício", periodo)
        ? dreVal(demoDre, "(=) Lucro Líquido do Exercício", periodo)
        : null;

    // ---------------- BP ----------------
    case "ATIVO_TOTAL":
      return sumByGrupo(ctx, periodo, ["ativo"]);
    case "ATIVO_CIRCULANTE":
      return sumPrefixesFromRoot(ctx, periodo, ["1.01"]);
    case "ATIVO_NAO_CIRCULANTE":
      return sumPrefixesFromRoot(ctx, periodo, ["1.02", "1.03"]);
    case "DISPONIVEL":
      return sumPrefixesFromRoot(ctx, periodo, ["1.01.01"]);
    case "IMOBILIZADO":
      return sumPrefixesFromRoot(ctx, periodo, ["1.03"]);
    case "CONTAS_A_RECEBER": {
      const pref = findPrefixByDesc(ctx, /clientes|receber|duplic/i, ["ativo"]);
      if (pref.length === 0) return sumPrefixesFromRoot(ctx, periodo, ["1.01.02"]);
      return sumPrefixes(ctx, periodo, pref);
    }
    case "ESTOQUES": {
      const pref = findPrefixByDesc(ctx, /estoq/i, ["ativo"]);
      return sumPrefixes(ctx, periodo, pref);
    }
    case "PASSIVO_TOTAL_E_PL":
      return sumByGrupo(ctx, periodo, ["passivo", "pl"]) + resultadoExercicioAte(ctx, periodo);
    case "PASSIVO_CIRCULANTE":
      return sumPrefixesFromRoot(ctx, periodo, ["2.01"]);
    case "PASSIVO_NAO_CIRCULANTE":
      return sumPrefixesFromRoot(ctx, periodo, ["2.02"]);
    case "PATRIMONIO_LIQUIDO":
      return sumPrefixesFromRoot(ctx, periodo, ["2.03", "2.04", "2.05"]) + resultadoExercicioAte(ctx, periodo);
    case "FORNECEDORES": {
      const pref = findPrefixByDesc(ctx, /fornec/i, ["passivo", "pl"]);
      return sumPrefixes(ctx, periodo, pref);
    }
    case "EMPRESTIMOS": {
      const pref = findPrefixByDesc(ctx, /emprest|financiament/i, ["passivo", "pl"]);
      return sumPrefixes(ctx, periodo, pref);
    }
    default:
      return null;
  }
}
