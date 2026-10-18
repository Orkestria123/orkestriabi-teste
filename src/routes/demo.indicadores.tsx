import { createFileRoute } from "@tanstack/react-router";
import { Page } from "./dashboard.indicadores";
import { demoHead } from "@/lib/demo/head";
export const Route = createFileRoute("/demo/indicadores")({head:()=>demoHead("Indicadores"),component:Page});