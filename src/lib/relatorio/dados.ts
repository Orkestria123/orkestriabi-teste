// Coleta, no navegador, os números do BI para montar o relatório
// (mesmo motor das telas: buildStatementFromDiario + índices do dashboard).
import { getModoGlobal } from "@/lib/plano/escopo";
import { buildStatementFromDiario, type FlatRow } from "@/lib/diario/build-statements";
import { calcularIndicesEmpresa, periodosDaEmpresa } from "@/lib/comparativo/indices-empresa";
import { INDICES_DASHBOARD } from "@/lib/dashboard/indices-financeiros";
import type { DadosRelatorio, LinhaDemo } from "./tipos";
import { getAjustesGerenciais } from "@/lib/gerencial/ajustes";
import { possuiAjustesNoPeriodo } from "./comparativo";

function agrupar(rows: FlatRow[], nivelMax: number): LinhaDemo[] {
  const map = new Map<string, LinhaDemo & { ordem: number }>();
  for (const r of rows) {
    if (r.nivel > nivelMax) continue;
    const k = `${r.linha_ordem}|${r.descricao}`;
    if (!map.has(k)) map.set(k, { descricao: r.descricao, nivel: r.nivel, subtotal: r.is_subtotal, valores: {}, ordem: r.linha_ordem });
    const linha = map.get(k);
    if (linha) linha.valores[r.periodo] = (linha.valores[r.periodo] ?? 0) + Number(r.valor || 0);
  }
  return [...map.values()].sort((a, b) => a.ordem - b.ordem).map(({ ordem: _o, ...l }) => l);
}

export async function periodosDisponiveis(companyId: string) {
  return periodosDaEmpresa(companyId);
}

