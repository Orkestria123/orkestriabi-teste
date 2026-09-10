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
import { lerRpcKeyset } from "@/lib/supabase-paginado";

export interface Tradutor {
  /** código de origem -> código no Plano Padrão (ou o próprio, se sem vínculo) */
  traduzir(codigo: string): string;
  /** contas com saldo que não têm vínculo nenhum */
  naoMapeadas: string[];
  /** contas marcadas explicitamente como ignoradas no de-para */
  ignoradas: Set<string>;
}

type LinhaTraducao = {
  conta_codigo: string;
  conta_padrao_codigo: string | null;
  origem: "exato" | "regra" | "sem_vinculo";
  ignorada: boolean;
};

export interface TradutorReverso {
  origensDe(codigoPadrao: string): string[];
  nomeDe(codigoOrigem: string): string | null;
}

const cache = new Map<string, Promise<Tradutor | null>>();
const cacheReverso = new Map<string, Promise<TradutorReverso | null>>();
const cacheLinhas = new Map<string, LinhaTraducao[]>();

export function limparCacheDepara(companyId?: string) {
  if (companyId) {
    cache.delete(companyId);
    cacheReverso.delete(companyId);
    cacheLinhas.delete(companyId);
  } else {
    cache.clear();
    cacheReverso.clear();
    cacheLinhas.clear();
  }
}

export type ItemDepara = {
  conta_codigo: string;
  conta_padrao_codigo: string | null;
  ignorada?: boolean;
  observacao?: string | null;
};

const LOTE_GRAVACAO = 400;

/**
 * Grava o de-para e confere no banco. Sem essa conferência a tela
 * parecia ter salvo (o seletor já mostrava o destino) e a DRE seguia
 * zerada — o vínculo nunca tinha saído do estado local.
 */
export async function aplicarDeparaConfirmado(
  companyId: string,
  itens: ItemDepara[],
): Promise<{ gravadas: number; limpas: number }> {
  if (itens.length === 0) return { gravadas: 0, limpas: 0 };

  let gravadas = 0;
  let limpas = 0;
  for (let i = 0; i < itens.length; i += LOTE_GRAVACAO) {
    const fatia = itens.slice(i, i + LOTE_GRAVACAO);
    const { data, error } = await supabase.rpc("aplicar_depara_em_lote", {
      _company_id: companyId,
      _itens: fatia as any,
    });
    if (error) throw error;
    gravadas += Number((data as any)?.gravadas ?? 0);
    limpas += Number((data as any)?.limpas ?? 0);
  }

  if (gravadas === 0 && limpas === 0) {
    const soLimpar = itens.every((it) => !it.conta_padrao_codigo && !it.ignorada);
    if (!soLimpar) {
      throw new Error("Nada foi gravado. Recarregue e tente de novo.");
    }
    limparCacheDepara(companyId);
    return { gravadas: 0, limpas: 0 };
  }

  const aConfirmar = itens
    .filter((it) => !!it.conta_padrao_codigo || !!it.ignorada)
    .slice(0, 80)
    .map((it) => it.conta_codigo);
  if (aConfirmar.length > 0) {
    const { data, error } = await supabase
      .from("depara_contas")
      .select("conta_codigo")
      .eq("company_id", companyId)
      .in("conta_codigo", aConfirmar);
    if (error) throw error;
    const tem = new Set((data ?? []).map((r: { conta_codigo: string }) => r.conta_codigo));
    const faltando = aConfirmar.filter((c) => !tem.has(c));
    if (faltando.length > 0) {
      throw new Error(
        `O banco não confirmou ${faltando.length} vínculo(s). Recarregue a página e tente de novo.`,
      );
    }
  }

  const aLimpar = itens
    .filter((it) => !it.conta_padrao_codigo && !it.ignorada)
    .slice(0, 80)
    .map((it) => it.conta_codigo);
  if (aLimpar.length > 0) {
    const { data, error } = await supabase
      .from("depara_contas")
      .select("conta_codigo")
      .eq("company_id", companyId)
      .in("conta_codigo", aLimpar);
    if (error) throw error;
    if ((data ?? []).length > 0) {
      throw new Error("A limpeza não confirmou no banco. Recarregue e tente de novo.");
    }
  }

  limparCacheDepara(companyId);
  return { gravadas, limpas };
}

/**
 * Devolve o tradutor da empresa, ou `null` quando não há tradução a
 * fazer (empresa que já usa o Plano Padrão). Cacheado por empresa: o
 * motor chama isto em toda leitura de saldo.
 *
 * O `plano_tipo` é lido SEMPRE — o cache antigo guardava o resultado
 * da primeira visita. Trocar "Outro sistema" → "Plano Padrão" sem
 * recarregar a página traduzia códigos do Padrão como se fossem de
 * origem e os indicadores/DRE zeravam.
 */
export async function getTradutor(companyId: string): Promise<Tradutor | null> {
  const { data: empresa, error: eErr } = await supabase
    .from("companies")
    .select("plano_tipo")
    .eq("id", companyId)
    .maybeSingle();
  if (eErr || !empresa || (empresa as any).plano_tipo !== "proprio") {
    limparCacheDepara(companyId);
    return null;
  }
  let p = cache.get(companyId);
  if (!p) {
    p = carregar(companyId).catch((e) => {
      cache.delete(companyId);
      cacheLinhas.delete(companyId);
      throw e;
    });
    cache.set(companyId, p);
  }
  return p;
}

async function carregar(companyId: string): Promise<Tradutor | null> {

  // Keyset: `.range` no RPC remontava a consulta inteira a cada página
  // (PostgREST aplica LIMIT/OFFSET DEPOIS). Com ~1.700 contas isso era
  // duas execuções completas — e cada uma podia estourar os 8s da nuvem.
  const linhas = await lerRpcKeyset<LinhaTraducao>(
    "conta_codigo",
    (depois) =>
      (supabase as any).rpc("depara_traducao_pagina", {
        _company_id: companyId,
        _depois: depois,
        _limite: 1000,
      }),
    "depara_traducao",
  );
  cacheLinhas.set(companyId, linhas);
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

export function getTradutorReverso(companyId: string): Promise<TradutorReverso | null> {
  let p = cacheReverso.get(companyId);
  if (!p) {
    p = carregarReverso(companyId).catch((e) => {
      cacheReverso.delete(companyId);
      throw e;
    });
    cacheReverso.set(companyId, p);
  }
  return p;
}

async function carregarReverso(companyId: string): Promise<TradutorReverso | null> {
  const trad = await getTradutor(companyId);
  if (!trad) return null;

  const data = cacheLinhas.get(companyId) ?? [];

  const porPadrao = new Map<string, string[]>();
  for (const l of data) {
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
