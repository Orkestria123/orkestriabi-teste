// Acúmulo de saldo patrimonial: abertura + movimento POSTERIOR a ela.
//
// O bug que isto corrige: o motor pegava o saldo de abertura mais
// recente de qualquer data e somava TODO o movimento até a data pedida.
// Só que o saldo de abertura já embute o histórico até a própria
// data_referencia — então todo movimento anterior a ela era contado
// duas vezes.
//
//   abertura 31/12/2024 = 10.000 (já contém nov+dez)
//   movimento 2025 = 4.000
//   correto  = 14.000
//   antes    = 24.000  (nov+dez somados de novo)
//
// Duas regras, as duas por conta:
//   1. vale a abertura mais recente COM data_referencia <= data pedida
//      (não a mais recente em absoluto — senão o saldo de um mês
//       passado usaria uma abertura futura)
//   2. só soma movimento com competencia > data dessa abertura
//
// Implementado com soma de prefixo + busca binária: montar custa
// O(n log n) uma vez, e cada consulta de saldo sai em O(log n).

export interface MovimentoConta {
  conta_codigo: string;
  competencia: string; // YYYY-MM-01
  movimento: number;
}

export interface AberturaConta {
  conta_codigo: string;
  data_referencia: string; // YYYY-MM-DD
  saldo: number;
}

interface SerieConta {
  /** competências ordenadas */
  datas: string[];
  /** prefixo[i] = soma dos movimentos até datas[i] (inclusive) */
  prefixo: number[];
  /** aberturas ordenadas por data */
  aberturas: { data: string; saldo: number }[];
}

export interface Acumulador {
  /** saldo da conta acumulado até `ateData` (inclusive) */
  saldoAte(conta: string, ateData: string): number;
  /** códigos com abertura ou movimento */
  contas(): string[];
}

/** Soma dos movimentos com competencia <= data, via busca binária. */
function somaAte(s: SerieConta, data: string): number {
  const { datas, prefixo } = s;
  if (datas.length === 0) return 0;
  let lo = 0;
  let hi = datas.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (datas[mid] <= data) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx < 0 ? 0 : prefixo[idx];
}

export function criarAcumulador(
  movimentos: MovimentoConta[],
  aberturas: AberturaConta[],
): Acumulador {
  const series = new Map<string, SerieConta>();

  const obter = (conta: string): SerieConta => {
    let s = series.get(conta);
    if (!s) {
      s = { datas: [], prefixo: [], aberturas: [] };
      series.set(conta, s);
    }
    return s;
  };

  // 1) agrupa movimento por conta+competência (pode vir repetido)
  const porContaData = new Map<string, Map<string, number>>();
  for (const m of movimentos) {
    let mm = porContaData.get(m.conta_codigo);
    if (!mm) { mm = new Map(); porContaData.set(m.conta_codigo, mm); }
    mm.set(m.competencia, (mm.get(m.competencia) ?? 0) + (Number(m.movimento) || 0));
  }

  // 2) ordena e monta a soma de prefixo
  for (const [conta, mm] of porContaData) {
    const s = obter(conta);
    const datas = Array.from(mm.keys()).sort();
    let acc = 0;
    s.datas = datas;
    s.prefixo = datas.map((d) => (acc += mm.get(d)!));
  }

  // 3) aberturas ordenadas por data
  for (const a of aberturas) {
    const s = obter(a.conta_codigo);
    s.aberturas.push({ data: a.data_referencia, saldo: Number(a.saldo) || 0 });
  }
  for (const s of series.values()) {
    s.aberturas.sort((x, y) => x.data.localeCompare(y.data));
  }

  return {
    saldoAte(conta: string, ateData: string): number {
      const s = series.get(conta);
      if (!s) return 0;

      // abertura aplicável = a mais recente com data <= ateData
      let ab: { data: string; saldo: number } | null = null;
      for (const a of s.aberturas) {
        if (a.data <= ateData) ab = a;
        else break;
      }

      if (!ab) {
        // sem abertura aplicável: só o movimento até a data
        return somaAte(s, ateData);
      }
      // abertura + movimento estritamente POSTERIOR à data dela
      return ab.saldo + (somaAte(s, ateData) - somaAte(s, ab.data));
    },
    contas(): string[] {
      return Array.from(series.keys());
    },
  };
}