export async function coletarDados(companyId: string, tenantId: string, nome: string, periodo: string, visao: "contabil" | "gerencial" = "contabil"): Promise<DadosRelatorio> {
  const todos = await periodosDaEmpresa(companyId);
  if (!todos.includes(periodo)) throw new Error("Sem dados no mês escolhido.");
  const ano = Number(periodo.slice(0, 4)), mes = Number(periodo.slice(5, 7));
  const chave = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}-01`;
  const janela = Array.from({ length: 12 }, (_, i) => {
    const dt = new Date(Date.UTC(ano, mes - 12 + i, 1));
    return chave(dt.getUTCFullYear(), dt.getUTCMonth() + 1);
  });
  const mesAnterior = mes === 1 ? chave(ano - 1, 12) : chave(ano, mes - 1);
  const anterior = todos.includes(mesAnterior) ? mesAnterior : null;
  const doze = janela.filter((p) => todos.includes(p));
  const anoDisponivel = todos.filter((p) => p.slice(0, 4) === String(ano) && p <= periodo);
  const fluxos = [...new Set([...doze, ...anoDisponivel])].sort();
  const { modoGlobal } = await getModoGlobal(companyId);
  const par = anterior ? [anterior, periodo] : [periodo];

  const [dre12, ativo, passivo, dfc, iAtual, iAnt] = await Promise.all([
    buildStatementFromDiario(companyId, tenantId, modoGlobal, "DRE", fluxos, visao),
    buildStatementFromDiario(companyId, tenantId, modoGlobal, "BP_ATIVO", par, visao),
    buildStatementFromDiario(companyId, tenantId, modoGlobal, "BP_PASSIVO", par, visao),
    buildStatementFromDiario(companyId, tenantId, modoGlobal, "DFC", par, visao),
    calcularIndicesEmpresa({ companyId, tenantId, nome, periodo, visao }),
    anterior ? calcularIndicesEmpresa({ companyId, tenantId, nome, periodo: anterior, visao }) : Promise.resolve(null),
  ]);

  const dreTodas = agrupar(dre12, 3);
  const dre = dreTodas.map((l) => ({ ...l, valores: Object.fromEntries(Object.entries(l.valores).filter(([p]) => par.includes(p))) }));
  const rb = dreTodas.find((l) => /receita bruta/i.test(l.descricao)) ?? dreTodas.find((l) => /receita/i.test(l.descricao));
  const rl = dreTodas.find((l) => /receita l[ií]quida/i.test(l.descricao));
  const faturamento = janela.map((p) => ({ periodo: p, valor: todos.includes(p) ? rb?.valores[p] ?? null : null, liquida: todos.includes(p) ? rl?.valores[p] ?? null : null }));
  const acumulado = { periodos: anoDisponivel, dre: dreTodas.map((l) => ({ ...l, valores: Object.fromEntries(Object.entries(l.valores).filter(([p]) => anoDisponivel.includes(p))) })) };

  const indices = INDICES_DASHBOARD.map((d) => ({
    key: d.key, label: d.label, formula: d.formula, formato: d.formato,
    atual: iAtual.valores[d.key] ?? null, anterior: iAnt?.valores[d.key] ?? null,
  }));
  indices.push(...[
    { key: "roe", label: "ROE mensal", formula: "Lucro Líquido / Patrimônio Líquido × 100", formato: "percent" },
    { key: "roa", label: "ROA mensal", formula: "Lucro Líquido / Ativo Total × 100", formato: "percent" },
    { key: "giroAtivo", label: "Giro do Ativo mensal", formula: "Receita Líquida / Ativo Total", formato: "ratio" },
  ].map((d) => ({ ...d, atual: iAtual.valores[d.key] ?? null, anterior: iAnt?.valores[d.key] ?? null })) as typeof indices);

  const dados: DadosRelatorio = { periodo, anterior, dre, acumulado, bpAtivo: agrupar(ativo, 5), bpPassivo: agrupar(passivo, 5), dfc: agrupar(dfc, 3), indices, faturamento };
  if (visao === "contabil") {
    const { ajustes } = await getAjustesGerenciais(companyId, tenantId);
    if (possuiAjustesNoPeriodo(ajustes, periodo)) dados.gerencial = await coletarDados(companyId, tenantId, nome, periodo, "gerencial");
  }
  return dados;
}

export function resumoParaIA(d: DadosRelatorio): string {
  if (d.gerencial) {
    const { gerencial, ...contabil } = d;
    return "Visão Comparativo. Diferencie explicitamente os valores Contábeis dos Gerenciais e explique somente alterações demonstradas. Diferença = Gerencial menos Contábil.\n\nCONTÁBIL:\n" + resumoParaIA(contabil) + "\n\nGERENCIAL:\n" + resumoParaIA(gerencial);
  }
  const f = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  const linhas = (ls: typeof d.dre, max = 70) => ls.filter((l) => l.nivel <= 3).slice(0, max)
    .map((l) => `${l.descricao}: ${f(l.valores[d.periodo] ?? 0)}${d.anterior ? ` (ant. ${f(l.valores[d.anterior] ?? 0)})` : ""}`).join("\n");
  return [
    `Período: ${d.periodo.slice(0, 7)}${d.anterior ? `; anterior: ${d.anterior.slice(0, 7)}` : ""}`,
    "DRE:\n" + linhas(d.dre),
    "DRE acumulada no ano (somente meses disponíveis):\n" + (d.acumulado?.dre ?? []).filter((l) => l.subtotal).map((l) => `${l.descricao}: ${f(Object.values(l.valores).reduce((a,b) => a+b,0))}`).join("\n"),
    "Balanço Ativo:\n" + linhas(d.bpAtivo),
    "Balanço Passivo+PL:\n" + linhas(d.bpPassivo),
    "DFC:\n" + linhas(d.dfc),
    "Indicadores:\n" + d.indices.map((i) => `${i.label} (${i.formula}): ${i.atual == null ? "N/D" : i.atual.toFixed(2)}${i.anterior != null ? ` (ant. ${i.anterior.toFixed(2)})` : ""}`).join("\n"),
    "Faturamento 12m:\n" + d.faturamento.map((x) => `${x.periodo.slice(0, 7)}: RB ${x.valor == null ? "N/D" : f(x.valor)}, RL ${x.liquida == null ? "N/D" : f(x.liquida)}`).join("; "),
  ].join("\n\n");
}
