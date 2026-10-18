import { createFileRoute } from "@tanstack/react-router";
import { makeStatementPage } from "./dashboard.dre";

export const Route = createFileRoute("/dashboard/fluxo-de-caixa")({
  head: () => ({ meta: [
    { title: "Fluxo de Caixa — Orkestria BI" },
    { name: "description", content: "Demonstração do fluxo de caixa nas visões contábil, gerencial e comparativa." },
    { property: "og:title", content: "Fluxo de Caixa — Orkestria BI" },
    { property: "og:description", content: "Consulte e exporte os fluxos de caixa da empresa." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: makeStatementPage("DFC", "Demonstração do Fluxo de Caixa"),
});
