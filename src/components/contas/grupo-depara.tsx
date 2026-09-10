// Cabeçalho de um galho da classificação, com as ações do galho inteiro.
//
// É a linha que transforma "40 contas de despesa em 1.03.02" numa
// decisão só. Mostra o peso do grupo (soma do movimento) porque é isso
// que diz se vale conferir conta a conta ou se dá para resolver em bloco.
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Ban } from "lucide-react";
import { SeletorConta } from "@/components/contas/seletor-conta";
import {
  ConfirmarLoteDepara, precisaConfirmarLote,
  type OrigemLote, type PedidoLote,
} from "@/components/contas/confirmar-lote-depara";
import type { ContaDestino } from "@/lib/contas/busca";

interface Props {
  prefixo: string;
  /** Ex.: "Subgrupo" — o nível da máscara em que o lote está agrupado. */
  rotuloNivel?: string;
  quantidade: number;
  pendentes: number;
  movimento: number;
  /** Todas as linhas do grupo já estão marcadas. */
  marcado: boolean;
  onAlternar: () => void;
  destinos: ContaDestino[];
  carregandoDestinos?: boolean;
  tipo?: string | null;
  /** Semente só se ainda não houver grupo fixo no seletor. */
  sugestaoGrupo?: string | null;
  origens: OrigemLote[];
  onVincularGrupo: (codigo: string) => void;
  onIgnorarGrupo: () => void;
  disabled?: boolean;
  colSpan: number;
}

const brl = (v: number) =>
  (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CabecalhoGrupo({
  prefixo, rotuloNivel, quantidade, pendentes, movimento, marcado, onAlternar,
  destinos, carregandoDestinos, tipo, sugestaoGrupo, origens,
  onVincularGrupo, onIgnorarGrupo, disabled, colSpan,
}: Props) {
  const [pedido, setPedido] = useState<PedidoLote | null>(null);
  const deOnde = [rotuloNivel, prefixo].filter(Boolean).join(" ").trim()
    || `${quantidade} contas`;

  const pedirOuAplicar = (p: PedidoLote) => {
    if (!precisaConfirmarLote(origens.length)) {
      if (p.acao === "vincular") onVincularGrupo(p.destinoCodigo);
      else onIgnorarGrupo();
      return;
    }
    // O seletor fecha num portal; espera um tique para a tela de
    // confirmação não nascer atrás do popover.
    window.setTimeout(() => setPedido(p), 40);
  };

  return (
    <tr className="border-t bg-muted/40">
      <td className="pl-3 py-1.5 w-[34px]">
        <Checkbox
          checked={marcado}
          onCheckedChange={onAlternar}
          aria-label={`Selecionar as ${quantidade} contas de ${prefixo || "sem classificação"}`}
        />
      </td>
      <td colSpan={colSpan} className="px-3 py-1.5">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-mono text-xs font-semibold">
            {rotuloNivel && prefixo ? (
              <span className="font-sans font-medium text-muted-foreground mr-1.5">{rotuloNivel}</span>
            ) : null}
            {prefixo || <span className="italic font-sans">sem classificação</span>}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {quantidade} conta(s)
            {pendentes > 0 && <span className="text-amber-600"> · {pendentes} pendente(s)</span>}
            {" · "}{brl(movimento)}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <SeletorConta
              destinos={destinos}
              carregando={carregandoDestinos}
              valor={null}
              tipo={tipo}
              sugestaoGrupo={sugestaoGrupo}
              onEscolher={(c) => c && pedirOuAplicar({ acao: "vincular", destinoCodigo: c })}
              placeholder={`Vincular as ${quantidade} a…`}
              disabled={disabled}
              compacto
              className="w-[230px]"
            />
            <Button
              size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
              disabled={disabled} onClick={() => pedirOuAplicar({ acao: "ignorar" })}
            >
              <Ban className="h-3.5 w-3.5 mr-1" />
              Ignorar grupo
            </Button>
          </div>
        </div>
        <ConfirmarLoteDepara
          pedido={pedido}
          onFechar={() => setPedido(null)}
          onConfirmar={() => {
            if (!pedido) return;
            if (pedido.acao === "vincular") onVincularGrupo(pedido.destinoCodigo);
            else onIgnorarGrupo();
            setPedido(null);
          }}
          origens={origens}
          destinos={destinos}
          deOnde={deOnde}
          disabled={disabled}
        />
      </td>
    </tr>
  );
}
