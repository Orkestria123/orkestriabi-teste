import { buildStatementFromDiario, verificarFechamentoBP } from "../src/lib/diario/build-statements";
const COMPANY = "13215792-617c-4334-be1c-e65e2442e178";
const TENANT = "3713c40c-7e62-4b35-924e-d04a913ccae3";
const PER = ["2025-01-01"];
const get = (rows: any[], desc: string) => rows.find((r) => r.descricao === desc)?.valor ?? 0;
const f = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const [dreC, dreG, bpAC, bpAG, bpPC, bpPG, fechC, fechG] = await Promise.all([
  buildStatementFromDiario(COMPANY, TENANT, false, "DRE", PER, "contabil"),
  buildStatementFromDiario(COMPANY, TENANT, false, "DRE", PER, "gerencial"),
  buildStatementFromDiario(COMPANY, TENANT, false, "BP_ATIVO", PER, "contabil"),
  buildStatementFromDiario(COMPANY, TENANT, false, "BP_ATIVO", PER, "gerencial"),
  buildStatementFromDiario(COMPANY, TENANT, false, "BP_PASSIVO", PER, "contabil"),
  buildStatementFromDiario(COMPANY, TENANT, false, "BP_PASSIVO", PER, "gerencial"),
  verificarFechamentoBP(COMPANY, TENANT, false, PER, "contabil"),
  verificarFechamentoBP(COMPANY, TENANT, false, PER, "gerencial"),
]);

const lucC = get(dreC, "(=) Lucro Líquido do Exercício");
const lucG = get(dreG, "(=) Lucro Líquido do Exercício");
const resC = get(bpPC, "Resultado do Exercício");
const resG = get(bpPG, "Resultado do Exercício");
const despC = get(dreC, "(-) Despesas Operacionais");
const despG = get(dreG, "(-) Despesas Operacionais");
const ativoC = get(bpAC, "Total do Ativo");
const ativoG = get(bpAG, "Total do Ativo");
const pcC = get(bpPC, "Passivo Circulante");
const pcG = get(bpPG, "Passivo Circulante");
const totC = get(bpPC, "Total do Passivo + PL");
const totG = get(bpPG, "Total do Passivo + PL");

console.log("=== IDENTIDADE Lucro Líquido DRE == Resultado do Exercício BP ===");
console.log(`Contábil:  DRE=${f(lucC)}  BP=${f(resC)}  Δ=${f(lucC - resC)}`);
console.log(`Gerencial: DRE=${f(lucG)}  BP=${f(resG)}  Δ=${f(lucG - resG)}`);
console.log("");
console.log("=== DRE ===");
console.log(`Despesas Op:   ${f(despC)} vs ${f(despG)}  Δ=${f(despG - despC)}`);
console.log(`Lucro Líquido: ${f(lucC)} vs ${f(lucG)}  Δ=${f(lucG - lucC)}`);
console.log("=== BP ===");
console.log(`Ativo Total:        ${f(ativoC)} vs ${f(ativoG)}  Δ=${f(ativoG - ativoC)}`);
console.log(`Passivo Circulante: ${f(pcC)} vs ${f(pcG)}  Δ=${f(pcG - pcC)}`);
console.log(`Resultado Exerc.:   ${f(resC)} vs ${f(resG)}  Δ=${f(resG - resC)}`);
console.log(`Total Passivo+PL:   ${f(totC)} vs ${f(totG)}  Δ=${f(totG - totC)}`);
console.log(`Fechamento contábil:  ${f(fechC[0].diferenca)}`);
console.log(`Fechamento gerencial: ${f(fechG[0].diferenca)}`);
