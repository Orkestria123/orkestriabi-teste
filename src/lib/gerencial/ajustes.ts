// Motor de ajustes gerenciais (Etapa 3 do módulo Visão Gerencial).
//
// Responsabilidades:
//   1. Carregar os ajustes gerenciais (partida dobrada) e as contas
//      gerenciais da empresa.
//   2. Resolver a classificação de cada conta usada nos ajustes
//      (conta contábil → plano_contas; conta gerencial "G..." →
//      contas_gerenciais).
//   3. Fornecer helpers para converter ajustes em "saldos virtuais"
//      no mesmo shape do motor contábil (build-statements.ts), para
//      que a montagem de DRE/BP no modo GERENCIAL reaproveite toda a
//      máquina existente (mapeamento, sinal, hierarquia, resultado
//      do exercício, agregação).
//
// A ótica gerencial = contábil + efeito dos ajustes. Cada ajuste é uma
// partida dobrada (D=C), portanto o Balanço continua fechando.

import { supabase } from "@/integrations/supabase/client";

export interface AjusteResolvido {
  id: string;
  competencia: string;         // YYYY-MM-01
  descricao: string;
  conta_debito: string;
  conta_credito: string;
  valor: number;
  // resoluções (podem ser null se a conta foi removida)
  debito: ContaResolvida | null;
  credito: ContaResolvida | null;
}

export interface ContaResolvida {
  codigo: string;
  descricao: string;
  classificacao: string;
  origem: "plano" | "gerencial";
}

export interface ContaGerencial {
  codigo: string;
  descricao: string;
  classificacao: string;
}

export interface AjustesGerenciaisData {
  ajustes: AjusteResolvido[];
  contasGerenciais: ContaGerencial[];
}

/**
 * Carrega todos os ajustes gerenciais + contas gerenciais da empresa
 * e resolve a classificação de cada conta usada nos ajustes.
 *
 * Ainda NÃO filtra por período — o motor consumidor filtra depois,
 * porque a regra é diferente para DRE (fluxo do período) vs. BP
 * (acumulado até a competência).
 */
export async function getAjustesGerenciais(
  companyId: string,
  tenantId: string,
): Promise<AjustesGerenciaisData> {
  const [ajustesRes, gerRes] = await Promise.all([
    supabase
      .from("ajustes_gerenciais")
      .select("id, competencia, descricao, conta_debito, conta_credito, valor")
      .eq("company_id", companyId),
    supabase
      .from("contas_gerenciais")
      .select("codigo, descricao, classificacao")
      .eq("company_id", companyId),
  ]);
  if (ajustesRes.error) throw ajustesRes.error;
  if (gerRes.error) throw gerRes.error;

  const contasGerenciais: ContaGerencial[] = ((gerRes.data ?? []) as any[]).map(
    (r) => ({
      codigo: r.codigo,
      descricao: r.descricao,
      classificacao: r.classificacao,
    }),
  );
  const gerMap = new Map<string, ContaGerencial>();
  for (const c of contasGerenciais) gerMap.set(c.codigo, c);

  const rows = (ajustesRes.data ?? []) as any[];
  // Descobrir contas contábeis referenciadas (todo código que não é gerencial)
  const codigosContabeis = new Set<string>();
  for (const a of rows) {
    if (!gerMap.has(a.conta_debito)) codigosContabeis.add(a.conta_debito);
    if (!gerMap.has(a.conta_credito)) codigosContabeis.add(a.conta_credito);
  }

  const planoResolvido = new Map<string, { classificacao: string; descricao: string }>();
  if (codigosContabeis.size > 0) {
    const codes = Array.from(codigosContabeis);
    // .in() em lotes para evitar URLs muito grandes
    for (let i = 0; i < codes.length; i += 500) {
      const lote = codes.slice(i, i + 500);
      const { data, error } = await supabase
        .from("plano_contas")
        .select("codigo, classificacao, descricao")
        .eq("tenant_id", tenantId)
        .in("codigo", lote);
      if (error) throw error;
      for (const r of (data ?? []) as any[]) {
        planoResolvido.set(r.codigo, {
          classificacao: r.classificacao,
          descricao: r.descricao,
        });
      }
    }
  }

  const resolver = (codigo: string): ContaResolvida | null => {
    const g = gerMap.get(codigo);
    if (g) {
      return {
        codigo,
        descricao: g.descricao,
        classificacao: g.classificacao,
        origem: "gerencial",
      };
    }
    const p = planoResolvido.get(codigo);
    if (p) {
      return {
        codigo,
        descricao: p.descricao,
        classificacao: p.classificacao,
        origem: "plano",
      };
    }
    return null;
  };

  const ajustes: AjusteResolvido[] = rows.map((r) => ({
    id: r.id,
    competencia: r.competencia,
    descricao: r.descricao,
    conta_debito: r.conta_debito,
    conta_credito: r.conta_credito,
    valor: Number(r.valor) || 0,
    debito: resolver(r.conta_debito),
    credito: resolver(r.conta_credito),
  }));

  return { ajustes, contasGerenciais };
}

// ---------------------------------------------------------------------
// Conversão em "saldos virtuais" (mesmo shape de saldos_mensais)
// ---------------------------------------------------------------------

export interface SaldoVirtual {
  conta_codigo: string;
  competencia: string;
  total_debitos: number;
  total_creditos: number;
  movimento: number;
}

/**
 * Cada ajuste (partida dobrada) vira DOIS registros de saldo:
 *   - conta a débito:  D=valor, C=0,     movimento=+valor
 *   - conta a crédito: D=0,     C=valor, movimento=-valor
 *
 * O motor contábil aplica então normalmente inverter_sinal e agregação.
 */
export function ajustesToSaldosVirtuais(
  ajustes: AjusteResolvido[],
  filter: (competencia: string) => boolean,
): SaldoVirtual[] {
  const out: SaldoVirtual[] = [];
  for (const a of ajustes) {
    if (!filter(a.competencia)) continue;
    if (!a.debito || !a.credito) continue; // conta removida — ignora
    out.push({
      conta_codigo: a.conta_debito,
      competencia: a.competencia,
      total_debitos: a.valor,
      total_creditos: 0,
      movimento: a.valor,
    });
    out.push({
      conta_codigo: a.conta_credito,
      competencia: a.competencia,
      total_debitos: 0,
      total_creditos: a.valor,
      movimento: -a.valor,
    });
  }
  return out;
}

/**
 * Constrói entradas "virtuais" de plano_contas para as contas gerenciais.
 * A classificação recebe o código como sufixo (ex.: "2.01.G0001") para
 * que a conta apareça como uma folha dentro do grupo pai, preservando
 * a hierarquia da árvore.
 */
export interface PlanoVirtual {
  codigo: string;
  classificacao: string;
  descricao: string;
  nivel: number;
  is_participante: boolean;
}

export function contasGerenciaisToPlanoVirtual(
  contas: ContaGerencial[],
  separador = ".",
): PlanoVirtual[] {
  return contas.map((c) => {
    const classifExpandida = `${c.classificacao}${separador}${c.codigo}`;
    const nivel = classifExpandida.split(separador).length;
    return {
      codigo: c.codigo,
      classificacao: classifExpandida,
      descricao: c.descricao,
      nivel,
      is_participante: false,
    };
  });
}
