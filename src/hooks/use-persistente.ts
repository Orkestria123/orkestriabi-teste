import { useCallback, useEffect, useState } from "react";
import { useIsDemo } from "@/lib/demo/context";

/** useState que sobrevive à troca de tela (guardado na sessão do navegador). */
export function usePersistente<T>(chave: string, inicial: T) {
  const demo = useIsDemo();
  const k = `orkestria:${demo ? "demo:" : ""}sel:${chave}`;
  const [v, setV] = useState<T>(inicial);
  useEffect(() => {
    try {
      const s = sessionStorage.getItem(k);
      if (s != null) setV(JSON.parse(s));
    } catch {}
  }, [k]);
  const set = useCallback((n: T | ((p: T) => T)) => {
    setV((p) => {
      const val = typeof n === "function" ? (n as (p: T) => T)(p) : n;
      try { sessionStorage.setItem(k, JSON.stringify(val)); } catch {}
      return val;
    });
  }, [k]);
  return [v, set] as const;
}
