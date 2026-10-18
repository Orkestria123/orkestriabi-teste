import { createFileRoute } from "@tanstack/react-router";
import { Page } from "./dashboard.analise";
import { demoHead } from "@/lib/demo/head";
export const Route = createFileRoute("/demo/analise")({head:()=>demoHead("Análise"),component:Page});