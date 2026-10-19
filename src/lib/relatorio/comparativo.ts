import type { DadosRelatorio, LinhaDemo } from "./tipos";

export function unirLinhasComparativo(contabil: LinhaDemo[], gerencial: LinhaDemo[]): LinhaDemo[] {
  const chave = (l: LinhaDemo) => `${l.nivel}|${l.descricao}`;
  const linhas = new Map(contabil.map(l => [chave(l), l]));
  for (const l of gerencial) if (!linhas.has(chave(l))) linhas.set(chave(l), { ...l, valores: {} });
  return [...linhas.values()];
}

export function valoresComparativo(linha: LinhaDemo, gerencial: LinhaDemo[], periodos: string[]) {
  const outra = gerencial.find(l => l.descricao === linha.descricao && l.nivel === linha.nivel);
  const contabil = periodos.reduce((s, p) => s + (linha.valores[p] ?? 0), 0);
  const ger = periodos.reduce((s, p) => s + (outra?.valores[p] ?? 0), 0);
  return [contabil, ger, Math.round((ger - contabil) * 100) / 100];
}

export function possuiAjustesNoPeriodo(ajustes: { competencia: string; valor: number }[], periodo: string): boolean {
  return ajustes.some(a => a.competencia.slice(0, 7) <= periodo.slice(0, 7) && Math.abs(a.valor) > 0);
}

export function visaoRelatorio(d: DadosRelatorio): "contabil" | "comparativo" {
  return d.gerencial ? "comparativo" : "contabil";
}