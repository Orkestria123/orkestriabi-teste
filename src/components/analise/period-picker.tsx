import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Granularidade } from "@/lib/analise-helpers";
import { anosDisponiveis, periodoMesLabel } from "@/lib/analise-helpers";

interface Props {
  granularidade: Granularidade;
  setGranularidade: (g: Granularidade) => void;
  periodoA: string;
  periodoB: string;
  setPeriodoA: (v: string) => void;
  setPeriodoB: (v: string) => void;
  availablePeriods: string[];
}

export function PeriodPicker({
  granularidade, setGranularidade, periodoA, periodoB, setPeriodoA, setPeriodoB, availablePeriods,
}: Props) {
  const anos = anosDisponiveis(availablePeriods);
  const meses = [...availablePeriods].sort();

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Comparar por</p>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {(["ano", "mes"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGranularidade(g)}
              className={cn(
                "px-3.5 h-8 text-xs font-medium rounded-md transition-colors",
                granularidade === g ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g === "ano" ? "Exercício (Ano)" : "Mês específico"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Período A</p>
        <Select value={periodoA} onValueChange={setPeriodoA}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent>
            {granularidade === "ano"
              ? anos.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)
              : meses.map((p) => <SelectItem key={p} value={p}>{periodoMesLabel(p)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Período B</p>
        <Select value={periodoB} onValueChange={setPeriodoB}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent>
            {granularidade === "ano"
              ? anos.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)
              : meses.map((p) => <SelectItem key={p} value={p}>{periodoMesLabel(p)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
