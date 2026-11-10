import { beforeEach, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({ linhas: [] as { conta_codigo: string; conta_padrao_codigo: string; ignorada: boolean }[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (tabela: string) => {
    const q: any = {
      select: () => q, eq: () => q, order: () => q, limit: () => q, gt: () => q,
      maybeSingle: async () => ({ data: { plano_tipo: "padrao" }, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: tabela === "depara_contas" ? banco.linhas : [], error: null }).then(resolve),
    };
    return q;
  },
} }));
import { getTradutor, limparCacheDepara } from "./depara";
beforeEach(() => { limparCacheDepara(); banco.linhas = []; });
it("alteração direta no Diário aplica exceção também no Plano Padrão", async () => {
  banco.linhas = [{ conta_codigo: "512125", conta_padrao_codigo: "AGG-2.01.01.01.01.01", ignorada: false }];
  const t = await getTradutor("rota");
  expect(t?.traduzir("512125")).toBe("AGG-2.01.01.01.01.01");
  expect(t?.traduzir("100000")).toBe("100000");
});
it("mapeamentos de uma empresa não alteram outra sem exceções", async () => {
  banco.linhas = [{ conta_codigo: "512125", conta_padrao_codigo: "AGG-2.01.01.01.01.01", ignorada: false }];
  await getTradutor("rota"); banco.linhas = [];
  expect(await getTradutor("outra")).toBeNull();
});