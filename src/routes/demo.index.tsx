import { createFileRoute } from "@tanstack/react-router";
import { DashboardHome } from "./dashboard.index";
import { demoHead } from "@/lib/demo/head";
export const Route = createFileRoute("/demo/")({head:()=>demoHead("Visão geral"),component:DashboardHome});