// A lista de indicadores que UMA empresa vê.
//
// Depois do ajuste 28 a definição é do escritório (`company_id IS NULL`) e
// a empresa apenas ALOCA — escolhe quais ficam visíveis e onde. Ler
// direto de `indicadores_empresa` com `.eq("company_id", …)` passou a ser
// errado: acha só as cópias locais que ainda restam e perde todas as
// definições globais.
//
// A regra da visibilidade mora no banco (`indicadores_da_empresa`), e não
// em cada tela, justamente para as três telas não divergirem:
//
//     visibilidade efetiva = alocação da empresa, se houver
//                            senão a do próprio indicador
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface IndicadorDaEmpresa {
  id: string;
  nome: string;
  categoria: string;
  formula: any;
  modo_analise: string;
  faixas: any;
  descricao: string | null;
  visibilidade: "invisivel" | "indicadores" | "dashboard" | "ambos";
  is_padrao: boolean;
  revisar_contas: boolean;
  ordem: number;
  /** "global" = definição do escritório; "empresa" = cópia local. */
  escopo: "global" | "empresa";
  /** Tem linha em `indicador_alocacao` para esta empresa. */
  alocado: boolean;
}

export const CHAVE_INDICADORES = (companyId?: string | null) =>
  ["indicadores-da-empresa", companyId] as const;

export function useIndicadoresDaEmpresa(companyId: string | null | undefined) {
  return useQuery({
    queryKey: CHAVE_INDICADORES(companyId),
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("indicadores_da_empresa", {
        _company_id: companyId,
      });
      if (error) throw error;
      return ((data ?? []) as IndicadorDaEmpresa[]).sort(
        (a, b) =>
          (a.categoria ?? "").localeCompare(b.categoria ?? "") ||
          (a.ordem ?? 0) - (b.ordem ?? 0) ||
          a.nome.localeCompare(b.nome),
      );
    },
  });
}

/** Grava a visibilidade de vários indicadores nesta empresa, de uma vez. */
export async function alocarIndicadores(
  companyId: string,
  itens: { indicador_id: string; visibilidade: string; ordem?: number | null }[],
) {
  // `ordem: null` no JSON faz o PostgREST recusar o lote inteiro.
  // Tirar do dashboard mandava null; colocar mandava número — só o colocar ia.
  const _itens = itens.map(({ indicador_id, visibilidade, ordem }) => {
    const row: { indicador_id: string; visibilidade: string; ordem?: number } = {
      indicador_id,
      visibilidade,
    };
    if (typeof ordem === "number") row.ordem = ordem;
    return row;
  });
  const { data, error } = await (supabase as any).rpc("indicador_alocar", {
    _company_id: companyId,
    _itens,
  });
  if (error) throw new Error(error.message);
  const r = data as { gravadas: number };
  if (!r || r.gravadas === 0) {
    throw new Error("Nada foi gravado. Recarregue a página e tente de novo.");
  }
  return r;
}
