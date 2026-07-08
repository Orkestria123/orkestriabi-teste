import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Visao = "contabil" | "gerencial" | "comparativo";

const STORAGE_KEY = "orkestria:visao";

interface Ctx {
  visao: Visao;
  setVisao: (v: Visao) => void;
}

const VisaoContext = createContext<Ctx>({ visao: "contabil", setVisao: () => {} });

export function VisaoGerencialProvider({ children }: { children: ReactNode }) {
  const [visao, setVisaoState] = useState<Visao>("contabil");

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "gerencial" || v === "contabil" || v === "comparativo") setVisaoState(v);
    } catch {}
  }, []);

  const setVisao = (v: Visao) => {
    setVisaoState(v);
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {}
  };

  return <VisaoContext.Provider value={{ visao, setVisao }}>{children}</VisaoContext.Provider>;
}

export function useVisaoGerencial() {
  return useContext(VisaoContext);
}
