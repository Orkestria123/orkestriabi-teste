import { createFileRoute } from "@tanstack/react-router";
import { useDashboardCompany } from "./dashboard";
import { useFilters } from "@/components/filter-bar";
import { useFinancialStatement } from "@/hooks/use-financial-data";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useMemo, useState } from "react";
import { formatBRL, formatPct, periodoLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/analise")({ component: Page });

function Page() {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const [tipo, setTipo] = useState<"DRE" | "BP">("DRE");
  const { data, isLoading } = useFinancialStatement(companyId, tipo, periodos);

  const rows = useMemo(() => {
    const map = new Map<string, { descricao: string; nivel: number; is_subtotal: boolean; linha_ordem: number; values: Record<string, number> }>();
    for (const r of data ?? []) {
      const key = `${r.linha_ordem}-${r.descricao}`;
      if (!map.has(key)) {
        map.set(key, { descricao: r.descricao ?? "", nivel: r.nivel ?? 0, is_subtotal: r.is_subtotal ?? false, linha_ordem: r.linha_ordem ?? 0, values: {} });
      }
      map.get(key)!.values[r.periodo] = Number(r.valor) || 0;
    }
    return Array.from(map.values()).sort((a, b) => a.linha_ordem - b.linha_ordem);
  }, [data]);

  const base = periodos[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Análise comparativa</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Variações absolutas e percentuais entre os períodos selecionados (base = {base ? periodoLabel(base) : "—"}).
          </p>
        </div>
        <Select value={tipo} onValueChange={(v) => setTipo(v as "DRE" | "BP")}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="DRE">DRE</SelectItem>
            <SelectItem value="BP">Balanço Patrimonial</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          Nenhum dado para os filtros selecionados.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground sticky left-0 bg-muted/30">Descrição</th>
                  {periodos.map((p) => (
                    <th key={p} className="text-right px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground tabular-nums" colSpan={2}>
                      {periodoLabel(p)}
                    </th>
                  ))}
                </tr>
                <tr className="bg-muted/20">
                  <th></th>
                  {periodos.map((p, i) => (
                    <>
                      <th key={`${p}-v`} className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">Valor</th>
                      <th key={`${p}-d`} className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {i === 0 ? "Base" : "Δ%"}
                      </th>
                    </>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={idx} className={cn("border-t hover:bg-accent/40", r.is_subtotal && "bg-muted/40 font-semibold")}>
                    <td className="px-4 py-2.5 sticky left-0 bg-card" style={{ paddingLeft: `${16 + r.nivel * 16}px` }}>
                      {r.descricao}
                    </td>
                    {periodos.map((p, i) => {
                      const v = r.values[p] ?? 0;
                      const baseV = r.values[base] ?? 0;
                      const delta = i === 0 ? null : baseV !== 0 ? ((v - baseV) / Math.abs(baseV)) * 100 : null;
                      return (
                        <>
                          <td key={`${p}-v`} className="px-4 py-2.5 text-right tabular-nums">{formatBRL(v)}</td>
                          <td key={`${p}-d`} className={cn("px-4 py-2.5 text-right tabular-nums text-xs", delta != null && delta > 0 && "text-success", delta != null && delta < 0 && "text-destructive")}>
                            {i === 0 ? "—" : delta != null ? formatPct(delta) : "—"}
                          </td>
                        </>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
