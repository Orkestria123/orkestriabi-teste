import { describe, expect, it, vi } from "vitest";
import { ajustesToSaldosVirtuais, getAjustesGerenciais, type AjusteResolvido } from "./ajustes";

const consulta = vi.hoisted(() => {
  const filtros: Record<string, string> = {};
  const rows = {
    ajustes_gerenciais: [
      { id: "jan", competencia: "2026-01-01", conta_debito: "DAL-0002", conta_credito: "303", valor: 310300 },
      { id: "fev", competencia: "2026-02-01", conta_debito: "303", conta_credito: "DAL-0002", valor: 310300 },
    ],
    contas_gerenciais: [],
    plano_contas: [
      { codigo: "303", classificacao: "1.01.03.01.02", descricao: "Matéria prima", company_id: null },
      { codigo: "DAL-0002", classificacao: "3.02.01.DAL0002", descricao: "CPV", company_id: "dal" },
      { codigo: "OUTRA-0002", classificacao: "3.02.01.OUTRA0002", descricao: "Outra empresa", company_id: "outra" },
    ],
  };
  return { filtros, rows };
});
vi.mock("@/lib/plano/depara", () => ({ getTradutor: async () => null }));
vi.mock("@/lib/plano/consulta", () => ({ getEscopoConsulta: async () => ({ modoGlobal: true, tenantId: "open" }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: keyof typeof consulta.rows) => {
  let data = [...consulta.rows[t]];
  const q = {
    select: () => q, eq: () => q,
    is: () => { data = data.filter(r => !("company_id" in r) || r.company_id === null); return q; },
    or: (f: string) => { consulta.filtros[t] = f; data = data.filter(r => !("company_id" in r) || r.company_id === null || f.includes(`company_id.eq.${r.company_id}`)); return q; },
    in: (_c: string, codes: string[]) => { data = data.filter(r => "codigo" in r && codes.includes(r.codigo)); return q; },
    then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
  }; return q;
} } }));

const base: AjusteResolvido = {
  id: "a1",
  competencia: "2026-08-01",
  descricao: "Ajuste",
  conta_debito: "D1",
  conta_credito: "C1",
  valor: 1000,
  movimenta_dfc: true,
  debito: { codigo: "D1", descricao: "D", classificacao: "1", origem: "plano" },
  credito: { codigo: "C1", descricao: "C", classificacao: "2", origem: "plano" },
};

describe("ajustesToSaldosVirtuais — marcação DFC", () => {
  it("resolve CPV específico da Dal Mobile e aplica R$ 310.300,00 com sinais opostos nos respectivos meses", async () => {
    const { ajustes } = await getAjustesGerenciais("dal", "open");
    expect(consulta.filtros.plano_contas).toBe("company_id.is.null,company_id.eq.dal");
    const jan = ajustesToSaldosVirtuais(ajustes, c => c === "2026-01-01");
    const fev = ajustesToSaldosVirtuais(ajustes, c => c === "2026-02-01");
    expect(jan).toHaveLength(2);
    expect(fev).toHaveLength(2);
    expect(jan.find(s => s.conta_codigo === "DAL-0002")?.movimento).toBe(310300);
    expect(fev.find(s => s.conta_codigo === "DAL-0002")?.movimento).toBe(-310300);
    expect([...jan, ...fev].reduce((s, r) => s + r.movimento, 0)).toBe(0);
  });
  it("ignora na DFC o lançamento desmarcado como 'não movimenta DFC'", () => {
    const semDfc = { ...base, id: "a2", movimenta_dfc: false };
    const saldos = ajustesToSaldosVirtuais([base, semDfc], () => true, true);
    expect(saldos).toHaveLength(2);
    expect(saldos.every((s) => ["D1", "C1"].includes(s.conta_codigo))).toBe(true);
  });

  it("mantém o lançamento desmarcado nas demais demonstrações", () => {
    const semDfc = { ...base, id: "a2", movimenta_dfc: false };
    const saldos = ajustesToSaldosVirtuais([base, semDfc], () => true);
    expect(saldos).toHaveLength(4);
  });
});
