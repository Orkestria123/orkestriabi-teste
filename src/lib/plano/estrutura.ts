// A estrutura da demonstração vem do próprio plano de contas.
//
// Substitui `src/lib/plano/marcos.ts`. Os marcos eram uma etiqueta manual
// em ~25 contas ("esta conta é a Receita Bruta"). O plano do escritório já
// diz isso: ele traz, além das contas de lançamento, contas SINTÉTICAS SEM
// FILHOS terminadas em `.98`/`.99` que são os subtotais da demonstração:
//
//   3.01.01  RECEITA BRUTA DE VENDAS
//   3.01.02  (-)DEDUCOES DA RECEITA BRUTA
//   3.01.99  RECEITA LIQUIDA DE VENDAS E SERVIÇOS   <- acumulador
//   3.02.01  CUSTOS INDUSTRIAIS
//   3.02.99  CUSTOS DOS PRODUTOS VENDIDOS           <- acumulador
//   ...
//   3.05.99  LUCRO/PREJUIZO BRUTO                   <- acumulador
//   3.99     RESULTADO LIQUIDO DO EXERCICIO         <- acumulador
//
// O BI deixa de inventar esses subtotais e passa a calcular exatamente os
// que o plano declara, na posição em que o plano os coloca.
//
// `estrutura_padrao` (tabela de referência, mesmo padrão do `dfc_padrao`)
// guarda duas informações que a classificação sozinha não dá:
//
//   tipo_linha  'bloco'   = fecha só o próprio bloco  (3.02.99 = total de 3.02)
//               'corrido' = resultado acumulado até ali (3.05.99 = lucro bruto)
//               'detalhe' = linha comum
//               'tag'     = não é linha; marca a conta para um indicador
//   papel       nome estável que os indicadores procuram. Antes eles
//               procuravam pelo RÓTULO ("(=) Lucro Bruto") e quebravam
//               toda vez que o rótulo mudava.

import { supabase } from "@/integrations/supabase/client";

export type TipoLinha = "detalhe" | "bloco" | "corrido" | "tag";
export type DemonstracaoEstrutura = "DRE" | "BP_ATIVO" | "BP_PASSIVO";

export interface PapelEstrutura {
  classificacao: string;
  papel: string;
  demonstracao: DemonstracaoEstrutura | null;
  tipo_linha: TipoLinha;
  rotulo: string | null;
  ordem: number;
}

let cache: PapelEstrutura[] | null = null;
let inflight: Promise<PapelEstrutura[]> | null = null;

/** Tabela de referência global — carrega uma vez por sessão. */
export async function getEstruturaPadrao(): Promise<PapelEstrutura[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    // `as any`: os tipos gerados do Supabase são regenerados a partir do
    // projeto da nuvem e ainda não conhecem esta tabela.
    const { data, error } = await (supabase as any)
      .from("estrutura_padrao")
      .select("classificacao, papel, demonstracao, tipo_linha, rotulo, ordem")
      .order("ordem");
    if (error) {
      // Sem a migration aplicada o BI continua funcionando: a demonstração
      // cai para a hierarquia pura do plano, sem os subtotais nomeados.
      console.warn("[estrutura_padrao] indisponível:", error.message);
      cache = [];
      return cache;
    }
    cache = (data ?? []) as PapelEstrutura[];
    return cache;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function limparCacheEstrutura() {
  cache = null;
}

/**
 * Leitura síncrona do cache, para quem não pode esperar (o resolvedor de
 * indicadores roda dentro do avaliador de fórmula). Devolve `null` se
 * ainda não carregou — e dispara a carga para a próxima chamada.
 */
export function getEstruturaPadraoSync(): PapelEstrutura[] | null {
  if (!cache && !inflight) void getEstruturaPadrao();
  return cache;
}

/** Classificações associadas a um papel (pode ser mais de uma). */
export function classificacoesDoPapel(est: PapelEstrutura[], papel: string): string[] {
  return est.filter((e) => e.papel === papel).map((e) => e.classificacao);
}

export function papelDaClassificacao(
  est: PapelEstrutura[],
  classificacao: string,
): PapelEstrutura | null {
  return est.find((e) => e.classificacao === classificacao) ?? null;
}

/**
 * Compara classificações na ordem do plano: segmento a segmento e
 * numericamente quando possível. "3.2" < "3.10" — comparação de texto pura
 * erraria isso em planos sem zero à esquerda.
 */
export function compararClassificacao(a: string, b: string): number {
  const pa = a.split(/[.\-/]/);
  const pb = b.split(/[.\-/]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const xa = pa[i];
    const xb = pb[i];
    if (xa === undefined) return -1;
    if (xb === undefined) return 1;
    const na = Number(xa);
    const nb = Number(xb);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return na - nb;
    } else if (xa !== xb) {
      return xa < xb ? -1 : 1;
    }
  }
  return 0;
}
