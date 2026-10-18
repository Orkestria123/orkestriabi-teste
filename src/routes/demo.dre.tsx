import { createFileRoute } from "@tanstack/react-router";
import { makeStatementPage } from "./dashboard.dre";
import { demoHead } from "@/lib/demo/head";
export const Route = createFileRoute("/demo/dre")({head:()=>demoHead("DRE"),component:makeStatementPage("DRE","Demonstração do Resultado (DRE)","Receita Bruta",{categoryFilter:true})});