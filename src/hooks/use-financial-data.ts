import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Company {
  id: string;
  name: string;
  cnpj: string | null;
  razao_social: string | null;
  regime_tributario: string | null;
  ativo: boolean;
}

// Nota: estes hooks não dependem mais do estado de carregamento da auth.
// O cliente anexa a sessão automaticamente e o RLS garante a segurança;
// se não houver sessão, as consultas simplesmente retornam vazio.
export function useMyCompanies() {
  return useQuery({
    queryKey: ["my-companies"],
    queryFn: async (): Promise<Company[]> => {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data as Company[]) ?? [];
    },
  });
}

export function useFinancialStatement(
  companyId: string | null,
  tipo: string,
  periodos: string[],
) {
  // Derive year range from selected periodos; if empty, fetch a wide range so
  // the table never gets stuck "empty" while the filter context warms up.
  const years = periodos.map((p) => Number(p.slice(0, 4))).filter((n) => !isNaN(n));
  const minYear = years.length > 0 ? Math.min(...years) : 1900;
  const maxYear = years.length > 0 ? Math.max(...years) : 2999;
  return useQuery({
    queryKey: ["fs", companyId, tipo, minYear, maxYear],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_statements")
        .select("*")
        .eq("company_id", companyId!)
        .eq("tipo_demonstracao", tipo)
        .gte("periodo", `${minYear}-01-01`)
        .lte("periodo", `${maxYear}-12-31`)
        .order("linha_ordem");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAvailablePeriods(companyId: string | null) {
  return useQuery({
    queryKey: ["available-periods", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      // Mescla períodos mensais (Bloco I — account_balances) e anuais (Bloco J — financial_statements).
      const [balRes, stmtRes] = await Promise.all([
        supabase.from("account_balances").select("periodo").eq("company_id", companyId!),
        supabase.from("financial_statements").select("periodo").eq("company_id", companyId!),
      ]);
      if (balRes.error) throw balRes.error;
      if (stmtRes.error) throw stmtRes.error;
      const set = new Set<string>();
      (balRes.data ?? []).forEach((r: any) => set.add(r.periodo));
      (stmtRes.data ?? []).forEach((r: any) => set.add(r.periodo));
      return Array.from(set).sort();
    },
  });
}

/**
 * Reconstrói DRE / BP mês a mês a partir de account_balances (Bloco I).
 * - Usa financial_statements (Bloco J) só como TEMPLATE estrutural.
 * - Folhas: soma as contas analíticas descendentes via parent_codigo.
 *   DRE: valor mensal = creditos - debitos. BP_ATIVO: saldo_final. BP_PASSIVO: -saldo_final.
 * - Subtotais: somam descendentes não-subtotais na estrutura.
 */
export function useMonthlyStatement(
  companyId: string | null,
  tipo: string,
  periodos: string[],
) {
  return useQuery({
    queryKey: ["monthly-stmt", companyId, tipo, periodos.join(",")],
    enabled: !!companyId && periodos.length > 0,
    queryFn: async () => {
      const [stmtRes, chartRes, balRes] = await Promise.all([
        supabase
          .from("financial_statements")
          .select("linha_ordem, descricao, codigo_conta, nivel, is_subtotal, periodo")
          .eq("company_id", companyId!)
          .eq("tipo_demonstracao", tipo)
          .order("linha_ordem"),
        supabase
          .from("chart_of_accounts")
          .select("codigo_conta, parent_codigo, tipo_conta")
          .eq("company_id", companyId!),
        supabase
          .from("account_balances")
          .select("codigo_conta, periodo, debitos, creditos, saldo_final")
          .eq("company_id", companyId!)
          .in("periodo", periodos),
      ]);
      if (stmtRes.error) throw stmtRes.error;
      if (chartRes.error) throw chartRes.error;
      if (balRes.error) throw balRes.error;

      const allStmt = stmtRes.data ?? [];
      const periodSet = Array.from(new Set(allStmt.map((s: any) => s.periodo))).sort();
      const tplPeriod = periodSet[periodSet.length - 1];
      const template = allStmt.filter((s: any) => s.periodo === tplPeriod);

      const children = new Map<string, string[]>();
      const tipoMap = new Map<string, string>();
      for (const c of chartRes.data ?? []) {
        tipoMap.set(c.codigo_conta, c.tipo_conta ?? "A");
        if (c.parent_codigo) {
          if (!children.has(c.parent_codigo)) children.set(c.parent_codigo, []);
          children.get(c.parent_codigo)!.push(c.codigo_conta);
        }
      }
      const leafCache = new Map<string, string[]>();
      const leavesOf = (code: string): string[] => {
        if (leafCache.has(code)) return leafCache.get(code)!;
        const out: string[] = [];
        const stack = [code];
        const seen = new Set<string>();
        while (stack.length) {
          const cur = stack.pop()!;
          if (seen.has(cur)) continue;
          seen.add(cur);
          const ch = children.get(cur);
          if (ch && ch.length) stack.push(...ch);
          else if (tipoMap.get(cur) === "A") out.push(cur);
        }
        if (out.length === 0 && tipoMap.get(code) === "A") out.push(code);
        leafCache.set(code, out);
        return out;
      };

      const bMap = new Map<string, Map<string, { d: number; c: number; sf: number }>>();
      for (const b of balRes.data ?? []) {
        let m = bMap.get(b.codigo_conta);
        if (!m) {
          m = new Map();
          bMap.set(b.codigo_conta, m);
        }
        m.set(b.periodo, {
          d: Number(b.debitos) || 0,
          c: Number(b.creditos) || 0,
          sf: Number(b.saldo_final) || 0,
        });
      }

      const isBp = tipo.startsWith("BP_");
      const isPassivo = tipo === "BP_PASSIVO";

      type Row = {
        linha_ordem: number;
        descricao: string;
        codigo_conta: string | null;
        nivel: number;
        is_subtotal: boolean;
        values: Record<string, number>;
      };
      const rows: Row[] = template.map((t: any) => ({
        linha_ordem: t.linha_ordem ?? 0,
        descricao: t.descricao,
        codigo_conta: t.codigo_conta,
        nivel: t.nivel ?? 0,
        is_subtotal: !!t.is_subtotal,
        values: {},
      }));

      // 1) folhas
      for (const r of rows) {
        if (r.is_subtotal) continue;
        if (!r.codigo_conta) {
          for (const p of periodos) r.values[p] = 0;
          continue;
        }
        const leaves = leavesOf(r.codigo_conta);
        for (const p of periodos) {
          let total = 0;
          for (const leaf of leaves) {
            const b = bMap.get(leaf)?.get(p);
            if (!b) continue;
            if (isBp) total += isPassivo ? -b.sf : b.sf;
            else total += b.c - b.d;
          }
          r.values[p] = total;
        }
      }

      // 2) subtotais = soma dos descendentes não-subtotais na estrutura
      rows.sort((a, b) => a.linha_ordem - b.linha_ordem);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.is_subtotal) continue;
        const lvl = r.nivel;
        const acc: Record<string, number> = {};
        for (const p of periodos) acc[p] = 0;
        for (let j = i + 1; j < rows.length; j++) {
          if (rows[j].nivel <= lvl) break;
          if (rows[j].is_subtotal) continue;
          for (const p of periodos) acc[p] += rows[j].values[p] ?? 0;
        }
        r.values = acc;
      }

      // 3) achata para o shape esperado por buildRows
      const flat: any[] = [];
      for (const r of rows) {
        for (const p of periodos) {
          flat.push({
            linha_ordem: r.linha_ordem,
            descricao: r.descricao,
            codigo_conta: r.codigo_conta,
            nivel: r.nivel,
            is_subtotal: r.is_subtotal,
            periodo: p,
            valor: r.values[p] ?? 0,
          });
        }
      }
      return flat;
    },
  });
}
