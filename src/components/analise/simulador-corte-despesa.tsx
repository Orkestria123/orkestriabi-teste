import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { formatBRL } from "@/lib/format";
import type { RankingItem } from "@/lib/analise-receita-despesa";
import { TrendingUp } from "lucide-react";

interface Props {
  ranking: RankingItem[];
  receita: number;
  lucroAtual: number;
}

export function SimuladorCorteDespesa({ ranking, receita, lucroAtual }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [corte, setCorte] = useState(10);

  const item = ranking[selectedIdx];
  if (!item) {
    return (
      <Card className="p-6 text-sm text-muted-foreground text-center">
        Sem ranking de despesas para simular.
      </Card>
    );
  }

  const economia = (item.valor * corte) / 100;
  const novoLucro = lucroAtual + economia;
  const novaMargem = receita > 0 ? (novoLucro / receita) * 100 : 0;
  const margemAtual = receita > 0 ? (lucroAtual / receita) * 100 : 0;

  return (
    <Card className="p-4 space-y-4">
      <div>
        <p className="text-sm font-medium">Simulador: e se eu cortasse uma despesa?</p>
        <p className="text-xs text-muted-foreground mt-1">
          Escolha um grupo de despesa e veja o impacto direto no lucro.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Despesa a otimizar</label>
        <div className="flex flex-wrap gap-1.5">
          {ranking.slice(0, 6).map((r, i) => (
            <button
              key={r.classificacao}
              onClick={() => setSelectedIdx(i)}
              className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                selectedIdx === i
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-accent"
              }`}
            >
              {r.descricao}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">Corte de</label>
          <span className="text-sm font-semibold tabular-nums">{corte}%</span>
        </div>
        <Slider
          value={[corte]}
          onValueChange={(v) => setCorte(v[0])}
          min={0}
          max={50}
          step={5}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 pt-2 border-t">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Economia/período</p>
          <p className="text-lg font-semibold text-success tabular-nums">{formatBRL(economia)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Nova margem</p>
          <p className="text-lg font-semibold tabular-nums inline-flex items-center gap-1">
            {novaMargem.toFixed(1).replace(".", ",")}%
            <TrendingUp className="h-3.5 w-3.5 text-success" />
          </p>
          <p className="text-[10px] text-muted-foreground">
            antes: {margemAtual.toFixed(1).replace(".", ",")}%
          </p>
        </div>
      </div>
    </Card>
  );
}
