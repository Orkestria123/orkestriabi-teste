import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/format";
import type { ConsistenciaMes } from "@/lib/diario/consistencia-balanco";

const mes = (p: string) => p.slice(0, 7).split("-").reverse().join("/");
const rotulo = (v: string) => v === "contabil" ? "Contábil" : "Gerencial";

export function ConsistenciaBalanco({ resultados, carregando, erro }: {
  resultados: ConsistenciaMes[];
  carregando?: boolean;
  erro?: boolean;
}) {
  if (erro) return <div role="alert" className="border-y border-destructive/40 py-3 text-sm text-destructive">Não foi possível conferir o Balanço. A consistência não está confirmada.</div>;
  if (carregando) return <div role="status" className="flex items-center gap-2 border-y py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Conferindo Ativo e Passivo + PL…</div>;
  if (resultados.length === 0) return null;
  const problemas = resultados.filter((r) => r.status !== "equilibrado");
  const visoes = Array.from(new Set(resultados.map((r) => r.visao)));
  return <section aria-label="Consistência do Balanço" className="space-y-3 border-y py-3">
    <div className="flex flex-wrap gap-2" role={problemas.length ? "alert" : "status"}>
      {visoes.map((v) => {
        const linhas = resultados.filter((r) => r.visao === v);
        const pendencias = linhas.filter((r) => r.status !== "equilibrado");
        return <Badge key={v} variant="outline" className={pendencias.length ? "gap-1 border-destructive/40 text-destructive whitespace-normal" : "gap-1 border-success/40 text-success whitespace-normal"}>
          {pendencias.length ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
          {rotulo(v)}: {pendencias.length ? `${pendencias.length} mês(es) com pendência` : `Ativo = Passivo + PL em ${linhas.length} mês(es)`}
        </Badge>;
      })}
    </div>
    {problemas.length > 0 && <div className="max-h-80 overflow-auto">
      <table className="w-full text-xs">
        <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 pr-3">Mês</th><th className="pr-3">Visão</th><th className="px-3 text-right">Ativo</th><th className="px-3 text-right">Passivo + PL</th><th className="pl-3 text-right">Consistência</th></tr></thead>
        <tbody>{problemas.map((r) => <tr key={`${r.visao}|${r.periodo}`} className="border-b">
          <td className="py-2 pr-3 whitespace-nowrap">{mes(r.periodo)}</td><td className="pr-3">{rotulo(r.visao)}</td>
          <td className="px-3 text-right whitespace-nowrap">{r.ativo === null ? "—" : formatBRL(r.ativo)}</td>
          <td className="px-3 text-right whitespace-nowrap">{r.passivoPl === null ? "—" : formatBRL(r.passivoPl)}</td>
          <td className="pl-3 text-right font-medium text-destructive whitespace-nowrap">{r.diferenca === null ? "Totais incompletos" : `Balanço com diferença de ${formatBRL(r.diferenca)}`}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}