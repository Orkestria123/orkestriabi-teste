import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useLancamentosDrilldown } from "@/hooks/use-drilldown";
import { formatBRLPlain } from "@/lib/format";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  codigoConta: string; // na verdade é a classificação
  descricao: string;
  periods: string[];
  colSpanLeft: number;
  colSpanRight: number;
  /** Colunas extras (subtotais de ano intercalados) somadas ao colspan. */
  extraMiddleCols?: number;
  variante?: "dre" | "bp";
  emMilhares?: boolean;
}


function formatData(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function InlineDrilldown({
  codigoConta,
  descricao,
  periods,
  colSpanLeft,
  colSpanRight,
  extraMiddleCols = 0,
  variante = "dre",
  emMilhares = false,
}: Props) {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const usePeriods = periods.length > 0 ? periods : periodos;
  const { data, isLoading } = useLancamentosDrilldown(
    companyId,
    codigoConta,
    usePeriods,
    { incluirSaldoInicial: variante === "bp" },
    true,
  );

  const scale = emMilhares ? 1000 : 1;
  const digits = emMilhares ? 1 : 2;
  const fmt = (n: number) =>
    n === 0 ? "—" : formatBRLPlain(n, { digits, scale });
  const fmtValor = (n: number) => formatBRLPlain(n, { digits, scale });

  const totalCols = colSpanLeft + periods.length + extraMiddleCols + colSpanRight;


  return (
    <tr className="bg-muted/20">
      <td colSpan={totalCols} className="p-0">
        <div className="px-6 py-2 border-l-2 border-primary/40 bg-muted/30">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Drill-down · {descricao}
            {data && data.contasEncontradas > 0 && (
              <span className="ml-2 text-muted-foreground/70 normal-case tracking-normal">
                {data.contasEncontradas} conta{data.contasEncontradas > 1 ? "s" : ""} ·{" "}
                {data.entries.length} lançamento{data.entries.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Carregando lançamentos…
            </div>
          ) : !data || data.contasEncontradas === 0 ? (
            <div className="py-3 text-xs text-muted-foreground">
              Nenhuma conta analítica encontrada no plano de contas para esta classificação.
            </div>
          ) : data.entries.length === 0 && data.saldoInicial.length === 0 ? (
            <div className="py-3 text-xs text-muted-foreground">
              Sem lançamentos no período selecionado para as {data.contasEncontradas} conta(s) desta linha.
            </div>
          ) : (
            <DrilldownTable
              data={data}
              variante={variante}
              fmt={fmt}
              fmtValor={fmtValor}
              showConta={data.contasEncontradas > 1}
            />
          )}
        </div>
      </td>
    </tr>
  );
}

function DrilldownTable({
  data,
  variante,
  fmt,
  fmtValor,
  showConta,
}: {
  data: NonNullable<ReturnType<typeof useLancamentosDrilldown>["data"]>;
  variante: "dre" | "bp";
  fmt: (n: number) => string;
  fmtValor: (n: number) => string;
  showConta: boolean;
}) {
  const totalDeb = data.entries.reduce((a, r) => a + r.debito, 0);
  const totalCre = data.entries.reduce((a, r) => a + r.credito, 0);
  const totalValor = totalDeb - totalCre;
  const saldoInicialTotal = data.saldoInicial.reduce((a, r) => a + r.saldo, 0);

  return (
    <div className="overflow-x-auto rounded border bg-card">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="text-left font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5 whitespace-nowrap">
              Data
            </th>
            {showConta && (
              <th className="text-left font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5 whitespace-nowrap">
                Conta
              </th>
            )}
            <th className="text-left font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
              Histórico
            </th>
            <th className="text-right font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5 whitespace-nowrap">
              Débito
            </th>
            <th className="text-right font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5 whitespace-nowrap">
              Crédito
            </th>
            <th className="text-right font-medium text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5 whitespace-nowrap">
              Valor
            </th>
          </tr>
        </thead>
        <tbody>
          {variante === "bp" && data.saldoInicial.length > 0 && (
            <tr className="border-b bg-muted/10 font-medium">
              <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                {formatData(data.saldoInicial[0].data_referencia)}
              </td>
              {showConta && <td className="px-2 py-1">—</td>}
              <td className="px-2 py-1 italic text-muted-foreground">
                Saldo inicial
              </td>
              <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">—</td>
              <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">—</td>
              <td className="px-2 py-1 text-right tabular-nums font-medium">
                {fmtValor(saldoInicialTotal)}
              </td>
            </tr>
          )}
          {data.entries.map((r) => {
            const valor = r.debito - r.credito;
            return (
              <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
                <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                  {formatData(r.data)}
                </td>
                {showConta && (
                  <td className="px-2 py-1 whitespace-nowrap font-mono text-[10px] text-muted-foreground">
                    {r.conta_codigo}
                    <span className="ml-1 font-sans text-muted-foreground/70">
                      {data.contasMap[r.conta_codigo]?.descricao ?? ""}
                    </span>
                  </td>
                )}
                <td className="px-2 py-1">{r.historico ?? "—"}</td>
                <td className={cn("px-2 py-1 text-right tabular-nums", r.debito === 0 && "text-muted-foreground/40")}>
                  {fmt(r.debito)}
                </td>
                <td className={cn("px-2 py-1 text-right tabular-nums", r.credito === 0 && "text-muted-foreground/40")}>
                  {fmt(r.credito)}
                </td>
                <td className={cn("px-2 py-1 text-right tabular-nums font-medium", valor < 0 && "text-destructive")}>
                  {fmtValor(valor)}
                </td>
              </tr>
            );
          })}
        </tbody>
        {data.entries.length > 0 && (
          <tfoot>
            <tr className="border-t bg-muted/30 font-semibold">
              <td className="px-2 py-1" colSpan={showConta ? 3 : 2}>
                Total ({data.entries.length} lançamento{data.entries.length === 1 ? "" : "s"})
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtValor(totalDeb)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtValor(totalCre)}</td>
              <td className="px-2 py-1 text-right tabular-nums">
                {fmtValor(totalValor + (variante === "bp" ? saldoInicialTotal : 0))}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
