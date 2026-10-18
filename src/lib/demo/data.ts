import snapshot from "./snapshot.json";
import { buildContext, type EngineContext, type PlanoRowEng } from "@/lib/indicadores/engine";
import { indexarDemoDre, type DemoDre } from "@/lib/indicadores/linhas";
import type { PapelEstrutura } from "@/lib/plano/estrutura";
import type { Company } from "@/hooks/use-financial-data";
import type { ConteudoRelatorio, LinhaDemo } from "@/lib/relatorio/tipos";
import { MODELO_PADRAO } from "@/lib/relatorio/tipos";
import { INDICES_DASHBOARD } from "@/lib/dashboard/indices-financeiros";
import { DEMO_COMPANY, DEMO_TENANT } from "./context";

export const demoPeriods = snapshot.periods;
export const demoCompanies: Company[] = [
  { id: DEMO_COMPANY, name: "Modelo Ltda.", razao_social: "Modelo Ltda.", cnpj: null, regime_tributario: "Lucro Real", ativo: true, tenant_id: DEMO_TENANT, fonte_dados: "diario" },
  { id: "modelo-filial", name: "Modelo Ltda. — Filial", razao_social: "Modelo Ltda. — Filial", cnpj: null, regime_tributario: "Lucro Real", ativo: true, tenant_id: DEMO_TENANT, fonte_dados: "diario" },
];
type Row = { linha_ordem: number; codigo_conta: string | null; descricao: string; nivel: number; is_subtotal: boolean; classificacao: string; periodo: string; valor: number; valor_gerencial?: number };
export const demoStructure = snapshot.estrutura as PapelEstrutura[];
const round = (v: number) => Math.round(v * 100) / 100;
export function demoRows(tipo: string, periods: string[], visao = "contabil", companyId = DEMO_COMPANY): Row[] {
  const rows = snapshot.statements[tipo as keyof typeof snapshot.statements] ?? [];
  const factor = companyId === "modelo-filial" ? 0.43 : 1;
  const set = new Set(periods);
  return rows.filter((r) => set.has(r.periodo)).map((r) => {
    const c = round(r.valor * factor);
    // A fictional balanced adjustment: revenue/result and receivables/equity.
    const adjustment = round((28500 + Number(r.periodo.slice(5, 7)) * 1850) * factor);
    const resultDre = tipo === "DRE" && [10000, 30000, 120000, 160000, 190000, 230000, 230010, 230020].includes(r.linha_ordem);
    const resultBp = tipo.startsWith("BP") && (r.nivel === 0 || r.linha_ordem === 10000 && tipo === "BP_ATIVO" || r.descricao === "Resultado do Exercício" || r.linha_ordem === 40000);
    const g = round(c + (resultDre || resultBp ? adjustment : 0));
    return { ...r, valor: visao === "gerencial" ? g : c, ...(visao === "comparativo" ? { valor_gerencial: g } : {}) };
  });
}
export type DemoEngineContext = EngineContext & { demoCompany: string; demoVisao: string };
export function demoEngine(companyId = DEMO_COMPANY, visao = "contabil"): DemoEngineContext {
  const rows = ["DRE", "BP_ATIVO", "BP_PASSIVO"].flatMap((t) => demoRows(t, demoPeriods, visao, companyId));
  const plano = new Map<string, PlanoRowEng>();
  for (const r of rows) {
    if (!r.classificacao) continue;
    plano.set(r.classificacao, { codigo: r.codigo_conta, classificacao: r.classificacao, descricao: r.descricao, natureza: r.classificacao.startsWith("2") ? "C" : "D", is_sintetica: r.is_subtotal, tipo_custo: r.classificacao.startsWith("3.02") ? "variavel" : "fixo", classe_gasto: r.classificacao.startsWith("3.02") ? "custo" : "despesa" });
  }
  const saldos = rows.filter((r) => r.classificacao && !r.is_subtotal).map((r) => ({ conta_codigo: r.classificacao, competencia: r.periodo, total_debitos: r.valor < 0 ? -r.valor : 0, total_creditos: r.valor > 0 ? r.valor : 0 }));
  const ctx = buildContext({ plano: [...plano.values()], saldos, aberturas: new Map(), saldoAcumuladoDC: (cls, p) => {
    const r = rows.find((x) => x.classificacao === cls && x.periodo === p);
    return r ? (cls.startsWith("2") ? -r.valor : r.valor) : null;
  } });
  return Object.assign(ctx, { demoCompany: companyId, demoVisao: visao });
}
export function isDemoEngine(ctx?: EngineContext): ctx is DemoEngineContext { return !!ctx && "demoCompany" in ctx; }
export function demoLine(key: string, p: string, ctx: DemoEngineContext): number | null {
  if (!demoPeriods.includes(p)) return null;
  const find = (tipo: string, predicate: (r: Row) => boolean) => demoRows(tipo, [p], ctx.demoVisao, ctx.demoCompany).find(predicate)?.valor ?? 0;
  const dreOrders: Record<string, number> = { RECEITA_BRUTA: 10000, DEDUCOES: 20000, RECEITA_LIQUIDA: 30000, CUSTOS: 40000, CUSTO_PRODUTOS: 40999, LUCRO_BRUTO: 120000, DESPESAS_OPERACIONAIS: 130000, RESULTADO_FINANCEIRO: 140000, RESULTADO_OPERACIONAL: 160000, RESULTADO_ANTES_IR: 190000, LUCRO_LIQUIDO: 230000, EBIT: 230010, EBITDA: 230020 };
  if (key in dreOrders) return find("DRE", (r) => r.linha_ordem === dreOrders[key]);
  if (key === "LUCRO_LIQUIDO_YTD") return demoPeriods.filter((x) => x.slice(0,4) === p.slice(0,4) && x <= p).reduce((s,x) => s + (demoLine("LUCRO_LIQUIDO",x,ctx) ?? 0),0);
  const prefixes: Record<string, [string, string]> = { ATIVO_TOTAL: ["BP_ATIVO", ""], ATIVO_CIRCULANTE: ["BP_ATIVO", "1.01"], ATIVO_NAO_CIRCULANTE: ["BP_ATIVO", "1.03"], DISPONIVEL: ["BP_ATIVO", "1.01.01"], CONTAS_A_RECEBER: ["BP_ATIVO", "1.01.02.01"], ESTOQUES: ["BP_ATIVO", "1.01.03"], IMOBILIZADO: ["BP_ATIVO", "1.03.03"], REALIZAVEL_LP: ["BP_ATIVO", "1.03.01"], PASSIVO_CIRCULANTE: ["BP_PASSIVO", "2.01.01"], PASSIVO_NAO_CIRCULANTE: ["BP_PASSIVO", "2.02"], PATRIMONIO_LIQUIDO: ["BP_PASSIVO", "2.05.01"], FORNECEDORES: ["BP_PASSIVO", "2.01.01.01"], PASSIVO_TOTAL_E_PL: ["BP_PASSIVO", ""] };
  const prefix = prefixes[key];
  if (prefix) return find(prefix[0], (r) => prefix[1] ? r.classificacao === prefix[1] : r.linha_ordem === 1);
  if (key === "EMPRESTIMOS") return demoRows("BP_PASSIVO",[p],ctx.demoVisao,ctx.demoCompany).filter((r) => /obriga[cç][oõ]es banc|empr[eé]stimos|financiamentos/i.test(r.descricao) && r.nivel === 2).reduce((s,r) => s+r.valor,0);
  const costs = Math.abs(demoLine("CUSTOS",p,ctx) ?? 0), op = Math.abs(demoLine("DESPESAS_OPERACIONAIS",p,ctx) ?? 0);
  if (key === "CUSTOS_FIXOS") return costs*.21;
  if (key === "CUSTOS_VARIAVEIS") return costs*.79;
  if (key === "DESPESAS_FIXAS") return op*.8;
  if (key === "DESPESAS_VARIAVEIS") return op*.2;
  if (key === "PONTO_EQUILIBRIO") return (costs*.21+op*.8)/(1-(costs*.79+op*.2)/(demoLine("RECEITA_LIQUIDA",p,ctx) || 1));
  return null;
}
export function demoDre(periods: string[], visao: string, companyId: string): DemoDre { return indexarDemoDre(demoRows("DRE",periods,visao,companyId),demoStructure); }
export function demoRevenueExpense(periods: string[], companyId = DEMO_COMPANY) {
  const rows = demoRows("DRE",periods,"contabil",companyId);
  const value = (order: number) => rows.filter((r) => r.linha_ordem === order).reduce((s,r) => s+r.valor,0);
  const leaf = (cls: string, descricao: string, valor: number) => ({ classificacao: cls, descricao, nivel: 1, valor, filhos: [] });
  const expense = [leaf("3.02.01.02", "Materiais e insumos", -value(40000)*.79),leaf("3.02.01.08","Mão de obra e fabricação",-value(40000)*.21),leaf("3.06.01.01","Despesas administrativas",-value(130000)*.8),leaf("3.06.01.02","Despesas comerciais",-value(130000)*.2)];
  return { competencias: periods, receita_total: value(30000), despesa_total: expense.reduce((s,x) => s+x.valor,0), raiz_receita: { classificacao: "3.01", descricao: "Receita", nivel:0, valor:value(30000),filhos:[] }, raiz_despesa: { classificacao: "3", descricao:"Despesas",nivel:0,valor:expense.reduce((s,x)=>s+x.valor,0),filhos:expense } };
}
export const demoIndicators = snapshot.indices.map((r,i) => ({ ...r,id:`demo-ind-${i}`, tenant_id:DEMO_TENANT,company_id:DEMO_COMPANY }));
export const demoAnalyses = snapshot.analises.map((r,i) => ({ ...r,id:`demo-analysis-${i}`,tenant_id:DEMO_TENANT }));
export function demoReport(periodo: string): ConteudoRelatorio {
  const index = demoPeriods.indexOf(periodo), anterior = demoPeriods[index-1] ?? null;
  const par = anterior ? [anterior,periodo] : [periodo];
  const lines = (tipo: string, periods: string[], max: number): LinhaDemo[] => {
    const map = new Map<number,LinhaDemo>();
    for (const r of demoRows(tipo,periods)) {
      if (r.nivel > max) continue;
      const l = map.get(r.linha_ordem) ?? {descricao:r.descricao,nivel:r.nivel,subtotal:r.is_subtotal,valores:{}};
      l.valores[r.periodo]=r.valor;map.set(r.linha_ordem,l);
    }
    return [...map.values()];
  };
  const ctx = demoEngine();
  const bases = (p: string) => ({ ac:demoLine("ATIVO_CIRCULANTE",p,ctx) ?? 0,pc:demoLine("PASSIVO_CIRCULANTE",p,ctx) ?? 0,estoques:demoLine("ESTOQUES",p,ctx) ?? 0,disponivel:demoLine("DISPONIVEL",p,ctx) ?? 0,emprestimos:demoLine("EMPRESTIMOS",p,ctx) ?? 0,pl:demoLine("PATRIMONIO_LIQUIDO",p,ctx) ?? 0,lucroBruto:demoLine("LUCRO_BRUTO",p,ctx) ?? 0,ebitda:demoLine("EBITDA",p,ctx) ?? 0,lucroLiquido:demoLine("LUCRO_LIQUIDO",p,ctx) ?? 0,receitaLiquida:demoLine("RECEITA_LIQUIDA",p,ctx) ?? 0 });
  const window = Array.from({length:12},(_,i) => {const d=new Date(Date.UTC(Number(periodo.slice(0,4)),Number(periodo.slice(5,7))-12+i,1));return d.toISOString().slice(0,10);});
  const year = demoPeriods.filter((p)=>p.slice(0,4)===periodo.slice(0,4)&&p<=periodo);
  return {secoes:MODELO_PADRAO.secoes,textos:{...MODELO_PADRAO.textos,escritorio:"A Open Gestão apresenta a leitura econômica e financeira da Modelo Ltda., com foco na evolução dos resultados, estrutura patrimonial e geração de caixa.",empresa:"Modelo Ltda. é uma empresa industrial fictícia. Endereço ilustrativo: Avenida Exemplo, 1000, Centro, São Paulo/SP. Todas as informações cadastrais e financeiras desta apresentação são demonstrativas.",resumo:"A avaliação do período considera receitas, custos e despesas, posição patrimonial e fluxos de caixa. Os indicadores e as demonstrações a seguir apresentam exclusivamente os valores fictícios da Modelo Ltda.",notas:"Base de apresentação: informações fictícias destinadas à demonstração do BI, sem representar uma empresa real.\nOs saldos patrimoniais representam a posição de encerramento do mês. Receitas, custos e despesas correspondem aos movimentos do período.\nOs meses sem cobertura são identificados como N/D. Não se atribuem políticas contábeis ou fatos reais à empresa modelo.",conclusoes:"Recomenda-se acompanhar a composição dos custos, a evolução do capital de giro e a capacidade de geração de caixa, em conjunto com as margens e a estrutura de endividamento apresentadas."},imagens:{},escritorio:{nome:"Open Gestão Corporativa e Familiar"},empresa:{nome:"Modelo Ltda.",razao:"Modelo Ltda.",cidade:"São Paulo/SP · Avenida Exemplo, 1000 (fictício)",regime:"Lucro Real"},tema:"padrao",dados:{periodo,anterior,dre:lines("DRE",par,3),acumulado:{periodos:year,dre:lines("DRE",year,3)},bpAtivo:lines("BP_ATIVO",par,5),bpPassivo:lines("BP_PASSIVO",par,5),dfc:lines("DFC",par,3),indices:INDICES_DASHBOARD.map((d)=>({key:d.key,label:d.label,formula:d.formula,formato:d.formato,atual:d.compute(bases(periodo)),anterior:anterior?d.compute(bases(anterior)):null})),faturamento:window.map((p)=>({periodo:p,valor:demoLine("RECEITA_BRUTA",p,ctx),liquida:demoLine("RECEITA_LIQUIDA",p,ctx)}))}};
}