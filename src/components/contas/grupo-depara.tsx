// Cabeçalho de um galho da classificação, com as ações do galho inteiro.
//
// É a linha que transforma "40 contas de despesa em 1.03.02" numa
// decisão só. Mostra o peso do grupo (soma do movimento) porque é isso
// que diz se vale conferir conta a conta ou se dá para resolver em bloco.
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Ban } from "lucide-react";
import { SeletorConta } from "@/components/contas/seletor-conta";
import type { ContaDestino } from "@/lib/contas/busca";

interface Props {
  prefixo: string;
  quantidade: number;
  pendentes: number;
  movimento: number;
  /** Todas as linhas do grupo já estão marcadas. */
  marcado: boolean;
  onAlternar: () => void;
  destinos: ContaDestino[];
  carregandoDestinos?: boolean;
  onVincularGrupo: (codigo: string) => void;
  onIgnorarGrupo: () => void;
  disabled?: boolean;
  colSpan: number;
}

const brl = (v: number) =>
  (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CabecalhoGrupo({
  prefixo, quantidade, pendentes, movimento, marcado, onAlternar,
  destinos, carregandoDestinos, onVincularGrupo, onIgnorarGrupo, disabled, colSpan,
}: Props) {
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
              onEscolher={(c) => c && onVincularGrupo(c)}
              placeholder={`Vincular as ${quantidade} a…`}
              disabled={disabled}
              compacto
              className="w-[230px]"
            />
            <Button
              size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
              disabled={disabled} onClick={onIgnorarGrupo}
            >
              <Ban className="h-3.5 w-3.5 mr-1" />
              Ignorar grupo
            </Button>
          </div>
        </div>
      </td>
    </tr>
  );
}
