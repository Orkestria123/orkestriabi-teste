// As contas que podem ser DESTINO de um de-para.
//
// Uma consulta só, compartilhada por todas as telas que fazem de-para
// (ECD e plano de contas) — mesma queryKey, mesmo cache. Antes o ECD
// tinha a sua própria busca no servidor, que ia ao banco a cada tecla,
// exigia 3 caracteres e não excluía participantes: podia varrer as
// 135.000 contas de cliente/fornecedor do plano do escritório.
//
// O universo real de destino é pequeno (~950 contas da ESTRUTURA).
// Cliente e fornecedor não são destino individual: entram pela conta
// agregadora ("CLIENTES NACIONAIS (consolidado)"), via regra em volume.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ContaDestino } from "@/lib/contas/busca";
import { lerTudo } from "@/lib/supabase-paginado";

export function useContasDestino(tenantId: string | null | undefined) {
  return useQuery({
    // Mesma chave usada pelo painel de de-para do plano: as duas telas
    // dividem uma única ida ao servidor.
    queryKey: ["plano-padrao-destinos", tenantId],
    enabled: !!tenantId,
    // O plano padrão do escritório muda raramente; não vale refazer a
    // consulta a cada foco de janela no meio de um de-para longo.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const out: ContaDestino[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("plano_contas")
          .select("codigo, classificacao, descricao, tipo")
          .eq("tenant_id", tenantId!)
          .is("company_id", null)
          .eq("is_sintetica", false)
          .eq("is_participante", false)
          .eq("ativo", true)
          .order("classificacao")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        out.push(...((data ?? []) as ContaDestino[]));
        if (!data || data.length < PAGE) break;
      }

      // Quantos participantes cada agregadora representa.
      //
      // Vem do servidor porque a contagem é sobre 135.000 linhas — o que
      // NÃO se faz é trazer essas linhas para contar aqui. São 4 linhas
      // de resposta, lidas de índice.
      //
      // Falhar aqui não pode derrubar o seletor: sem a contagem ele
      // funciona igual, só não mostra o "consolida N contas".
      try {
        const { data: agg } = await (supabase as any)
          .rpc("plano_agregadoras", { _tenant_id: tenantId });
        const porClasse = new Map<string, number>(
          ((agg ?? []) as any[]).map((a) => [a.classificacao, Number(a.participantes) || 0]),
        );
        for (const c of out) {
          if (c.codigo.startsWith("AGG-")) {
            c.participantes = porClasse.get(c.classificacao ?? "") ?? null;
          }
        }
      } catch {
        /* sem contagem, o seletor continua inteiro */
      }
      // O GALHO de cada destino: onde ele cai na demonstração e qual
      // código de DFC resolve. Vem do servidor porque é uma junção entre
      // 950 folhas e 199 sintéticas — não é coisa de navegador.
      try {
        const grupos = await lerTudo<any>(
          (de, ate) => (supabase as any)
            .rpc("plano_grupos_destino", { _tenant_id: tenantId, _company_id: null })
            .range(de, ate),
          "plano_grupos_destino",
        );
        const porClasse = new Map(grupos.map((g: any) => [g.classificacao, g]));
        for (const c of out) {
          const g = porClasse.get(c.classificacao ?? "");
          if (!g) continue;
          c.galho = g.galho ?? null;
          c.demonstracao = g.demonstracao ?? null;
          c.dfc = g.codigo_dfc ?? null;
          c.dfcDescricao = g.descricao_dfc ?? null;
        }
      } catch {
        /* sem galho, o seletor continua funcionando como antes */
      }
      return out;
    },
  });
}
