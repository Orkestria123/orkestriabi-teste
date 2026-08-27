import { useMemo } from "react";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFiltersOptional } from "@/components/filter-bar";
import { useLancamentosDrilldown } from "@/hooks/use-drilldown";
import { formatBRLPlain, tituloConta } from "@/lib/format";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  codigoConta: string; // classificação do plano, ou código da DFC
  descricao: string;
  periods: string[];
  colSpanLeft: number;
  colSpanRight: number;
  extraMiddleCols?: number;
  variante?: "dre" | "bp" | "dfc";
  emMilhares?: boolean;
  filtroConta?: string;
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
  filtroConta = "",
}: Props) {
  const { companyId } = useDashboardCompany();
  const filter = useFiltersOptional();
  const usePeriods = periods.length > 0 ? periods : (filter?.periodos ?? []);
  const { data, isLoading } = useLancamentosDrilldown(
    companyId,
    codigoConta,
    usePeriods,
    {
      incluirSaldoInicial: variante === "bp",
      chaveDfc: variante === "dfc",
    },
    true,
  );

  const scale = emMilhares ? 1000 : 1;
  const digits = emMilhares ? 1 : 2;
  const fmt = (n: number) =>
    n === 0 ? "—" : formatBRLPlain(n, { digits, scale });
  const fmtValor = (n: number) => formatBRLPlain(n, { digits, scale });

  const totalCols = colSpanLeft + periods.length + extraMiddleCols + colSpanRight;

  // Filtra as entradas pelo texto do filtro
  const entriesFiltradas = useMemo(() => {
    if (!data?.entries || !filtroConta?.trim()) return data?.entries ?? [];
    const termo = filtroConta.trim().toLowerCase();
    return data.entries.filter((e) =>
      e.conta_codigo.toLowerCase().includes(termo) ||
      (e.historico && e.historico.toLowerCase().includes(termo))
    );
  }, [data?.entries, filtroConta]);

  const ajustesFiltrados = useMemo(() => {
    if (!data?.ajustes || !filtroConta?.trim()) return data?.ajustes ?? [];
    const termo = filtroConta.trim().toLowerCase();
    return data.ajustes.filter((a) =>
      a.conta_codigo.toLowerCase().includes(termo) ||
      a.descricao.toLowerCase().includes(termo)
    );
  }, [data?.ajustes, filtroConta]);

  const totalDeb = entriesFiltradas.reduce((a, r) => a + r.debito, 0);
  const totalCre = entriesFiltradas.reduce((a, r) => a + r.credito, 0);
  
  const saldoInicialTotal = data?.saldoInicial.reduce((a, r) => a + r.saldo, 0) ?? 0;
  const ajustesDeb = ajustesFiltrados.reduce((a, r) => a + r.debito, 0);
  const ajustesCre = ajustesFiltrados.reduce((a, r) => a + r.credito, 0);
  const ajustesAnteriores = ajustesFiltrados.filter((a) => a.isAnterior);
  const ajustesPeriodo = ajustesFiltrados.filter((a) => !a.isAnterior);
  const ajustesAntTotal =
    ajustesAnteriores.reduce((a, r) => a + r.debito - r.credito, 0);

  const totalGeral =
    totalDeb -
    totalCre +
    (variante === "bp" ? saldoInicialTotal : 0) +
    (ajustesDeb - ajustesCre);

  return (
    <tr className="bg-muted/20">
      <td colSpan={totalCols} className="p-0">
        <div className="px-6 py-2 border-l-2 border-primary/40 bg-muted/30">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Drill-down · {descricao}
            {data && data.contasEncontradas > 0 && (
              <span className="ml-2 text-muted-foreground/70 normal-case tracking-normal">
                {data.contasEncontradas} conta{data.contasEncontradas > 1 ? "s" : ""} ·{" "}
                {entriesFiltradas.length} lançamento{entriesFiltradas.length === 1 ? "" : "s"}
                {filtroConta && ` · filtrado por "${filtroConta}"`}
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
          ) : entriesFiltradas.length === 0 && data.saldoInicial.length === 0 && ajustesFiltrados.length === 0 ? (
            <div className="py-3 text-xs text-muted-foreground">
              {filtroConta
                ? `Nenhum lançamento encontrado com o filtro "${filtroConta}" para as ${data.contasEncontradas} conta(s) desta linha.`
                : `Sem lançamentos no período selecionado para as ${data.contasEncontradas} conta(s) desta linha.`
              }
            </div>
          ) : (
            <DrilldownTable
              data={data}
              entriesFiltradas={entriesFiltradas}
              ajustesFiltrados={ajustesFiltrados}
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
  entriesFiltradas,
  ajustesFiltrados,
  variante,
  fmt,
  fmtValor,
  showConta,
}: {
  data: NonNullable<ReturnType<typeof useLancamentosDrilldown>["data"]>;
  entriesFiltradas: any[];
  ajustesFiltrados: any[];
  variante: "dre" | "bp" | "dfc";
  fmt: (n: number) => string;
  fmtValor: (n: number) => string;
  showConta: boolean;
}) {
  const totalDeb = entriesFiltradas.reduce((a, r) => a + r.debito, 0);
  const totalCre = entriesFiltradas.reduce((a, r) => a + r.credito, 0);
  
  const saldoInicialTotal = data.saldoInicial.reduce((a, r) => a + r.saldo, 0);
  const ajustesDeb = ajustesFiltrados.reduce((a, r) => a + r.debito, 0);
  const ajustesCre = ajustesFiltrados.reduce((a, r) => a + r.credito, 0);
  const ajustesAnteriores = ajustesFiltrados.filter((a) => a.isAnterior);
  const ajustesPeriodo = ajustesFiltrados.filter((a) => !a.isAnterior);
  const ajustesAntTotal =
    ajustesAnteriores.reduce((a, r) => a + r.debito - r.credito, 0);

  const totalGeral =
    totalDeb -
    totalCre +
    (variante === "bp" ? saldoInicialTotal : 0) +
    (ajustesDeb - ajustesCre);

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
          {variante === "bp" && ajustesAnteriores.length > 0 && (
            <tr className="border-b bg-amber-500/5 font-medium">
              <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                {formatData(ajustesAnteriores[ajustesAnteriores.length - 1].competencia)}
              </td>
              {showConta && <td className="px-2 py-1">—</td>}
              <td className="px-2 py-1 italic text-muted-foreground">
                <GerencialBadge /> Ajustes acumulados de competências anteriores ({ajustesAnteriores.length})
              </td>
              <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">—</td>
              <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">—</td>
              <td className="px-2 py-1 text-right tabular-nums font-medium">
                {fmtValor(ajustesAntTotal)}
              </td>
            </tr>
          )}
          {entriesFiltradas.map((r) => {
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
                      {tituloConta(data.contasMap[r.conta_codigo]?.descricao ?? "")}
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
          {ajustesPeriodo.map((a) => {
            const valor = a.debito - a.credito;
            return (
              <tr key={a.id} className="border-b last:border-0 bg-amber-500/5 hover:bg-amber-500/10">
                <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                  {formatData(a.competencia)}
                </td>
                {showConta && (
                  <td className="px-2 py-1 whitespace-nowrap font-mono text-[10px] text-muted-foreground">
                    {a.conta_codigo}
                    <span className="ml-1 font-sans text-muted-foreground/70">
                      {tituloConta(data.contasMap[a.conta_codigo]?.descricao ?? "")}
                    </span>
                  </td>
                )}
                <td className="px-2 py-1">
                  <GerencialBadge /> {a.descricao}
                  <span className="ml-1 text-muted-foreground/70">
                    (contrapartida: {a.contraconta})
                  </span>
                </td>
                <td className={cn("px-2 py-1 text-right tabular-nums", a.debito === 0 && "text-muted-foreground/40")}>
                  {fmt(a.debito)}
                </td>
                <td className={cn("px-2 py-1 text-right tabular-nums", a.credito === 0 && "text-muted-foreground/40")}>
                  {fmt(a.credito)}
                </td>
                <td className={cn("px-2 py-1 text-right tabular-nums font-medium", valor < 0 && "text-destructive")}>
                  {fmtValor(valor)}
                </td>
              </tr>
            );
          })}
        </tbody>
        {(entriesFiltradas.length > 0 || ajustesPeriodo.length > 0) && (
          <tfoot>
            <tr className="border-t bg-muted/30 font-semibold">
              <td className="px-2 py-1" colSpan={showConta ? 3 : 2}>
                Total ({entriesFiltradas.length + ajustesPeriodo.length} lançamento{entriesFiltradas.length + ajustesPeriodo.length === 1 ? "" : "s"})
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtValor(totalDeb + ajustesDeb)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtValor(totalCre + ajustesCre)}</td>
              <td className="px-2 py-1 text-right tabular-nums">
                {fmtValor(totalGeral)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function GerencialBadge() {
  return (
    <span className="inline-flex items-center rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/30 mr-1">
      Gerencial
    </span>
  );
}