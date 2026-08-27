// Seletor de conta de destino — abre na própria linha, com busca.
//
// O que havia antes no ECD: clicar em "vincular" só pintava a linha e
// trocava o texto do botão para "escolhendo…". A lista de destinos era
// uma OUTRA caixa de busca, no topo da seção, que só mostrava algo
// depois de 3 caracteres. Quem clicava em "vincular" ficava olhando
// para "escolhendo…" sem nada para escolher.
//
// Aqui o clique abre a lista em cima da linha, já com foco no campo de
// busca, filtrando a cada tecla sobre as contas que já estão na memória.
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Ban, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { filtrarDestinos, contarDestinos, type ContaDestino } from "@/lib/contas/busca";

interface Props {
  destinos: ContaDestino[];
  valor: string | null;
  onEscolher: (codigo: string | null) => void;
  /** Restringe ao mesmo tipo da conta de origem (com escape para ver todas). */
  tipo?: string | null;
  /** Mostra a opção "não usar em demonstrações". */
  permitirIgnorar?: boolean;
  onIgnorar?: () => void;
  disabled?: boolean;
  /** A lista de destinos ainda está vindo do servidor. */
  carregando?: boolean;
  placeholder?: string;
  className?: string;
  /** Aparência compacta, para caber na célula da tabela. */
  compacto?: boolean;
}

const LIMITE = 60;

export function SeletorConta({
  destinos, valor, onEscolher, tipo, permitirIgnorar, onIgnorar,
  disabled, carregando, placeholder = "Escolher conta…", className, compacto,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState("");
  // Fechar SEMPRE limpa a busca. Escolhendo pelo item eu fechava com
  // `setAberto(false)`, que não passa pelo `onOpenChange` — e o termo
  // antigo continuava lá na próxima abertura, filtrando a lista sem que
  // nada na tela dissesse por quê ("o seletor não mostra minhas contas").
  const fechar = () => { setAberto(false); setTermo(""); };
  // Filtrar por tipo evita mandar uma conta de resultado para o ativo,
  // mas às vezes o tipo da origem está errado — daí o escape.
  const [todosOsTipos, setTodosOsTipos] = useState(false);

  const tipoAtivo = todosOsTipos ? null : (tipo ?? null);
  const opcoes = useMemo(
    () => filtrarDestinos(destinos, termo, { limite: LIMITE, tipo: tipoAtivo }),
    [destinos, termo, tipoAtivo],
  );
  const total = useMemo(
    () => contarDestinos(destinos, termo, { tipo: tipoAtivo }),
    [destinos, termo, tipoAtivo],
  );
  const escolhida = useMemo(
    () => destinos.find((d) => d.codigo === valor) ?? null,
    [destinos, valor],
  );

  const rotulo = escolhida
    ? `${escolhida.classificacao ?? ""} · ${escolhida.descricao ?? escolhida.codigo}`
    : valor
      ? valor // vínculo para uma conta que não está na lista de destinos
      : placeholder;

  return (
    <Popover open={aberto} onOpenChange={(o) => (o ? setAberto(true) : fechar())}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={aberto}
          disabled={disabled}
          className={cn(
            "justify-between font-normal",
            compacto ? "h-8 text-xs px-2" : "h-9 text-sm",
            !escolhida && !valor && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate text-left">{rotulo}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[520px] p-0" align="start">
        {/* shouldFilter={false}: o ranqueamento é nosso (código e
            classificação valem mais que um trecho no meio do nome). */}
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            placeholder="Código, classificação ou nome…"
            value={termo}
            onValueChange={setTermo}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <CommandList className="max-h-[320px]">
            <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">
              {carregando ? "Carregando as contas do plano…" : "Nenhuma conta encontrada."}
              {tipoAtivo && (
                <button
                  type="button"
                  className="block mx-auto mt-2 underline hover:text-foreground"
                  onClick={() => setTodosOsTipos(true)}
                >
                  Procurar em todos os tipos
                </button>
              )}
            </CommandEmpty>

            {(permitirIgnorar || valor) && (
              <CommandGroup>
                {permitirIgnorar && (
                  <CommandItem
                    value="__ignorar__"
                    onSelect={() => { onIgnorar?.(); fechar(); }}
                    className="text-muted-foreground"
                  >
                    <Ban className="mr-2 h-3.5 w-3.5" />
                    Não usar em demonstrações
                  </CommandItem>
                )}
                {valor && (
                  <CommandItem
                    value="__limpar__"
                    onSelect={() => { onEscolher(null); fechar(); }}
                    className="text-muted-foreground"
                  >
                    <X className="mr-2 h-3.5 w-3.5" />
                    Limpar vínculo
                  </CommandItem>
                )}
              </CommandGroup>
            )}

            <CommandGroup>
              {opcoes.map((c) => (
                <CommandItem
                  key={`${c.codigo}|${c.classificacao}`}
                  value={`${c.codigo} ${c.classificacao} ${c.descricao ?? ""}`}
                  onSelect={() => { onEscolher(c.codigo); fechar(); }}
                  className="items-start"
                >
                  <Check
                    className={cn(
                      "mr-2 mt-0.5 h-3.5 w-3.5 shrink-0",
                      valor === c.codigo ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                        {c.classificacao}
                      </span>
                      <span className="truncate">{c.descricao}</span>
                      {c.dfc && (
                        <span
                          className="ml-auto shrink-0 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300"
                          title={`Na DFC entra como ${c.dfcDescricao ?? c.dfc}`}
                        >
                          DFC {c.dfc}
                        </span>
                      )}
                      {typeof c.participantes === "number" && c.participantes > 0 && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                          {c.participantes.toLocaleString("pt-BR")} contas
                        </span>
                      )}
                    </div>
                    {/* O GRUPO, na segunda linha. Sem isto, escolher numa
                        lista de 950 códigos não diz onde o dinheiro vai
                        parar — e era isso que estava faltando para
                        perceber uma alocação errada ANTES de aplicar. */}
                    {c.galho && (
                      <div className="truncate text-[10px] text-muted-foreground/80"
                           title={c.galho}>
                        {c.galho}
                      </div>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>

          <div className="border-t px-2 py-1.5 text-[11px] text-muted-foreground flex items-center justify-between gap-2">
            <span>
              {carregando
                ? "carregando…"
                : total > LIMITE
                  ? `mostrando ${LIMITE} de ${total} — refine a busca`
                  : `${total} conta(s)`}
            </span>
            {tipo && (
              <button
                type="button"
                className="underline hover:text-foreground shrink-0"
                onClick={() => setTodosOsTipos((v) => !v)}
              >
                {todosOsTipos ? `só ${tipo}` : "todos os tipos"}
              </button>
            )}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
