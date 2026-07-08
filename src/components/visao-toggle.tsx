import { useVisaoGerencial, type Visao } from "@/hooks/use-visao-gerencial";
import { cn } from "@/lib/utils";

/**
 * Toggle global de Visão (Contábil / Gerencial). O modo Comparativo será
 * adicionado na Etapa 5 — o componente já suporta uma terceira opção via
 * `options`, basta incluí-la depois.
 */
export function VisaoToggle({
  options = [
    { value: "contabil", label: "Contábil" },
    { value: "gerencial", label: "Gerencial" },
  ],
  className,
}: {
  options?: { value: Visao; label: string }[];
  className?: string;
}) {
  const { visao, setVisao } = useVisaoGerencial();
  return (
    <div
      className={cn(
        "inline-flex rounded-lg border border-border bg-card p-0.5",
        className,
      )}
      role="tablist"
      aria-label="Visão"
    >
      {options.map((o) => {
        const active = visao === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setVisao(o.value)}
            className={cn(
              "px-3 h-7 text-xs font-medium rounded-md transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function VisaoBadge({ className }: { className?: string }) {
  const { visao } = useVisaoGerencial();
  if (visao !== "gerencial") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary",
        className,
      )}
    >
      Visão: Gerencial
    </span>
  );
}
