// De-para: empresa de plano próprio lendo o Plano Padrão do escritório.
//
// Era a última peça do desenho: o BI monta as demonstrações a partir do
// Plano Padrão, mas empresas que vêm de outro sistema contábil têm o
// plano delas. O de-para traduz o código de origem para o código do
// Padrão, e a partir daí é tudo igual — mesma estrutura, mesma DFC,
// mesmos indicadores.
//
// Duas fontes, nesta ordem:
//
//   1. `depara_contas`  conta a conta. Preciso, para a estrutura.
//   2. `depara_regras`  em volume: "toda conta 4-Cli. Nac. desta empresa
//      cai na conta X do Padrão". É o que torna viável um plano de
//      terceiro com dezenas de milhares de clientes e fornecedores —
//      ninguém vincula 100.000 contas uma a uma.
//
// O que NÃO tem vínculo mantém o código original. Some da demonstração
// (não casa com nenhuma classificação do Padrão) mas continua contável:
// `naoMapeadas` diz quantas contas com saldo ficaram de fora, e a tela
// de de-para lista quais.

import { supabase } from "@/integrations/supabase/client";
import { lerTudo } from "@/lib/supabase-paginado";

export interface Tradutor {
  /** código de origem -> código no Plano Padrão (ou o próprio, se sem vínculo) */
  traduzir(codigo: string): string;
  /** contas com saldo que não têm vínculo nenhum */
  naoMapeadas: string[];
  /** contas marcadas explicitamente como ignoradas no de-para */
  ignoradas: Set<string>;
}

interface LinhaTraducao {
  conta_codigo: string;
  conta_padrao_codigo: string | null;
  origem: "exato" | "regra" | "sem_vinculo";
  ignorada: boolean;
}

const cache = new Map<string, Promise<Tradutor | null>>();

export function limparCacheDepara(companyId?: string) {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}

/**
 * Devolve o tradutor da empresa, ou `null` quando não há tradução a
 * fazer (empresa que já usa o Plano Padrão). Cacheado por empresa: o
 * motor chama isto em toda leitura de saldo.
 */
export function getTradutor(companyId: string): Promise<Tradutor | null> {
  let p = cache.get(companyId);
  if (!p) {
    p = carregar(companyId);
    cache.set(companyId, p);
  }
  return p;
}

async function carregar(companyId: string): Promise<Tradutor | null> {
  // Só empresa de plano próprio traduz. Uma consulta barata evita a RPC
  // pesada em 99% dos casos.
  const { data: empresa, error: eErr } = await supabase
    .from("companies")
    .select("plano_tipo, tenant_id")
    .eq("id", companyId)
    .maybeSingle();
  if (eErr || !empresa) return null;
  if ((empresa as any).plano_tipo !== "proprio") return null;

  // Paginado: `depara_traducao` devolve uma linha por conta COM SALDO da
  // empresa. Sem paginar, o mapa vinha com as 1.000 primeiras e as
  // demais contas não eram traduzidas — o código de origem não existe no
  // Plano Padrão, o motor não encontra a conta e DESCARTA o saldo, sem
  // uma linha de aviso. Dinheiro sumindo do Balanço em silêncio.
  let data: any[] = [];
  let error: any = null;
  try {
    data = await lerTudo<any>(
      (de, ate) => (supabase as any)
        .rpc("depara_traducao", { _company_id: companyId })
        .range(de, ate),
      "depara_traducao",
    );
  } catch (e: any) {
    error = e;
  }
  if (error) {
    // Sem a migration aplicada o motor segue como antes: plano próprio.
    console.warn("[de-para] tradução indisponível:", error.message);
    return null;
  }

  const linhas = (data ?? []) as LinhaTraducao[];
  if (linhas.length === 0) return null;

  const mapa = new Map<string, string>();
  const naoMapeadas: string[] = [];
  const ignoradas = new Set<string>();
  for (const l of linhas) {
    if (l.ignorada) {
      ignoradas.add(l.conta_codigo);
      continue;
    }
    if (l.conta_padrao_codigo) mapa.set(l.conta_codigo, l.conta_padrao_codigo);
    else naoMapeadas.push(l.conta_codigo);
  }

  return {
    traduzir: (codigo: string) => mapa.get(codigo) ?? codigo,
    naoMapeadas,
    ignoradas,
  };
}

// ---------------------------------------------------------------------------
// Tradução REVERSA — do Plano Padrão de volta para os códigos da empresa.
//
// O drill-down precisa disto: a demonstração mostra a conta do Padrão,
// mas o lançamento está gravado com o código de origem. Sem o caminho de
// volta, clicar numa linha abre uma lista vazia.
// ---------------------------------------------------------------------------

export interface TradutorReverso {
  /** código do Padrão -> códigos de origem que caem nele */
  origensDe(codigoPadrao: string): string[];
  nomeDe(codigoOrigem: string): string | null;
}

const cacheReverso = new Map<string, Promise<TradutorReverso | null>>();

export function getTradutorReverso(companyId: string): Promise<TradutorReverso | null> {
  let p = cacheReverso.get(companyId);
  if (!p) {
    p = carregarReverso(companyId);
    cacheReverso.set(companyId, p);
  }
  return p;
}

async function carregarReverso(companyId: string): Promise<TradutorReverso | null> {
  const trad = await getTradutor(companyId);
  if (!trad) return null;

  const { data, error } = await (supabase as any).rpc("depara_traducao", {
    _company_id: companyId,
  });
  if (error) return null;

  const porPadrao = new Map<string, string[]>();
  for (const l of (data ?? []) as LinhaTraducao[]) {
    if (l.ignorada || !l.conta_padrao_codigo) continue;
    const arr = porPadrao.get(l.conta_padrao_codigo) ?? [];
    arr.push(l.conta_codigo);
    porPadrao.set(l.conta_padrao_codigo, arr);
  }

  // nomes das contas de origem, para a lista do drill-down
  const nomes = new Map<string, string>();
  const codigos = Array.from(new Set([...porPadrao.values()].flat()));
  const LOTE = 500;
  for (let i = 0; i < codigos.length; i += LOTE) {
    const { data: rows } = await supabase
      .from("plano_contas")
      .select("codigo, descricao")
      .eq("company_id", companyId)
      .in("codigo", codigos.slice(i, i + LOTE));
    for (const r of (rows ?? []) as { codigo: string; descricao: string }[]) {
      nomes.set(r.codigo, r.descricao);
    }
  }

  return {
    origensDe: (cod) => porPadrao.get(cod) ?? [],
    nomeDe: (cod) => nomes.get(cod) ?? null,
  };
}
