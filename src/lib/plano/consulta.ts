// Onde está o plano de contas desta empresa — em UM lugar só.
//
// Desde o ajuste 12 o plano do escritório mora em `company_id IS NULL`
// (Plano Padrão) e só empresa de sistema de terceiro tem plano próprio
// em `company_id = <id>`. Cinco telas ficaram consultando
// `.eq("company_id", companyId)` direto e, para quem usa o Plano Padrão,
// passaram a não achar conta nenhuma:
//
//   - drill-down (sumiram as analíticas e a tela travava)
//   - selo "balanço fecha"
//   - seletor de contas do dashboard
//   - painel de ajustes gerenciais (duas consultas)
//
// Não é para nenhuma tela decidir isso sozinha de novo. Quem precisa do
// plano chama `aplicarEscopoPlano`.

import { getEscopoPlano } from "@/lib/plano/escopo";

export interface EscopoConsulta {
  tenantId: string | null;
  /** true = plano no nível do escritório (company_id IS NULL) */
  modoGlobal: boolean;
  /** true = os códigos dos saldos precisam passar pelo de-para */
  usaDepara: boolean;
}

const cache = new Map<string, Promise<EscopoConsulta>>();

export function limparCacheEscopo(companyId?: string) {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}

export function getEscopoConsulta(companyId: string): Promise<EscopoConsulta> {
  let p = cache.get(companyId);
  if (!p) {
    p = getEscopoPlano(companyId)
      .then((e) => ({
        tenantId: e.tenant_id,
        modoGlobal: e.usa_plano_padrao,
        usaDepara: e.usa_depara,
      }))
      .catch(() => ({ tenantId: null, modoGlobal: false, usaDepara: false }));
    cache.set(companyId, p);
  }
  return p;
}

/**
 * Aplica tenant + escopo do plano a uma query de `plano_contas`.
 *
 * Síncrona de propósito: o builder do Supabase é "thenable", então
 * `await` numa função que devolvesse o builder EXECUTARIA a query ali
 * mesmo — e os filtros encadeados depois se perderiam. Resolva o escopo
 * antes:
 *
 * ```ts
 * const escopo = await getEscopoConsulta(companyId);
 * const { data } = await escoparPlano(
 *   supabase.from("plano_contas").select("codigo, descricao"),
 *   companyId,
 *   escopo,
 * ).eq("ativo", true);
 * ```
 */
export function escoparPlano<T>(query: T, companyId: string, escopo: EscopoConsulta): T {
  let q = query as any;
  if (escopo.tenantId) q = q.eq("tenant_id", escopo.tenantId);
  q = escopo.modoGlobal ? q.is("company_id", null) : q.eq("company_id", companyId);
  return q as T;
}

/**
 * Filtro de prefixo de classificação que o Postgres consegue indexar.
 *
 * `ilike('1.01%')` — que era o usado no drill-down — é insensível a
 * caixa, e por isso NÃO usa índice: vira varredura sequencial. Num plano
 * com 135.000 clientes e fornecedores, cada clique no drill-down varria
 * a tabela inteira. Classificação é numérica: `like` resolve igual e
 * usa índice.
 */
export function filtroPrefixo<T>(query: T, coluna: string, prefixo: string): T {
  const esc = prefixo.replace(/([%_\\])/g, "\\$1");
  return (query as any).or(
    `${coluna}.eq.${prefixo},${coluna}.like.${esc}.%`,
  ) as T;
}
