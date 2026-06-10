import { createFileRoute } from "@tanstack/react-router";
import { makeStatementPage } from "./dashboard.dre";
export const Route = createFileRoute("/dashboard/dva")({
  component: makeStatementPage("DVA", "Demonstração do Valor Adicionado"),
});
