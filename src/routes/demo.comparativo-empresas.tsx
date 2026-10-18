import { createFileRoute } from "@tanstack/react-router";
import { Page } from "./dashboard.comparativo-empresas";
import { demoHead } from "@/lib/demo/head";
export const Route = createFileRoute("/demo/comparativo-empresas")({head:()=>demoHead("Consolidado Empresas"),component:Page});