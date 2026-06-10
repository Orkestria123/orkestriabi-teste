import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const MONTHS = [
  { m: 1, label: "Jan" }, { m: 2, label: "Fev" }, { m: 3, label: "Mar" },
  { m: 4, label: "Abr" }, { m: 5, label: "Mai" }, { m: 6, label: "Jun" },
  { m: 7, label: "Jul" }, { m: 8, label: "Ago" }, { m: 9, label: "Set" },
  { m: 10, label: "Out" }, { m: 11, label: "Nov" }, { m: 12, label: "Dez" },
];

interface FilterCtx {
  years: number[];
  months: number[];
  setYears: (y: number[]) => void;
  setMonths: (m: number[]) => void;
  availableYears: number[];
  setAvailableYears: (ys: number[]) => void;
  availablePeriods: string[];
  setAvailablePeriods: (ps: string[]) => void;
  periodos: string[]; // actual DB periods filtered by selected years
}

const Ctx = createContext<FilterCtx | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  const now = new Date();
  const [years, setYears] = useState<number[]>([now.getFullYear()]);
  const [months, setMonths] = useState<number[]>(
    Array.from({ length: now.getMonth() + 1 }, (_, i) => i + 1),
  );
  const [availableYears, setAvailableYears] = useState<number[]>([now.getFullYear()]);
  const [availablePeriods, setAvailablePeriods] = useState<string[]>([]);
  const periodos = useMemo(() => {
    if (availablePeriods.length > 0) {
      return availablePeriods
        .filter((p) => years.includes(new Date(p).getUTCFullYear()))
        .sort();
    }
    const arr: string[] = [];
    for (const y of years) {
      for (const m of months) {
        arr.push(`${y}-${String(m).padStart(2, "0")}-01`);
      }
    }
    return arr.sort();
  }, [years, months, availablePeriods]);
  return (
    <Ctx.Provider
      value={{
        years, months, setYears, setMonths,
        availableYears, setAvailableYears,
        availablePeriods, setAvailablePeriods,
        periodos,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useFilters() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useFilters must be inside FilterProvider");
  return c;
}

export function FilterBar() {
  const { years, months, setYears, setMonths, availableYears } = useFilters();
  const toggle = <T,>(arr: T[], v: T) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v].sort();

  const yearOptions =
    availableYears.length > 0
      ? availableYears
      : [new Date().getFullYear() - 1, new Date().getFullYear()];

  return (
    <div className="border-b bg-card/50 backdrop-blur sticky top-0 z-10">
      <div className="flex flex-wrap items-center gap-6 px-6 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Ano
          </div>
          <div className="flex gap-1.5">
            {yearOptions.map((y) => (
              <button
                key={y}
                onClick={() => setYears(toggle(years, y))}
                className={cn(
                  "h-8 px-3 rounded-full text-xs font-medium border transition-colors",
                  years.includes(y)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-accent",
                )}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-w-[280px]">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Mês
          </div>
          <div className="flex flex-wrap gap-1">
            {MONTHS.map((mo) => (
              <button
                key={mo.m}
                onClick={() => setMonths(toggle(months, mo.m))}
                className={cn(
                  "h-8 w-11 rounded-md text-xs font-medium border transition-colors",
                  months.includes(mo.m)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-accent",
                )}
              >
                {mo.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setMonths([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
            }}
          >
            Ano todo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const n = new Date();
              setYears([n.getFullYear()]);
              setMonths([n.getMonth() + 1]);
            }}
          >
            Mês atual
          </Button>
        </div>
      </div>
    </div>
  );
}
