import { createFileRoute } from "@tanstack/react-router";
import { makeStatementPage } from "./dashboard.dre";
export const Route = createFileRoute("/dashboard/dlpa")({
  component: makeStatementPage("DLPA", "Demonstração de Lucros e Prejuízos Acumulados"),
});
