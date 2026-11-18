import { expect, it } from "vitest";
import { resolverParticipantes } from "./plano-participantes";
it("keeps individual supplier codes under their shared parent", () => {
  const rows = ["500131", "500189"].map(codigo => ({ codigo, company_id: "supriaco", tipo: "5-For. Nac." }));
  expect(resolverParticipantes(rows, ["5-For. Nac."]).map(r => r.codigo)).toEqual(["500131", "500189"]);
});
it("resolves a company client exception before filtering suppliers", () => {
  const rows = [{codigo:"556653",company_id:"supriaco",tipo:"4-Cli. Nac."},{codigo:"556653",company_id:null,tipo:"5-For. Nac."}];
  expect(resolverParticipantes(rows,["5-For. Nac."])).toEqual([]);
  expect(resolverParticipantes(rows,["4-Cli. Nac."])).toHaveLength(1);
});