// Popover para selecionar uma ou várias contas do plano por classificação.
import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ContaPlanoItem {
  classificacao: string;
  descricao: string;
  is_sintetica?: boolean | null;
  is_participante?: boolean;
  nivel?: number;
}

interface Props {
  plano: ContaPlanoItem[];
  selecionadas: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  buttonLabel?: string;
}

export function ContaPicker({ plano, selecionadas, onChange, buttonLabel = "Escolher contas" }: Props) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");

  const filtered = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return plano
      .filter((p) => !p.is_participante)
      .filter((p) => {
        if (!b) return true;
        return (
          p.classificacao.toLowerCase().includes(b) ||
          p.descricao.toLowerCase().includes(b)
        );
      })
      .slice(0, 2000);
  }, [plano, busca]);

  const sel = new Set(selecionadas);
  const toggle = (c: string) => {
    if (sel.has(c)) onChange(selecionadas.filter((x) => x !== c));
    else onChange([...selecionadas, c]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <ChevronDown className="h-3 w-3 mr-1" /> {buttonLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <div className="p-2 border-b border-border">
          <Input
            placeholder="Buscar por classificação ou nome…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-8 text-xs"
            autoFocus
          />
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground text-center">Nenhuma conta.</div>
          )}
          {filtered.map((p) => {
            const s = sel.has(p.classificacao);
            return (
              <button
                key={p.classificacao}
                type="button"
                onClick={() => toggle(p.classificacao)}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2",
                  s && "bg-primary/5",
                )}
                style={{ paddingLeft: `${Math.min(p.nivel ?? 1, 6) * 8 + 12}px` }}
              >
                <span className="w-4 flex-shrink-0">
                  {s && <Check className="h-3 w-3 text-primary" />}
                </span>
                <span className="font-mono text-muted-foreground">{p.classificacao}</span>
                <span className="truncate">{p.descricao}</span>
                {p.is_sintetica && (
                  <Badge variant="outline" className="text-[9px] ml-auto">Sint</Badge>
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
