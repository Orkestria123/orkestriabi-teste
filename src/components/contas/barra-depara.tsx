// Barra de filtros + ações em lote, compartilhada pelos dois de-para.
//
// O motivo de existir: um plano de terceiro traz centenas de contas.
// Fazer uma a uma é o caminho seguro para as poucas que importam, mas
// não pode ser o ÚNICO caminho — a maior parte da fila é repetitiva
// (dezenas de contas de despesa que vão todas para a mesma linha).
//
// Então: filtra para ver só o que interessa, marca em bloco, aplica uma
// vez. E o que foi decidido em lote continua visível linha a linha,
// para conferir depois.
import { useState } from "react";
import { Search, CheckSquare, Ban, Wand2, Eraser, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SeletorConta } from "@/components/contas/seletor-conta";
import {
  ConfirmarLoteDepara, precisaConfirmarLote,
  type OrigemLote, type PedidoLote,
} from "@/components/contas/confirmar-lote-depara";
import type { ContaDestino } from "@/lib/contas/busca";
import type { Contagem, FiltroEstado } from "@/lib/contas/filtro-depara";
import { filtrosUteis } from "@/lib/contas/filtro-depara";

interface Props {
  contagem: Contagem;
  estado: FiltroEstado;
  onEstado: (e: FiltroEstado) => void;
  busca: string;
  onBusca: (s: string) => void;
  /** Quantas linhas estão visíveis com o filtro atual. */
  visiveis: number;

  // ---- seleção em lote ----
  selecionadas: Set<string>;
  onSelecionarVisiveis: () => void;
  onLimparSelecao: () => void;
  destinos: ContaDestino[];
  /** Nomes das contas marcadas — a tela de confirmação lista de onde vem o lote. */
  origensSelecionadas?: OrigemLote[];
  onVincularLote: (codigo: string) => void;
  onIgnorarLote: () => void;
  onLimparLote: () => void;
  /** Só aparece quando há sugestões a aceitar entre as visíveis. */
  sugestoesVisiveis?: number;
  onAceitarSugestoes?: () => void;
  disabled?: boolean;

  // ---- agrupamento por classificação ----
  /** 0 = lista simples; 1..n = agrupa pelo prefixo com n níveis. */
  nivelGrupo?: number;
  onNivelGrupo?: (n: number) => void;
  /** Quantos níveis a classificação mais funda tem. 0 esconde o seletor. */
  niveisDisponiveis?: number;
  /** Oferece agrupar pela conta superior do ECD (valor -1). */
  agruparPorPai?: boolean;
  /**
   * Opções de agrupamento montadas por quem chama.
   *
   * Existe porque o ECD e o plano de contas não têm as mesmas opções: um
   * plano de empresa sempre traz classificação estrutural, e um ECD pode
   * não trazer — nesse caso o que agrupa é o GALHO POR NOME, que o
   * painel do plano não tem. Quando isto vem preenchido, substitui as
   * opções fixas; quando não vem, nada muda.
   */
  opcoesGrupo?: { valor: number; rotulo: string }[];
}

