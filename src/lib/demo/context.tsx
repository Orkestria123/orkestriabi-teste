import { createContext, useContext, type ReactNode } from "react";

const DemoContext = createContext(false);
export function DemoProvider({ children }: { children: ReactNode }) {
  return <DemoContext.Provider value={true}>{children}</DemoContext.Provider>;
}
export function useIsDemo() { return useContext(DemoContext); }
export function isDemoLocation() {
  return typeof window !== "undefined" && (window.location.pathname === "/demo" || window.location.pathname.startsWith("/demo/"));
}
export const DEMO_TENANT = "demo-open";
export const DEMO_COMPANY = "modelo";