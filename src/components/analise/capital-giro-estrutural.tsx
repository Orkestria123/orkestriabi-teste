// Capital de Giro em formato de planilha (como a DFC): uma linha por conta
// da fórmula configurada pelo escritório, uma coluna por período, e um único
// gráfico com a evolução período a período.
import { Card } from "@/components/ui/card";
import { formatBRL, formatBRLCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE } from "@/lib/chart-config";
import type { CapitalGiroEstrutura } from "@/components/analise/analises-dinamicas";

function labelPeriodo(p: string): string {
  if (/^\d{4}$/.test(p)) return p;
  const d = new Date(`${p}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return p;
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function celula(v: number | null): string {
  if (v == null) return "—";
  return formatBRL(v);
}

export function CapitalGiroEstrutural({ dados }: { dados: CapitalGiroEstrutura }) {
  const { periodos, linhas, total, nome, descricao } = dados;
  const serie = periodos.map((p, i) => ({
    periodo: labelPeriodo(p),
    valor: total[i] ?? null,
  }));

  return (
    <div className="space-y-5">
      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b">
          <h3 className="text-sm font-semibold">{nome}</h3>
          {descricao && (
            <p className="text-xs text-muted-foreground mt-0.5">{descricao}</p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground">
                <th className="text-left font-medium px-4 py-2 sticky left-0 bg-muted/50 min-w-[260px]">
                  Conta
                </th>
                {periodos.map((p) => (
                  <th key={p} className="text-right font-medium px-4 py-2 whitespace-nowrap">
                    {labelPeriodo(p)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, idx) => (
                <tr key={`${l.label}-${idx}`} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2 sticky left-0 bg-background">
                    <span className="text-muted-foreground mr-1">
                      ({l.sinal})
                    </span>
                    {l.label}
                  </td>
                  {l.valores.map((v, i) => (
                    <td
                      key={i}
                      className={cn(
                        "px-4 py-2 text-right tabular-nums whitespace-nowrap",
                        v != null && v < 0 && "text-destructive",
                      )}
                    >
                      {celula(v)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t-2 bg-muted/40 font-semibold">
                <td className="px-4 py-2.5 sticky left-0 bg-muted/40">
                  (=) Capital de Giro
                </td>
                {total.map((v, i) => (
                  <td
                    key={i}
                    className={cn(
                      "px-4 py-2.5 text-right tabular-nums whitespace-nowrap",
                      v != null && v < 0 && "text-destructive",
                    )}
                  >
                    {celula(v)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-1">Evolução do Capital de Giro</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Resultado da planilha em cada período selecionado.
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={serie} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="periodo" {...AXIS_PROPS} />
            <YAxis tickFormatter={(v) => formatBRLCompact(Number(v))} width={90} {...AXIS_PROPS} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => formatBRL(Number(v))} />
            <Line
              type="monotone"
              dataKey="valor"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
