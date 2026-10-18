import { describe, it, expect } from "vitest";
import { demoPeriods, demoRows, demoReport, demoCompanies, demoEngine, demoLine } from "./data";
import { demoQueryData } from "./query";

describe("public Modelo Ltda. demonstration",()=>{
  it("never carries source IDs or company identification in public data or reports",()=>{
    const data=JSON.stringify({companies:demoCompanies,rows:["DRE","BP_ATIVO","BP_PASSIVO","DFC"].map((t)=>demoRows(t,demoPeriods)),report:demoReport("2026-08-01")});
    expect(data).not.toMatch(/latic[ií]nios|\bbio\b|83c260ec-f447-4c0d-8ad0-305484b8aa08|3713c40c-7e62-4b35-924e-d04a913ccae3/i);
    expect(demoCompanies[0].name).toBe("Modelo Ltda.");
    expect(demoReport("2026-08-01").empresa.cidade).toContain("Avenida Exemplo");
  });
  it("replaces source figures instead of applying a reversible global multiplier",()=>{
    const rb=demoRows("DRE",["2026-08-01"]).find((r)=>r.linha_ordem===10000)?.valor;
    const rl=demoRows("DRE",["2026-08-01"]).find((r)=>r.linha_ordem===30000)?.valor;
    expect(rb).not.toBe(13119175.65);
    expect(rb && rl && Math.abs(rb/13119175.65-rl/11169459.31)).toBeGreaterThan(.001);
  });
  it("balances fictional assets with liabilities and equity in every month",()=>{
    for (const p of demoPeriods) {
      const a=demoRows("BP_ATIVO",[p]).find((r)=>r.linha_ordem===1)?.valor ?? 0;
      const rows=demoRows("BP_PASSIVO",[p]);
      const components=rows.filter((r)=>[10000,20000,40000].includes(r.linha_ordem)).reduce((s,r)=>s+r.valor,0);
      expect(a).toBeGreaterThan(0);expect(components).toBeCloseTo(a,2);
    }
  });
  it("keeps the executive report identical to the public BI amounts",()=>{
    const report=demoReport("2026-08-01"),ctx=demoEngine();
    expect(report.dados.faturamento.at(-1)?.valor).toBe(demoLine("RECEITA_BRUTA","2026-08-01",ctx));
    expect(report.empresa.nome).toBe("Modelo Ltda.");
    expect(report.dados.dfc.length).toBeGreaterThan(0);
  });
  it("fails closed for unknown private queries",()=>{
    expect(demoQueryData(["private-new-query","any-real-company"])).toEqual([]);
  });
});