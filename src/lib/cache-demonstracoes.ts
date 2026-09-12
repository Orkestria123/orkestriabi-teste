// Cache das demonstrações já calculadas, no navegador.
//
// Montar DRE/Balanço/DFC exige ler plano de contas + saldos e reconstruir a
// hierarquia — segundos de trabalho. Enquanto NADA foi importado para a
// empresa, o resultado é sempre o mesmo, então guardamos o resultado pronto
// marcado com um "carimbo" (quantidade de saldos + data da última
// atualização). Muda o carimbo, o cálculo é refeito automaticamente.

const PREFIXO = "bi:dem:";
const MAX_ENTRADAS = 12;
const MAX_BYTES = 1_500_000;

export interface CarimboEmpresa {
  linhas: number;
  atualizado_em: string | null;
}

export function carimboToken(c: CarimboEmpresa | null | undefined): string {
  if (!c) return "sem-carimbo";
  return `${c.linhas}@${c.atualizado_em ?? "-"}`;
}

function chave(partes: (string | number | null | undefined)[]): string {
  return PREFIXO + partes.map((p) => String(p ?? "")).join("|");
}

function disponivel(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function lerCache<T>(partes: (string | number | null | undefined)[]): T | null {
  if (!disponivel()) return null;
  try {
    const raw = window.localStorage.getItem(chave(partes));
    if (!raw) return null;
    const obj = JSON.parse(raw) as { t: number; d: T };
    return obj.d ?? null;
  } catch {
    return null;
  }
}

export function gravarCache(partes: (string | number | null | undefined)[], dados: unknown) {
  if (!disponivel()) return;
  try {
    const raw = JSON.stringify({ t: Date.now(), d: dados });
    if (raw.length > MAX_BYTES) return;
    window.localStorage.setItem(chave(partes), raw);
    podar();
  } catch {
    // Cota estourada: limpa tudo e tenta uma vez só.
    try {
      limparCacheDemonstracoes();
      window.localStorage.setItem(chave(partes), JSON.stringify({ t: Date.now(), d: dados }));
    } catch {
      /* segue sem cache */
    }
  }
}

/** Mantém apenas as entradas mais recentes. */
function podar() {
  if (!disponivel()) return;
  const entradas: { k: string; t: number }[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k?.startsWith(PREFIXO)) continue;
    let t = 0;
    try {
      t = JSON.parse(window.localStorage.getItem(k) ?? "{}").t ?? 0;
    } catch {
      /* entrada inválida: descarta primeiro */
    }
    entradas.push({ k, t });
  }
  if (entradas.length <= MAX_ENTRADAS) return;
  entradas.sort((a, b) => a.t - b.t);
  for (const e of entradas.slice(0, entradas.length - MAX_ENTRADAS)) {
    window.localStorage.removeItem(e.k);
  }
}

export function limparCacheDemonstracoes() {
  if (!disponivel()) return;
  const remover: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k?.startsWith(PREFIXO)) remover.push(k);
  }
  for (const k of remover) window.localStorage.removeItem(k);
}
