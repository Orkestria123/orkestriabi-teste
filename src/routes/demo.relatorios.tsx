import { createFileRoute } from "@tanstack/react-router";
import { Page } from "./dashboard.relatorios";
import { demoHead } from "@/lib/demo/head";
export const Route = createFileRoute("/demo/relatorios")({head:()=>demoHead("Relatórios Executivos"),component:Page});