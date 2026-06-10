import { createFileRoute } from "@tanstack/react-router";
import { makeStatementPage } from "./dashboard.dre";
export const Route = createFileRoute("/dashboard/fluxo-de-caixa")({
  component: makeStatementPage("DFC", "Demonstração do Fluxo de Caixa"),
});
