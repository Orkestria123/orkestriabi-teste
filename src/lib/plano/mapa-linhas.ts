// Mapa "prefixo de classificação -> linha da demonstração".
//
// Sucede o `mapa-marcos.ts`, que derivava as linhas dos MARCOS — a
// etiqueta manual em ~25 contas. Os marcos deixaram de existir: a
// estrutura vem do próprio plano (as sintéticas do nível em que o
// escritório fecha o resultado) e os nomes de apresentação vêm do
// `estrutura_padrao`.
//
// Existe como módulo separado porque três lugares precisam da mesma
// coisa: o motor de demonstrações, a DRE orçada e a análise de
// receita/despesa. Quando a `mapeamento_demonstracao` foi removida, o
// motor foi migrado e os outros dois ficaram consultando uma tabela
// inexistente — quebrando em silêncio. Uma fonte só evita repetir isso.

import { supabase } from "@/integrations/supabase/client";
import { getEstruturaPadrao, compararClassificacao } from "@/lib/plano/estrutura";

export type Demonstracao = "DRE" | "BP_ATIVO" | "BP_PASSIVO";

export interface MapaLinha {
  classificacao_prefixo: string;
  linha_demonstracao: string;
  ordem: number;
  inverter_sinal: boolean;
}

const TIPOS: Record<Demonstracao, string[]> = {
  DRE: ["3-DRE"],
  BP_ATIVO: ["1-Ativo"],
  BP_PASSIVO: ["2-Passivo"],
};

/** Segmento de apuração: `.98`/`.99` — subtotal, não recebe lançamento. */
function ehApuracao(classificacao: string): boolean {
  return classificacao
    .split(/[.\-/]/)
    .slice(1)
    .some((seg) => seg === "98" || seg === "99");
}

export async function getMapaDeLinhas(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  demonstracao: Demonstracao,
): Promise<MapaLinha[]> {
  const q = supabase
    .from("plano_contas")
    .select("classificacao, descricao, nivel")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .eq("is_participante", false)
    .eq("is_sintetica", true)
    .in("tipo", TIPOS[demonstracao]);
  const { data, error } = modoGlobal
    ? await q.is("company_id", null)
    : await q.eq("company_id", companyId);
  if (error) throw error;

  const rows = (data ?? []) as { classificacao: string; descricao: string; nivel: number }[];
  const estrutura = await getEstruturaPadrao();

  const acumuladores = rows.filter((r) => ehApuracao(r.classificacao));
  const candidatas = rows.filter((r) => !ehApuracao(r.classificacao));
  if (candidatas.length === 0) return [];

  // Mesmo critério do motor: na DRE o nível de desenho é o dos
  // acumuladores; senão o mais raso, pulando a raiz única.
  const niveis = Array.from(new Set(candidatas.map((r) => r.nivel))).sort((a, b) => a - b);
  const nRaiz = niveis[0];
  const qtdNaRaiz = candidatas.filter((r) => r.nivel === nRaiz).length;
  const nSeguinte = niveis.find((n) => n > nRaiz);
  let nivel = qtdNaRaiz === 1 && nSeguinte !== undefined ? nSeguinte : nRaiz;
  if (demonstracao === "DRE" && acumuladores.length > 0) {
    const freq = new Map<number, number>();
    for (const a of acumuladores) freq.set(a.nivel, (freq.get(a.nivel) ?? 0) + 1);
    let maior = -1;
    for (const [n, q2] of freq) {
      if (q2 > maior || (q2 === maior && n < nivel)) {
        maior = q2;
        nivel = n;
      }
    }
  }

  const linhas = candidatas
    .filter((r) => r.nivel === nivel)
    .sort((a, b) => compararClassificacao(a.classificacao, b.classificacao));

  return linhas.map((r, i) => {
    const def = estrutura.find(
      (e) =>
        e.classificacao === r.classificacao &&
        e.demonstracao === demonstracao &&
        e.tipo_linha === "detalhe" &&
        e.rotulo,
    );
    return {
      classificacao_prefixo: r.classificacao,
      linha_demonstracao: def?.rotulo ?? r.descricao,
      ordem: (i + 1) * 10,
      // Resultado e Passivo/PL têm saldo credor: exibem positivo.
      inverter_sinal: demonstracao !== "BP_ATIVO",
    };
  });
}
