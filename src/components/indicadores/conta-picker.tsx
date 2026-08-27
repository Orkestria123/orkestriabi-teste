// Popover para selecionar contas do plano.
// A lista mostra a conta ESTRUTURAL (classificação + nome), como no plano.
// O valor gravado na fórmula é o código reduzido — único quando a mesma
// classificação se repete em duas contas.
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

function norm(s: string): string {
  return (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Vínculo persistido: reduzido se existir, senão classificação (fórmulas antigas). */
export function idConta(p: ContaPlanoItem): string {
  const c = (p.codigo ?? "").trim();
  return c || p.classificacao;
}

export function rotuloEstrutural(p: ContaPlanoItem): string {
  return `${p.classificacao} ${p.descricao}`.trim();
}

interface Props {
  plano: ContaPlanoItem[];
  selecionadas: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  buttonLabel?: string;
  allowAnaliticas?: boolean;
}

export function ContaPicker({ plano, selecionadas, onChange, buttonLabel = "Escolher contas", allowAnaliticas = false }: Props) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");

  const descendentesAnaliticos = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const p of plano) {
      if (p.is_sintetica) continue;
      let atual: string = p.classificacao;
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

  const classDuplicada = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of plano) n.set(p.classificacao, (n.get(p.classificacao) ?? 0) + 1);
    return n;
  }, [plano]);

  const filtered = useMemo(() => {
    const b = norm(busca.trim());
    return plano
      .filter((p) => (allowAnaliticas ? true : !p.is_participante))
      .filter((p) => {
        if (!b) return true;
        return (
          norm(p.classificacao).includes(b) ||
          norm(p.descricao).includes(b) ||
          (p.codigo ? norm(p.codigo).includes(b) : false)
        );
      })
      .slice(0, 800);
  }, [plano, busca, allowAnaliticas]);

  const sel = new Set(selecionadas);
  const estaSelecionada = (p: ContaPlanoItem) => {
    const id = idConta(p);
    return sel.has(id) || sel.has(p.classificacao);
  };

  const toggle = (p: ContaPlanoItem) => {
    const id = idConta(p);
    const marcada = estaSelecionada(p);
    if (marcada) {
      onChange(selecionadas.filter((x) => x !== id && x !== p.classificacao));
      return;
    }
    const next = selecionadas.filter((x) => x !== p.classificacao);
    onChange([...next, id]);
  };

  const ranqueadas = useMemo(() => {
    const b = norm(busca.trim());
    const porEstrutura = (a: ContaPlanoItem, b2: ContaPlanoItem) =>
      a.classificacao.localeCompare(b2.classificacao, "pt-BR", { numeric: true });
    if (!b) return [...filtered].sort(porEstrutura);
    return [...filtered].sort((a, b2) => {
      const sa = norm(a.classificacao) === b ? 0 : norm(a.classificacao).startsWith(b) ? 1 : 2;
      const sb = norm(b2.classificacao) === b ? 0 : norm(b2.classificacao).startsWith(b) ? 1 : 2;
      if (sa !== sb) return sa - sb;
      return porEstrutura(a, b2);
    });
  }, [filtered, busca]);

  return (
    <Popover modal open={open} onOpenChange={(o) => { setOpen(o); if (!o) setBusca(""); }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <ChevronDown className="h-3 w-3 mr-1" /> {buttonLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[460px] p-0" align="start">
        <div className="p-2 border-b border-border">
          <Input
            placeholder="Buscar por classificação ou nome (ex: depreciação)…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="h-8 text-xs"
            autoFocus
          />
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {ranqueadas.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground text-center">Nenhuma conta.</div>
          )}
          {ranqueadas.map((p, idx) => {
            const s = estaSelecionada(p);
            const apuracao = isApuracaoVazia(p);
            const dup = (classDuplicada.get(p.classificacao) ?? 0) > 1;
            return (
              <button
                key={`${idConta(p)}|${idx}`}
                type="button"
                onClick={() => toggle(p)}
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
                <span className="font-mono shrink-0">{p.classificacao}</span>
                <span className="truncate">{p.descricao}</span>
                {dup && p.codigo && (
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0" title="Código reduzido (vínculo)">
                    {p.codigo}
                  </span>
                )}
                <span className="flex items-center gap-1 shrink-0 ml-auto">
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
