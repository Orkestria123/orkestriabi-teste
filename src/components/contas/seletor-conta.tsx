// Seletor de conta de destino — abre na própria linha, com busca.
//
// O clique abre a lista em cima da linha, já com foco no campo de
// busca, filtrando a cada tecla sobre as contas que já estão na memória.
//
// O grupo do Plano Padrão (Receita, Custos Industriais, Despesas Administrativas…).
// Imobilizado…) corta a lista. A escolha fica fixa: a próxima conta
// abre no mesmo grupo, até alguém trocar.
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Ban, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  filtrarDestinos, contarDestinos, listarGruposDestino, grupoDeConta, chaveGrupoCanon,
  mesmoTipoConta, type ContaDestino,
} from "@/lib/contas/busca";

const KEY_GRUPO = "orkestria.depara.grupoDestino";
let hidratado = false;
let definido = false;
let valorFixo: string | null = null;

function lerGrupoFixo(): { definido: boolean; valor: string | null } {
  if (!hidratado && typeof window !== "undefined") {
    hidratado = true;
    try {
      const v = localStorage.getItem(KEY_GRUPO);
      if (v == null) {
        definido = false;
        valorFixo = null;
      } else if (v === "__todos__") {
        definido = true;
        valorFixo = null;
      } else {
        definido = true;
        valorFixo = chaveGrupoCanon(v);
      }
    } catch {
      definido = false;
      valorFixo = null;
    }
  }
  return { definido, valor: valorFixo };
}

function gravarGrupoFixo(g: string | null) {
  hidratado = true;
  definido = true;
  valorFixo = chaveGrupoCanon(g);
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY_GRUPO, valorFixo ?? "__todos__");
  } catch {
    /* private mode */
  }
}

interface Props {
  destinos: ContaDestino[];
  valor: string | null;
  onEscolher: (codigo: string | null) => void;
  /** Restringe ao mesmo tipo da conta de origem (com escape para ver todas). */
  tipo?: string | null;
  /**
   * Semente só quando ainda não há grupo fixo (primeira conta da sessão).
   * Depois o que vale é o grupo escolhido no seletor.
   */
  sugestaoGrupo?: string | null;
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
  /** Abre a lista no primeiro paint — o clique em "trocar" monta já aberto. */
  abrirAoMontar?: boolean;
}

const LIMITE = 60;

export function SeletorConta({
  destinos, valor, onEscolher, tipo, sugestaoGrupo, permitirIgnorar, onIgnorar,
  disabled, carregando, placeholder = "Escolher conta…", className, compacto,
  abrirAoMontar,
}: Props) {
  const [aberto, setAberto] = useState(!!abrirAoMontar);
  const [termo, setTermo] = useState("");
  const [grupo, setGrupo] = useState<string | null>(() => {
    if (!abrirAoMontar) return null;
    const fixo = lerGrupoFixo();
    if (fixo.definido) return chaveGrupoCanon(fixo.valor);
    return chaveGrupoCanon(sugestaoGrupo ?? null);
  });
  // Filtrar por tipo evita mandar uma conta de resultado para o ativo,
  // mas às vezes o tipo da origem está errado — daí o escape.
  const [todosOsTipos, setTodosOsTipos] = useState(false);

  const tipoAtivo = todosOsTipos ? null : (tipo ?? null);

  const destinosDoTipo = useMemo(
    () => (tipoAtivo ? destinos.filter((c) => mesmoTipoConta(c.tipo, tipoAtivo)) : destinos),
    [destinos, tipoAtivo],
  );

  // Só calcula a lista quando o popover está aberto. Fechado, cada
  // linha da tabela só precisa do rótulo da conta já escolhida — senão
  // mil seletores varrem o plano 30× e a aba inteira trava.
  const grupos = useMemo(
    () => (aberto ? listarGruposDestino(destinosDoTipo) : []),
    [aberto, destinosDoTipo],
  );

  const escolherGrupo = (g: string | null) => {
    const canon = chaveGrupoCanon(g);
    setGrupo(canon);
    gravarGrupoFixo(canon);
  };

  const opcoes = useMemo(
    () => aberto
      ? filtrarDestinos(destinos, termo, { limite: LIMITE, tipo: tipoAtivo, grupo })
      : [],
    [aberto, destinos, termo, tipoAtivo, grupo],
  );
  const total = useMemo(
    () => aberto ? contarDestinos(destinos, termo, { tipo: tipoAtivo, grupo }) : 0,
    [aberto, destinos, termo, tipoAtivo, grupo],
  );
  const escolhida = useMemo(
    () => destinos.find((d) => d.codigo === valor) ?? null,
    [destinos, valor],
  );

  const chaveFixa = lerGrupoFixo().definido ? lerGrupoFixo().valor : grupo;
  const rotuloGrupoFixo = useMemo(() => {
    if (!chaveFixa) return null;
    for (const c of destinos) {
      const g = grupoDeConta(c);
      if (g?.chave === chaveFixa) return g.rotulo;
    }
    return grupos.find((g) => g.chave === chaveFixa)?.rotulo ?? null;
  }, [destinos, grupos, chaveFixa]);

  const rotulo = escolhida
    ? `${escolhida.classificacao ?? ""} · ${escolhida.descricao ?? escolhida.codigo}`
    : valor
      ? valor
      : placeholder;

  const abrir = () => {
    const fixo = lerGrupoFixo();
    if (fixo.definido) {
      setGrupo(chaveGrupoCanon(fixo.valor));
    } else if (sugestaoGrupo) {
      escolherGrupo(sugestaoGrupo);
    } else {
      setGrupo(null);
    }
    setTermo("");
    setTodosOsTipos(false);
    setAberto(true);
  };
  // Fecha a busca, mas o GRUPO fica. Era isso que forçava escolher
  // Custo/Adm/Com de novo em cada linha.
  const fechar = () => {
    setAberto(false);
    setTermo("");
    setTodosOsTipos(false);
  };

  return (
    <Popover open={aberto} onOpenChange={(o) => (o ? abrir() : fechar())}>
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
          <span className="truncate text-left min-w-0">{rotulo}</span>
          {!escolhida && !valor && rotuloGrupoFixo && (
            <span className="ml-1.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground/80">
              {rotuloGrupoFixo}
            </span>
          )}
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[520px] overflow-visible p-0" align="start">
        {grupos.length > 0 && (
          <div className="border-b px-2 py-1.5 space-y-1">
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="shrink-0">Grupo no plano</span>
              <select
                value={grupo ?? ""}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => escolherGrupo(e.target.value || null)}
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              >
                <option value="">Todos os grupos</option>
                {grupos.map((g) => (
                  <option key={g.chave} value={g.chave}>
                    {g.rotulo}{g.n > 0 ? ` (${g.n})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[10px] text-muted-foreground">
              {grupo
                ? "Fica neste grupo nas próximas contas, até você trocar."
                : "A escolha fica até você trocar."}
            </p>
          </div>
        )}
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
              {grupo && (
                <button
                  type="button"
                  className="block mx-auto mt-2 underline hover:text-foreground"
                  onClick={() => escolherGrupo(null)}
                >
                  Ver todos os grupos
                </button>
              )}
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
