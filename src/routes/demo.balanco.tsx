import { createFileRoute } from "@tanstack/react-router";
import { Page } from "./dashboard.balanco";
import { demoHead } from "@/lib/demo/head";
export const Route = createFileRoute("/demo/balanco")({head:()=>demoHead("Balanço Patrimonial"),component:Page});