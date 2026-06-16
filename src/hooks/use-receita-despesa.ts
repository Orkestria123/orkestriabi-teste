import { useQuery } from "@tanstack/react-query";
import { montarReceitaDespesaDetalhado, type ReceitaDespesaDetalhado } from "@/lib/analise-receita-despesa";

export function useReceitaDespesaDetalhado(companyId: string | null, competencias: string[]) {
  return useQuery<ReceitaDespesaDetalhado>({
    queryKey: ["receita-despesa", companyId, competencias.join(",")],
    enabled: !!companyId && competencias.length > 0,
    queryFn: () => montarReceitaDespesaDetalhado(companyId!, competencias),
  });
}

export function useReceitaDespesaPorPeriodo(
  companyId: string | null,
  competenciasPorPeriodo: { periodo: string; competencias: string[] }[],
) {
  return useQuery({
    queryKey: [
      "receita-despesa-periodos",
      companyId,
      competenciasPorPeriodo.map((p) => `${p.periodo}:${p.competencias.join("|")}`).join(";"),
    ],
    enabled: !!companyId && competenciasPorPeriodo.length > 0,
    queryFn: async () => {
      const resultados = await Promise.all(
        competenciasPorPeriodo.map(async (p) => ({
          periodo: p.periodo,
          dados: await montarReceitaDespesaDetalhado(companyId!, p.competencias),
        })),
      );
      return resultados;
    },
  });
}
