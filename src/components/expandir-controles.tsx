import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ModoExpandir } from "@/lib/hierarquia-linhas";

interface Props {
  modo: ModoExpandir;
  podeRecolherUmNivel: boolean;
  podeExpandirUmNivel: boolean;
  onRecolherUmNivel: () => void;
  onExpandirUmNivel: () => void;
  onPadrao: () => void;
  onExpandirTudo: () => void;
  onRecolher: () => void;
}

/** A mesma barra de expandir/recolher usada na DRE, reaproveitável. */
export function ExpandirControles({
  modo,
  podeRecolherUmNivel,
  podeExpandirUmNivel,
  onRecolherUmNivel,
  onExpandirUmNivel,
  onPadrao,
  onExpandirTudo,
  onRecolher,
}: Props) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center">
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0 rounded-md"
          onClick={onRecolherUmNivel}
          disabled={!podeRecolherUmNivel}
          title="Recolher um nível em todas as contas"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0 rounded-md ml-1"
          onClick={onExpandirUmNivel}
          disabled={!podeExpandirUmNivel}
          title="Expandir um nível em todas as contas"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Button
        variant={modo === "padrao" ? "default" : "outline"}
        size="sm"
        className="h-7 text-xs rounded-md"
        onClick={onPadrao}
        title="Abre os grupos da demonstração, sem o detalhe analítico completo"
      >
        Padrão
      </Button>
      <Button
        variant={modo === "tudo" ? "default" : "outline"}
        size="sm"
        className="h-7 text-xs rounded-md"
        onClick={onExpandirTudo}
      >
        Expandir tudo
      </Button>
      <Button
        variant={modo === "recolher" ? "default" : "outline"}
        size="sm"
        className="h-7 text-xs rounded-md"
        onClick={onRecolher}
      >
        Recolher
      </Button>
    </div>
  );
}