export function BarraDepara({
  contagem, estado, onEstado, busca, onBusca, visiveis,
  selecionadas, onSelecionarVisiveis, onLimparSelecao,
  destinos, origensSelecionadas, onVincularLote, onIgnorarLote, onLimparLote,
  sugestoesVisiveis = 0, onAceitarSugestoes, disabled,
  nivelGrupo = 0, onNivelGrupo, niveisDisponiveis = 0, agruparPorPai,
  opcoesGrupo,
}: Props) {
  const [pedido, setPedido] = useState<PedidoLote | null>(null);
  const n = selecionadas.size;
  const origensLote = origensSelecionadas
    ?? [...selecionadas].map((codigo) => ({ codigo }));

  const pedirOuAplicar = (p: PedidoLote) => {
    if (!precisaConfirmarLote(n)) {
      if (p.acao === "vincular") onVincularLote(p.destinoCodigo);
      else if (p.acao === "ignorar") onIgnorarLote();
      else onLimparLote();
      return;
    }
    window.setTimeout(() => setPedido(p), 40);
  };
  // Um nível só não é agrupamento: joga tudo num grupo só. Por isso o
  // seletor padrão continua exigindo dois níveis (ou o pai do ECD).
  const opcoes: { valor: number; rotulo: string }[] =
    opcoesGrupo ??
    (niveisDisponiveis > 1 || agruparPorPai
      ? [
          ...(agruparPorPai ? [{ valor: -1, rotulo: "conta superior do ECD" }] : []),
          ...Array.from({ length: Math.min(niveisDisponiveis, 6) }, (_, i) => i + 1).map((k) => ({
            valor: k, rotulo: `${k}º nível da classificação`,
          })),
        ]
      : []);
  const chip = (ativo: boolean) =>
    cn(
      "px-2 h-8 rounded-md border text-xs transition-colors",
      ativo
        ? "bg-primary text-primary-foreground border-primary"
        : "hover:bg-accent text-muted-foreground",
    );
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-xs"
            placeholder="Filtrar por código, classificação, nome ou destino…"
            value={busca}
            onChange={(e) => onBusca(e.target.value)}
          />
          {busca && (
            <button
              type="button"
              onClick={() => onBusca("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {filtrosUteis(contagem).map((f) => (
            <button
              key={f.chave}
              type="button"
              onClick={() => onEstado(f.chave)}
              className={chip(estado === f.chave)}
            >
              {f.rotulo}
              <span className="ml-1 tabular-nums opacity-70">{f.n}</span>
            </button>
          ))}
        </div>
      </div>

      {onNivelGrupo && opcoes.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1 shrink-0">Agrupar origem</span>
            <button
              type="button"
              onClick={() => onNivelGrupo(0)}
              className={chip(nivelGrupo === 0)}
              title="Lista conta a conta, sem cabeçalho de grupo"
            >
              conta a conta
            </button>
            {opcoes.map((o) => (
              <button
                key={o.valor}
                type="button"
                onClick={() => onNivelGrupo(o.valor)}
                className={chip(nivelGrupo === o.valor)}
                title="Junta as contas da origem neste nível — o cabeçalho vira uma decisão só"
              >
                {o.rotulo}
              </button>
            ))}
          </div>
          {nivelGrupo !== 0 && (
            <p className="text-[11px] text-muted-foreground">
              O cabeçalho de cada grupo aplica o mesmo destino às contas daquele nível.
            </p>
          )}
        </div>
      )}

      {/* A régua de lote só aparece quando há o que fazer em lote. */}
      {(visiveis > 0 || n > 0) && (
        <div className="flex items-center gap-2 flex-wrap rounded-md border bg-muted/30 px-2 py-1.5">
          <Button
            size="sm" variant="ghost" className="h-7 text-xs"
            disabled={disabled || visiveis === 0}
            onClick={onSelecionarVisiveis}
          >
            <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
            Selecionar {visiveis} visível(is)
          </Button>

          {sugestoesVisiveis > 0 && onAceitarSugestoes && (
            <Button
              size="sm" variant="ghost" className="h-7 text-xs"
              disabled={disabled}
              onClick={onAceitarSugestoes}
              title="Confirma as sugestões automáticas das linhas visíveis"
            >
              <Wand2 className="h-3.5 w-3.5 mr-1.5" />
              Aceitar {sugestoesVisiveis} sugestão(ões)
            </Button>
          )}

          {n > 0 && (
            <>
              <span className="text-xs font-medium ml-1">{n} selecionada(s):</span>
              <SeletorConta
                destinos={destinos}
                valor={null}
                onEscolher={(c) => c && pedirOuAplicar({ acao: "vincular", destinoCodigo: c })}
                placeholder="Vincular todas a…"
                disabled={disabled}
                compacto
                className="w-[240px]"
              />
              <Button
                size="sm" variant="ghost" className="h-7 text-xs"
                disabled={disabled} onClick={() => pedirOuAplicar({ acao: "ignorar" })}
              >
                <Ban className="h-3.5 w-3.5 mr-1.5" />
                Ignorar
              </Button>
              <Button
                size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
                disabled={disabled} onClick={() => pedirOuAplicar({ acao: "limpar" })}
              >
                <Eraser className="h-3.5 w-3.5 mr-1.5" />
                Limpar vínculo
              </Button>
              <Button
                size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
                disabled={disabled} onClick={onLimparSelecao}
              >
                Desmarcar
              </Button>
            </>
          )}
        </div>
      )}

      <ConfirmarLoteDepara
        pedido={pedido}
        onFechar={() => setPedido(null)}
        onConfirmar={() => {
          if (!pedido) return;
          if (pedido.acao === "vincular") onVincularLote(pedido.destinoCodigo);
          else if (pedido.acao === "ignorar") onIgnorarLote();
          else onLimparLote();
          setPedido(null);
        }}
        origens={origensLote}
        destinos={destinos}
        deOnde="a seleção"
        contexto="selecao"
        disabled={disabled}
      />
    </div>
  );
}
