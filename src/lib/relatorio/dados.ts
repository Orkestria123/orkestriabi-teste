// Coleta, no navegador, os números do BI para montar o relatório
// (mesmo motor das telas: buildStatementFromDiario + índices do dashboard).
import { getModoGlobal } from "@/lib/plano/escopo";
import { buildStatementFromDiario, type FlatRow } from "@/lib/diario/build-statements";
import { calcularIndicesEmpresa, periodosDaEmpresa } from "@/lib/comparativo/indices-empresa";
import { INDICES_DASHBOARD } from "@/lib/dashboard/indices-financeiros";
import type { DadosRelatorio, LinhaDemo } from "./tipos";

function agrupar(rows: FlatRow[], nivelMax: number): LinhaDemo[] {
  const map = new Map<string, LinhaDemo & { ordem: number }>();
  for (const r of rows) {
    if (r.nivel > nivelMax) continue;
    const k = `${r.linha_ordem}|${r.descricao}`;
    if (!map.has(k)) map.set(k, { descricao: r.descricao, nivel: r.nivel, subtotal: r.is_subtotal, valores: {}, ordem: r.linha_ordem });
    map.get(k)!.valores[r.periodo] = (map.get(k)!.valores[r.periodo] ?? 0) + Number(r.valor || 0);
  }
  return [...map.values()].sort((a, b) => a.ordem - b.ordem).map(({ ordem: _o, ...l }) => l);
}

export async function periodosDisponiveis(companyId: string) {
  return periodosDaEmpresa(companyId);
}

export async function coletarDados(companyId: string, tenantId: string, nome: string, periodo: string): Promise<DadosRelatorio> {
  const todos = await periodosDaEmpresa(companyId);
  const idx = todos.indexOf(periodo);
  const anterior = idx > 0 ? todos[idx - 1] : null;
  const doze = todos.slice(Math.max(0, idx - 11), idx + 1);
  const { modoGlobal } = await getModoGlobal(companyId);
  const par = anterior ? [anterior, periodo] : [periodo];

  const [dre12, ativo, passivo, dfc, iAtual, iAnt] = await Promise.all([
    buildStatementFromDiario(companyId, tenantId, modoGlobal, "DRE", doze, "contabil"),
    buildStatementFromDiario(companyId, tenantId, modoGlobal, "BP_ATIVO", par, "contabil"),
    buildStatementFromDiario(companyId, tenantId, modoGlobal, "BP_PASSIVO", par, "contabil"),
    buildStatementFromDiario(companyId, tenantId, modoGlobal, "DFC", [periodo], "contabil").catch(() => [] as FlatRow[]),
    calcularIndicesEmpresa({ companyId, tenantId, nome, periodo, visao: "contabil" }),
    anterior ? calcularIndicesEmpresa({ companyId, tenantId, nome, periodo: anterior, visao: "contabil" }) : Promise.resolve(null),
  ]);

  const dreTodas = agrupar(dre12, 3);
  const dre = dreTodas.map((l) => ({ ...l, valores: Object.fromEntries(Object.entries(l.valores).filter(([p]) => par.includes(p))) }));
  const rb = dreTodas.find((l) => /receita bruta/i.test(l.descricao)) ?? dreTodas.find((l) => /receita/i.test(l.descricao));
  const faturamento = doze.map((p) => ({ periodo: p, valor: rb?.valores[p] ?? 0 }));

  const indices = INDICES_DASHBOARD.map((d) => ({
    key: d.key, label: d.label, formula: d.formula, formato: d.formato,
    atual: iAtual.valores[d.key] ?? null, anterior: iAnt?.valores[d.key] ?? null,
  }));

  return { periodo, anterior, dre, bpAtivo: agrupar(ativo, 3), bpPassivo: agrupar(passivo, 3), dfc: agrupar(dfc, 3), indices, faturamento };
}

export function resumoParaIA(d: DadosRelatorio): string {
  const f = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  const linhas = (ls: typeof d.dre, max = 25) => ls.filter((l) => l.nivel <= 2).slice(0, max)
    .map((l) => `${l.descricao}: ${f(l.valores[d.periodo] ?? 0)}${d.anterior ? ` (ant. ${f(l.valores[d.anterior] ?? 0)})` : ""}`).join("\n");
  return [
    `Período: ${d.periodo.slice(0, 7)}${d.anterior ? `; anterior: ${d.anterior.slice(0, 7)}` : ""}`,
    "DRE:\n" + linhas(d.dre),
    "Balanço Ativo:\n" + linhas(d.bpAtivo, 12),
    "Balanço Passivo+PL:\n" + linhas(d.bpPassivo, 12),
    "DFC:\n" + d.dfc.filter((l) => l.nivel <= 1).map((l) => `${l.descricao}: ${f(l.valores[d.periodo] ?? 0)}`).join("\n"),
    "Indicadores:\n" + d.indices.map((i) => `${i.label} (${i.formula}): ${i.atual == null ? "N/D" : i.atual.toFixed(2)}${i.anterior != null ? ` (ant. ${i.anterior.toFixed(2)})` : ""}`).join("\n"),
    "Faturamento 12m:\n" + d.faturamento.map((x) => `${x.periodo.slice(0, 7)}: ${f(x.valor)}`).join("; "),
  ].join("\n\n");
}
