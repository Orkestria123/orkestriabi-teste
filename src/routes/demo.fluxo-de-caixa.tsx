import { createFileRoute } from "@tanstack/react-router";
import { makeStatementPage } from "./dashboard.dre";
import { demoHead } from "@/lib/demo/head";
export const Route = createFileRoute("/demo/fluxo-de-caixa")({head:()=>demoHead("Fluxo de Caixa"),component:makeStatementPage("DFC","Demonstração do Fluxo de Caixa")});