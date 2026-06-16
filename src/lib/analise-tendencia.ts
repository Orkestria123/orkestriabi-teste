// Motor de análise de Tendência.
// Recebe a série mensal {mes, receita, despesaTotal, margem, periodo (YYYY-MM-DD)} e calcula:
//   - médias móveis de N períodos (3 padrão)
//   - taxa de crescimento composta mensal (CAGR mensal)
//   - sazonalidade: média por mês do ano (de todos os anos disponíveis)
//   - projeção linear simples (regressão por mínimos quadrados) para os próximos K meses
//   - banda de confiança (± erro-padrão dos resíduos)

export interface PontoSerie {
  periodo: string; // YYYY-MM-DD
  mes: string; // rótulo curto
  receita: number;
  despesaTotal: number;
  margem: number;
}

export interface PontoComMA extends PontoSerie {
  receitaMA?: number;
  despesaMA?: number;
  margemMA?: number;
}

export function mediaMovel(serie: PontoSerie[], janela = 3): PontoComMA[] {
  return serie.map((p, i) => {
    if (i < janela - 1) return { ...p };
    const slice = serie.slice(i - janela + 1, i + 1);
    const avg = (k: keyof PontoSerie) =>
      slice.reduce((s, x) => s + (x[k] as number), 0) / janela;
    return {
      ...p,
      receitaMA: avg("receita"),
      despesaMA: avg("despesaTotal"),
      margemMA: avg("margem"),
    };
  });
}

export function crescimentoMensalMedio(serie: PontoSerie[], campo: "receita" | "despesaTotal" | "margem"): number | null {
  const valores = serie.map((p) => p[campo]).filter((v) => Number.isFinite(v) && v > 0);
  if (valores.length < 2) return null;
  const inicio = valores[0];
  const fim = valores[valores.length - 1];
  const n = valores.length - 1;
  if (inicio <= 0 || fim <= 0) return null;
  return (Math.pow(fim / inicio, 1 / n) - 1) * 100;
}

// Regressão linear y = a + b*x. x = índice (0,1,2...).
function regressaoLinear(y: number[]): { a: number; b: number; sigma: number } {
  const n = y.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (y[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const b = den === 0 ? 0 : num / den;
  const a = my - b * mx;
  let resSq = 0;
  for (let i = 0; i < n; i++) {
    const yi = a + b * xs[i];
    resSq += (y[i] - yi) ** 2;
  }
  const sigma = n > 2 ? Math.sqrt(resSq / (n - 2)) : 0;
  return { a, b, sigma };
}

export interface PontoProjecao {
  mes: string;
  periodo: string;
  receita: number | null;
  despesaTotal: number | null;
  receitaProj?: number;
  despesaProj?: number;
  receitaProjMin?: number;
  receitaProjMax?: number;
  despesaProjMin?: number;
  despesaProjMax?: number;
  projetado?: boolean;
}

function addMonths(iso: string, n: number): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

const MES_ABBR = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
function labelMes(iso: string): string {
  const d = new Date(iso);
  return `${MES_ABBR[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`;
}

export function projetar(serie: PontoSerie[], meses = 3): PontoProjecao[] {
  if (serie.length < 3) {
    return serie.map((p) => ({
      mes: p.mes, periodo: p.periodo,
      receita: p.receita, despesaTotal: p.despesaTotal,
    }));
  }
  const rec = regressaoLinear(serie.map((p) => p.receita));
  const des = regressaoLinear(serie.map((p) => p.despesaTotal));
  const n = serie.length;
  const historico: PontoProjecao[] = serie.map((p) => ({
    mes: p.mes, periodo: p.periodo,
    receita: p.receita, despesaTotal: p.despesaTotal,
  }));
  const futuro: PontoProjecao[] = [];
  const ultimo = serie[n - 1].periodo;
  for (let k = 1; k <= meses; k++) {
    const x = n - 1 + k;
    const yR = rec.a + rec.b * x;
    const yD = des.a + des.b * x;
    const periodo = addMonths(ultimo, k);
    futuro.push({
      mes: labelMes(periodo),
      periodo,
      receita: null,
      despesaTotal: null,
      receitaProj: yR,
      despesaProj: yD,
      receitaProjMin: yR - 1.96 * rec.sigma,
      receitaProjMax: yR + 1.96 * rec.sigma,
      despesaProjMin: yD - 1.96 * des.sigma,
      despesaProjMax: yD + 1.96 * des.sigma,
      projetado: true,
    });
  }
  // Conecta histórico → projeção: o último ponto histórico tem também o valor projetado
  if (historico.length > 0) {
    const ult = historico[historico.length - 1];
    ult.receitaProj = ult.receita ?? undefined;
    ult.despesaProj = ult.despesaTotal ?? undefined;
  }
  return [...historico, ...futuro];
}

export interface PontoSazonalidade {
  mes: string; // Jan, Fev...
  mesNum: number;
  receitaMedia: number;
  despesaMedia: number;
  indiceReceita: number; // 1.0 = média; >1 mês forte
}

export function sazonalidade(serie: PontoSerie[]): PontoSazonalidade[] {
  const buckets: Record<number, { rec: number[]; des: number[] }> = {};
  for (const p of serie) {
    const m = new Date(p.periodo).getUTCMonth();
    if (!buckets[m]) buckets[m] = { rec: [], des: [] };
    buckets[m].rec.push(p.receita);
    buckets[m].des.push(p.despesaTotal);
  }
  const mediaGlobalRec =
    serie.reduce((s, p) => s + p.receita, 0) / Math.max(1, serie.length);
  return Array.from({ length: 12 }, (_, m) => {
    const b = buckets[m];
    const rm = b && b.rec.length ? b.rec.reduce((s, v) => s + v, 0) / b.rec.length : 0;
    const dm = b && b.des.length ? b.des.reduce((s, v) => s + v, 0) / b.des.length : 0;
    return {
      mes: MES_ABBR[m],
      mesNum: m,
      receitaMedia: rm,
      despesaMedia: dm,
      indiceReceita: mediaGlobalRec > 0 ? rm / mediaGlobalRec : 0,
    };
  });
}
