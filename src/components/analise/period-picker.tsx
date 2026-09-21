import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import type { Granularidade } from "@/lib/analise-helpers";
import { anosDisponiveis, periodoMesLabel, rotuloSelecao } from "@/lib/analise-helpers";

interface Props {
  granularidade: Granularidade;
  setGranularidade: (g: Granularidade) => void;
  periodosA: string[];
  periodosB: string[];
  setPeriodosA: (v: string[]) => void;
  setPeriodosB: (v: string[]) => void;
  availablePeriods: string[];
}

interface SeletorProps {
  titulo: string;
  granularidade: Granularidade;
  valores: string[];
  setValores: (v: string[]) => void;
  opcoes: { value: string; label: string }[];
}

function SeletorMultiplo({ titulo, granularidade, valores, setValores, opcoes }: SeletorProps) {
  const toggle = (v: string) =>
    setValores(valores.includes(v) ? valores.filter((x) => x !== v) : [...valores, v].sort());

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{titulo}</p>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-[230px] justify-between font-normal",
              valores.length === 0 && "text-muted-foreground",
            )}
          >
            <span className="truncate">{rotuloSelecao(granularidade, valores)}</span>
            <ChevronDown className="h-4 w-4 opacity-60 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[250px] p-0 pointer-events-auto" align="start">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <button
              onClick={() => setValores(opcoes.map((o) => o.value))}
              className="text-[10px] uppercase tracking-wider text-primary hover:underline"
            >
              Marcar todos
            </button>
            <button
              onClick={() => setValores([])}
              className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground hover:underline"
            >
              Limpar
            </button>
          </div>
          <div className="max-h-[300px] overflow-y-auto py-1">
            {opcoes.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
              >
                <Checkbox
                  checked={valores.includes(o.value)}
                  onCheckedChange={() => toggle(o.value)}
                />
                {o.label}
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function PeriodPicker({
  granularidade, setGranularidade, periodosA, periodosB, setPeriodosA, setPeriodosB, availablePeriods,
}: Props) {
  const opcoes =
    granularidade === "ano"
      ? anosDisponiveis(availablePeriods).map((a) => ({ value: String(a), label: String(a) }))
      : [...availablePeriods].sort().map((p) => ({ value: p, label: periodoMesLabel(p) }));

  return (
    <div className="space-y-2">
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

        <SeletorMultiplo
          titulo="Período A"
          granularidade={granularidade}
          valores={periodosA}
          setValores={setPeriodosA}
          opcoes={opcoes}
        />
        <SeletorMultiplo
          titulo="Período B"
          granularidade={granularidade}
          valores={periodosB}
          setValores={setPeriodosB}
          opcoes={opcoes}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {granularidade === "ano"
          ? "No exercício (ano), o cálculo usa todos os meses disponíveis do ano escolhido."
          : "Marque quantos meses quiser em cada lado; os valores são somados (no balanço, vale o saldo do último mês)."}
      </p>
    </div>
  );
}
