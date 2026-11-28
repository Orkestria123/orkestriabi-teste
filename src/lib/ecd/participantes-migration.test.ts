import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../../drizzle/migrations/0076_ecd_participantes_identidade_origem.sql", import.meta.url), "utf8");
const colisoes = readFileSync(new URL("../../../drizzle/migrations/0080_ecd_participantes_separar_colisoes.sql", import.meta.url), "utf8");
const diario = readFileSync(new URL("../../../drizzle/migrations/0079_ecd_participantes_agrupados_sem_pai_direto.sql", import.meta.url), "utf8");

describe("contrato da rotina ECD de participantes", () => {
  it("usa o código completo da origem, sem consolidar códigos com o mesmo sufixo", () => {
    expect(sql).toContain("THEN 'C' ELSE 'F' END||codigo");
    expect(sql).not.toContain("string_to_array");
  });
  it("mantém cada participante e vínculo dentro da empresa autorizada", () => {
    expect(sql).toContain("public.pode_gerenciar_tenant(_tenant)");
    expect(sql).toContain("WHERE d.company_id=_company AND d.conta_codigo=t.ecd_cod");
  });
  it("não troca decisões individuais ou contas ignoradas ao reaplicar a ECD", () => {
    expect(sql).toContain("WHERE NOT b.ignorada AND b.destino_empresa IS NULL");
    expect(sql).toContain("public.ecd_vinculo_do_robo(b.observacao)");
  });
  it("separa códigos distintos da mesma empresa que colidiram numa conta individual", () => {
    expect(colisoes).toContain("d2.company_id=_company");
    expect(colisoes).toContain("d2.conta_codigo<>c.codigo");
    expect(colisoes).toContain("AND e2.tipo='A'");
  });
  it("remove o encerramento inteiro também quando atualiza o diário por destinos", () => {
    expect(diario).toContain("$new$NOT COALESCE(l.encerramento, false)$new$");
  });
});