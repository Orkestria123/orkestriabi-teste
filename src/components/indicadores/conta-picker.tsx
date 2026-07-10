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
  codigo?: string | null;
  is_sintetica?: boolean | null;
  is_participante?: boolean;
  nivel?: number;
}

// Remove acentos e normaliza para busca case/accent-insensitive.
function norm(s: string): string {
  return (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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

  // Índice: para cada classificação sintética, quantos descendentes
  // ANALÍTICOS (não sintéticos) existem no plano. Zero descendentes = conta
  // de apuração/subtotal sem movimento próprio (ex.: 3.01.99 RECEITA LIQUIDA).
  const descendentesAnaliticos = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const p of plano) {
      if (p.is_sintetica) continue;
      let atual: string = p.classificacao;
      // sobe pela hierarquia por prefixo com "."
      while (true) {
        const idx = atual.lastIndexOf(".");
        if (idx < 0) break;
        atual = atual.slice(0, idx);
        contagem.set(atual, (contagem.get(atual) ?? 0) + 1);
      }
    }
    return contagem;
  }, [plano]);

  const isApuracaoVazia = (p: ContaPlanoItem) => {
    if (!p.is_sintetica) return false;
    const desc = descendentesAnaliticos.get(p.classificacao) ?? 0;
    return desc === 0;
  };

  const filtered = useMemo(() => {
    const b = norm(busca.trim());
    return plano
      .filter((p) => !p.is_participante)
      .filter((p) => {
        if (!b) return true;
        return (
          norm(p.classificacao).includes(b) ||
          norm(p.descricao).includes(b) ||
          (p.codigo ? norm(p.codigo).includes(b) : false)
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
      <PopoverContent className="w-[460px] p-0" align="start">
        <div className="p-2 border-b border-border">
          <Input
            placeholder="Buscar por classificação ou nome…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-8 text-xs"
            autoFocus
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Sintéticas somam todas as analíticas abaixo. Contas de apuração (sem movimento próprio) ficam marcadas.
          </p>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground text-center">Nenhuma conta.</div>
          )}
          {filtered.map((p) => {
            const s = sel.has(p.classificacao);
            const apuracao = isApuracaoVazia(p);
            return (
              <button
                key={p.classificacao}
                type="button"
                onClick={() => toggle(p.classificacao)}
                title={apuracao ? "Conta de apuração/subtotal: não recebe lançamento — seleção sempre resulta em 0." : undefined}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2",
                  s && "bg-primary/5",
                  apuracao && "opacity-70",
                )}
                style={{ paddingLeft: `${Math.min(p.nivel ?? 1, 6) * 8 + 12}px` }}
              >
                <span className="w-4 flex-shrink-0">
                  {s && <Check className="h-3 w-3 text-primary" />}
                </span>
                <span className="font-mono text-muted-foreground">{p.classificacao}</span>
                <span className="truncate">{p.descricao}</span>
                <span className="ml-auto flex items-center gap-1">
                  {apuracao && (
                    <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-700 dark:text-amber-400">
                      Apuração
                    </Badge>
                  )}
                  {p.is_sintetica && !apuracao && (
                    <Badge variant="outline" className="text-[9px]">Sint</Badge>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
