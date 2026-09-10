// Confirmação antes de gravar um de-para em lote.
//
// Uma conta por vez grava na hora: dá para ver o que aconteceu.
// Um cabeçalho de grupo aplica a mesma conta a dezenas de origens de
// uma vez — sem esta tela, um clique no seletor já gravava, e o erro
// só aparecia na DRE.
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { rotuloConta, type ContaDestino } from "@/lib/contas/busca";

export type OrigemLote = { codigo: string; descricao?: string | null };

export type PedidoLote =
  | { acao: "vincular"; destinoCodigo: string }
  | { acao: "ignorar" }
  | { acao: "limpar" };

interface Props {
  pedido: PedidoLote | null;
  onFechar: () => void;
  onConfirmar: () => void;
  origens: OrigemLote[];
  destinos: ContaDestino[];
  /** Ex.: "Subgrupo 3.07.01". Vazio quando o lote é a seleção da barra. */
  deOnde?: string;
  contexto?: "grupo" | "selecao";
  disabled?: boolean;
}

const PREVIEW = 12;

export function ConfirmarLoteDepara({
  pedido, onFechar, onConfirmar, origens, destinos, deOnde, contexto = "grupo", disabled,
}: Props) {
  const n = origens.length;
  const destino = pedido?.acao === "vincular"
    ? destinos.find((d) => d.codigo === pedido.destinoCodigo) ?? null
    : null;
  const rotuloDestino = pedido?.acao === "vincular"
    ? (destino ? rotuloConta(destino) : pedido.destinoCodigo)
    : null;

  const titulo =
    pedido?.acao === "ignorar" ? "Ignorar em lote?"
      : pedido?.acao === "limpar" ? "Limpar o vínculo em lote?"
        : "Atribuir em lote?";

  const acao =
    pedido?.acao === "ignorar" ? `Ignorar ${n} contas`
      : pedido?.acao === "limpar" ? `Limpar ${n} contas`
        : `Atribuir ${n} contas`;

  const origemFrase = contexto === "selecao"
    ? <>as <strong className="text-foreground">{n} contas selecionadas</strong></>
    : <>as <strong className="text-foreground">{n} contas</strong>{deOnde ? <> de <strong className="text-foreground">{deOnde}</strong></> : null}</>;

  return (
    <Dialog open={!!pedido} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col gap-4 z-[60]">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {pedido?.acao === "vincular" ? (
              <>
                Tem certeza de atribuir {origemFrase} para a conta abaixo? Isso grava agora e vale nas demonstrações.
              </>
            ) : pedido?.acao === "ignorar" ? (
              <>
                Tem certeza de tirar {origemFrase} das demonstrações?
              </>
            ) : (
              <>
                Tem certeza de limpar o destino de {origemFrase}? Elas voltam para a fila.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {pedido?.acao === "vincular" && (
          <div className="rounded-md border bg-muted/40 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Destino no Plano Padrão
            </div>
            <div className="mt-0.5 text-sm font-medium leading-snug">
              {rotuloDestino}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Origens ({n})
          </div>
          <ul className="max-h-48 overflow-y-auto rounded-md border divide-y text-sm">
            {origens.slice(0, PREVIEW).map((o) => (
              <li key={o.codigo} className="px-3 py-1.5">
                <div className="truncate">{o.descricao || o.codigo}</div>
                {o.descricao && o.descricao !== o.codigo && (
                  <div className="font-mono text-[11px] text-muted-foreground">{o.codigo}</div>
                )}
              </li>
            ))}
            {n > PREVIEW && (
              <li className="px-3 py-1.5 text-xs text-muted-foreground">
                e mais {n - PREVIEW} conta(s)
              </li>
            )}
          </ul>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFechar} disabled={disabled}>
            Cancelar
          </Button>
          <Button type="button" onClick={onConfirmar} disabled={disabled}>
            {acao}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Uma conta só não precisa da tela — o lote começa em 2. */
export function precisaConfirmarLote(quantidade: number): boolean {
  return quantidade > 1;
}
