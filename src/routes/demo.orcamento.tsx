import { createFileRoute } from "@tanstack/react-router";
import { OrcamentoAnalise } from "./dashboard.orcamento";
import { demoHead } from "@/lib/demo/head";
export const Route = createFileRoute("/demo/orcamento")({head:()=>demoHead("Orçamento"),component:OrcamentoAnalise});