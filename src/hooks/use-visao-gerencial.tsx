import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useIsDemo } from "@/lib/demo/context";

export type Visao = "contabil" | "gerencial" | "comparativo";

const STORAGE_KEY = "orkestria:visao";

interface Ctx {
  visao: Visao;
  setVisao: (v: Visao) => void;
}

const VisaoContext = createContext<Ctx>({ visao: "contabil", setVisao: () => {} });

export function VisaoGerencialProvider({ children }: { children: ReactNode }) {
  const isDemo = useIsDemo();
  const storageKey = isDemo ? `${STORAGE_KEY}:demo` : STORAGE_KEY;
  const [visao, setVisaoState] = useState<Visao>("contabil");

  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v === "gerencial" || v === "contabil" || v === "comparativo") setVisaoState(v);
    } catch {}
  }, [storageKey]);

  const setVisao = (v: Visao) => {
    setVisaoState(v);
    try {
      localStorage.setItem(storageKey, v);
    } catch {}
  };

  return <VisaoContext.Provider value={{ visao, setVisao }}>{children}</VisaoContext.Provider>;
}

export function useVisaoGerencial() {
  return useContext(VisaoContext);
}
