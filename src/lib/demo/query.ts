import { useQuery, useQueries } from "@tanstack/react-query";
import { useIsDemo, DEMO_COMPANY } from "./context";
import { demoCompanies, demoPeriods, demoRows, demoEngine, demoDre, demoStructure, demoIndicators, demoAnalyses, demoRevenueExpense } from "./data";

/** Explicit public-data adapter. Never executes the original private query in demo mode. */
export function demoQueryData(key: readonly unknown[]): unknown {
  const [name] = key;
  const budgetItems = [
    {id:"demo-receita",rotulo:"Receita Líquida",contas:["3.01"],tipo_conta:"receita",ordem:1},
    {id:"demo-custo",rotulo:"Custos de Produção",contas:["3.02"],tipo_conta:"custo",ordem:2},
    {id:"demo-despesa",rotulo:"Despesas Operacionais",contas:["3.06"],tipo_conta:"despesa",ordem:3},
  ];
  const budgetValue = (id: string,p: string) => Math.abs(demoRows("DRE",[p]).find((r)=>r.linha_ordem===(id==="demo-receita"?30000:id==="demo-custo"?40000:130000))?.valor ?? 0);
  if (name === "orcamentos-multiano") return String(key[2]).split(",").map(Number).map((ano)=>({id:`demo-budget-${ano}`,nome:"Planejamento Anual",ano,realizado_visao:"contabil",status:"aprovado"}));
  if (name === "orcamento-itens-multi") return budgetItems;
  if (name === "orcamento-valores-multi") return String(key[1]).split(",").flatMap((id)=>demoPeriods.filter((p)=>id.endsWith(p.slice(0,4))).flatMap((p)=>budgetItems.map((item)=>({orcamento_id:id,item_id:item.id,competencia:p,valor_orcado:Math.round(budgetValue(item.id,p)*(item.tipo_conta==="receita"?1.04:.96)*100)/100}))));
  if (name === "orcamento-cenarios" || name === "orcamento-cenario-valores") return [];
  if (name === "orcamento-realizado-ano") {
    const ano=Number(key[4]);
    return {ano,porItem:Object.fromEntries(budgetItems.map((item)=>[item.id,{porMes:Array.from({length:12},(_,i)=>{const p=`${ano}-${String(i+1).padStart(2,"0")}-01`;return {competencia:p.slice(0,7),valor:budgetValue(item.id,p),semDados:!demoPeriods.includes(p)};})}]))};
  }
  if (name === "orcamento-drill-mensal") return {ano:key[4],contas:[]};
  if (name === "my-companies") return demoCompanies;
  if (name === "available-periods") return demoPeriods;
  if (name === "carimbo-empresa") return { linhas: 1, atualizado_em: "2026-10-18T00:00:00Z" };
  if (name === "monthly-stmt") return demoRows(String(key[2]),String(key[3]).split(",").filter(Boolean),String(key[4]),String(key[1]));
  if (name === "indic-engine-data") {
    const id=String(key[2]),visao=String(key[3]);
    return visao === "comparativo" ? {contabil:demoEngine(id),gerencial:demoEngine(id,"gerencial")} : demoEngine(id,visao);
  }
  if (name === "indic-demo-dre") {
    const id=String(key[2]),periods=String(key[3]).split(",").filter(Boolean),visao=String(key[4]);
    return visao === "comparativo" ? {contabil:demoDre(periods,"contabil",id),gerencial:demoDre(periods,"gerencial",id)} : demoDre(periods,visao,id);
  }
  if (name === "estrutura-padrao") return demoStructure;
  if (name === "cliente-indicadores") return demoIndicators.filter((r)=>String(key[2]).split(",").includes(r.visibilidade));
  if (name === "dashboard-indices-visiveis") return [];
  if (name === "analise-configs") return demoAnalyses.filter((r)=>!key[2]||r.visivel);
  if (name === "plano-tipo-custo") return [{classificacao:"3.02.01.02",tipo_custo:"variavel"},{classificacao:"3.02.01.08",tipo_custo:"fixo"},{classificacao:"3.06.01.01",tipo_custo:"fixo"},{classificacao:"3.06.01.02",tipo_custo:"variavel"}];
  if (name === "receita-despesa") return demoRevenueExpense(String(key[3]).split(",").filter(Boolean),String(key[2]));
  if (name === "drilldown-lanc") return {entries:[],saldoInicial:[],contasMap:{},contasEncontradas:0,minCompetencia:key[3],maxCompetencia:key[4],ajustes:[]};
  if (name === "indic-explicacao") return "Indicador calculado exclusivamente sobre os valores fictícios da Modelo Ltda. A fórmula e a evolução mensal permitem avaliar o desempenho do período.";
  if (name === "insights") return "Resultados: acompanhe a evolução da receita e das margens nos meses selecionados.\n\nCapital de giro: compare os saldos de recebíveis, estoques e fornecedores com a geração de caixa.\n\nEsta análise demonstrativa utiliza exclusivamente dados fictícios da Modelo Ltda.";
  // Unknown/new private queries remain fail-closed, rather than reaching the real tenant.
  return [];
}
export const useBiQuery: typeof useQuery = ((options: any, client?: any) => {
  const demo=useIsDemo();
  return useQuery(demo ? {...options, queryKey:["public-demo",...options.queryKey], queryFn:()=>demoQueryData(options.queryKey)} : options,client);
}) as typeof useQuery;
export const useBiQueries: typeof useQueries = ((options: any, client?: any) => {
  const demo=useIsDemo();
  return useQueries(demo ? {...options,queries:options.queries.map((q: any)=>({...q,queryKey:["public-demo",...q.queryKey],queryFn:()=>demoQueryData(q.queryKey)}))} : options,client);
}) as typeof useQueries;