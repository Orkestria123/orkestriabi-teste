import { useQuery } from "@tanstack/react-query";
import { montarReceitaDespesaDetalhado, type ReceitaDespesaDetalhado } from "@/lib/analise-receita-despesa";

const CACHE = { staleTime: 30 * 60 * 1000, gcTime: 60 * 60 * 1000 };

export function useReceitaDespesaDetalhado(
  companyId: string | null,
  competencias: string[],
  ativo = true,
) {
  return useQuery<ReceitaDespesaDetalhado>({
    queryKey: ["receita-despesa", 2, companyId, competencias.join(",")],
    enabled: ativo && !!companyId && competencias.length > 0,
    queryFn: () => montarReceitaDespesaDetalhado(companyId!, competencias),
    ...CACHE,
  });
}

export function useReceitaDespesaPorPeriodo(
  companyId: string | null,
  competenciasPorPeriodo: { periodo: string; competencias: string[] }[],
  ativo = true,
) {
  return useQuery({
    queryKey: [
      "receita-despesa-periodos",
      companyId,
      competenciasPorPeriodo.map((p) => `${p.periodo}:${p.competencias.join("|")}`).join(";"),
    ],
    enabled: ativo && !!companyId && competenciasPorPeriodo.length > 0,
    queryFn: async () => {
      const resultados = await Promise.all(
        competenciasPorPeriodo.map(async (p) => ({
          periodo: p.periodo,
          dados: await montarReceitaDespesaDetalhado(companyId!, p.competencias),
        })),
      );
      return resultados;
    },
    ...CACHE,
  });
}
