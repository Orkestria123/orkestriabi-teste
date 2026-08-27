import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FormulaBuilder } from "./formula-builder";
import type { ContaPlanoItem } from "./conta-picker";
import { validarExpressao, type Token } from "@/lib/indicadores/engine";
import {
  getFormulasEbitEbitda,
  salvarFormulasEbitEbitda,
  limparCacheFormulasEbit,
} from "@/lib/indicadores/ebit-fonte";

interface Props {
  tenantId: string;
  plano: ContaPlanoItem[];
}

export function DreLinhasConfigCard({ tenantId, plano }: Props) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["formulas-ebit-ebitda", tenantId],
    queryFn: () => getFormulasEbitEbitda(tenantId),
  });

  const [ebit, setEbit] = useState<Token[]>([]);
  const [ebitda, setEbitda] = useState<Token[]>([]);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!data) return;
    setEbit(data.ebit);
    setEbitda(data.ebitda);
  }, [data]);

  const salvar = async () => {
    const errEbit = validarExpressao(ebit);
    const errEbitda = validarExpressao(ebitda);
    if (ebit.length > 0 && errEbit.length > 0) {
      toast.error(`EBIT: ${errEbit[0]}`);
      return;
    }
    if (ebitda.length > 0 && errEbitda.length > 0) {
      toast.error(`EBITDA: ${errEbitda[0]}`);
      return;
    }
    setOcupado(true);
    try {
      await salvarFormulasEbitEbitda(tenantId, ebit, ebitda);
      limparCacheFormulasEbit(tenantId);
      await qc.invalidateQueries({ queryKey: ["formulas-ebit-ebitda", tenantId] });
      await qc.invalidateQueries({ queryKey: ["indicadores-globais", tenantId] });
      await qc.invalidateQueries({ queryKey: ["indicadores-da-empresa"] });
      await qc.invalidateQueries({ queryKey: ["monthly-stmt"] });
      await qc.invalidateQueries({ queryKey: ["indic-demo-dre"] });
      await qc.invalidateQueries({ queryKey: ["indic-engine-data"] });
      toast.success("Fórmulas de EBIT e EBITDA salvas");
    } catch (e: any) {
      toast.error(e.message ?? "Não foi possível salvar");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Card className="p-4 space-y-5">
      <div>
        <div className="font-medium text-sm">Cálculo de EBIT e EBITDA</div>
        <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">
          Esta é a fórmula dos indicadores <strong>Ebit</strong> e <strong>Ebitda</strong>.
          A DRE, os KPIs e o termo EBIT (DRE) / EBITDA (DRE) nas outras fórmulas usam este valor.
          Fórmula vazia cai na estrutura padrão (resultado operacional / D&amp;A).
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs font-medium">EBIT</div>
            <p className="text-[11px] text-muted-foreground">
              Use a linha <strong>Resultado Operacional</strong> (subtotal da DRE) e/ou contas.
              A conta .99 sozinha não tem lançamento — o valor é o acumulado até ela.
            </p>
            <FormulaBuilder
              plano={plano}
              tokens={ebit}
              onChange={setEbit}
              allowAnaliticas
              ocultarLinhas={["EBIT", "EBITDA"]}
            />
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium">EBITDA</div>
            <p className="text-[11px] text-muted-foreground">
              Pode usar EBIT (DRE) (já calculado à esquerda) e somar de volta depreciação/amortização.
            </p>
            <FormulaBuilder
              plano={plano}
              tokens={ebitda}
              onChange={setEbitda}
              allowAnaliticas
              ocultarLinhas={["EBITDA"]}
            />
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" disabled={ocupado || isLoading} onClick={salvar}>
          {ocupado && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Salvar cálculo EBIT/EBITDA
        </Button>
      </div>
    </Card>
  );
}
