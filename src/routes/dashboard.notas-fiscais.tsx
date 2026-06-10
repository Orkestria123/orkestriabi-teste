import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters } from "@/components/filter-bar";
import { useFiscalInvoices } from "@/hooks/use-fiscal-data";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatBRL } from "@/lib/format";
import { ArrowDown, ArrowUp, Download, Search, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

function downloadCSV(filename: string, rows: Record<string, any>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(";"), ...rows.map((r) => headers.map((h) => esc(r[h])).join(";"))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export const Route = createFileRoute("/dashboard/notas-fiscais")({ component: Page });

const PAGE_SIZE = 50;

function Page() {
  const { companyId } = useDashboardCompany();
  const { periodos } = useFilters();
  const [tipo, setTipo] = useState<"ALL" | "E" | "S">("ALL");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const { data: invoices, isLoading } = useFiscalInvoices(companyId, periodos, { tipo });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return invoices ?? [];
    return (invoices ?? []).filter((i) => {
      return (
        i.numero?.toLowerCase().includes(term) ||
        i.chave_nfe?.toLowerCase().includes(term) ||
        i.participant_nome?.toLowerCase().includes(term) ||
        i.participant_cnpj?.toLowerCase().includes(term)
      );
    });
  }, [invoices, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totals = useMemo(() => {
    let entradas = 0, saidas = 0, canceladas = 0;
    for (const i of filtered) {
      if (i.cancelada) { canceladas += 1; continue; }
      if (i.tipo === "E") entradas += i.valor_total ?? 0;
      else saidas += i.valor_total ?? 0;
    }
    return { entradas, saidas, canceladas };
  }, [filtered]);

  const handleExport = () => {
    const rows = filtered.map((i) => ({
      Tipo: i.tipo === "E" ? "Entrada" : "Saída",
      Modelo: i.modelo ?? "",
      Série: i.serie ?? "",
      Número: i.numero ?? "",
      "Data emissão": i.data_emissao ?? "",
      Participante: i.participant_nome ?? "",
      CNPJ: i.participant_cnpj ?? "",
      "Valor total": i.valor_total ?? 0,
      ICMS: i.valor_icms ?? 0,
      IPI: i.valor_ipi ?? 0,
      Cancelada: i.cancelada ? "Sim" : "Não",
      Chave: i.chave_nfe ?? "",
    }));
    downloadCSV("notas-fiscais.csv", rows);
  };

  if (!companyId) {
    return <p className="text-sm text-muted-foreground">Selecione uma empresa.</p>;
  }

  if (!isLoading && (invoices?.length ?? 0) === 0) {
    return (
      <Card className="p-12 text-center">
        <FileText className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
        <h3 className="font-semibold mb-1">Nenhuma nota fiscal encontrada</h3>
        <p className="text-sm text-muted-foreground">
          Importe um arquivo SPED Fiscal em Admin → Upload para visualizar as notas.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Entradas</div>
            <div className="text-xl font-semibold tabular-nums mt-1">{formatBRL(totals.entradas)}</div>
          </div>
          <div className="h-9 w-9 rounded-lg bg-success/10 text-success grid place-items-center">
            <ArrowDown className="h-4 w-4" />
          </div>
        </Card>
        <Card className="p-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Saídas</div>
            <div className="text-xl font-semibold tabular-nums mt-1">{formatBRL(totals.saidas)}</div>
          </div>
          <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary grid place-items-center">
            <ArrowUp className="h-4 w-4" />
          </div>
        </Card>
        <Card className="p-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Canceladas</div>
            <div className="text-xl font-semibold tabular-nums mt-1">{totals.canceladas}</div>
          </div>
          <Badge variant="outline" className="border-destructive/30 text-destructive">notas</Badge>
        </Card>
      </div>

      <Card className="p-4 shadow-[var(--shadow-soft)]">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="relative flex-1 max-w-md">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                placeholder="Buscar por nº, CNPJ ou fornecedor"
                className="pl-8 h-9"
              />
            </div>
            <Select value={tipo} onValueChange={(v) => { setTipo(v as any); setPage(1); }}>
              <SelectTrigger className="w-[150px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas</SelectItem>
                <SelectItem value="E">Entradas</SelectItem>
                <SelectItem value="S">Saídas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
            <Download className="h-3.5 w-3.5" /> Exportar CSV
          </Button>
        </div>

        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                <th className="text-left px-2 py-2 font-medium">Tipo</th>
                <th className="text-left px-2 py-2 font-medium">Nº / Série</th>
                <th className="text-left px-2 py-2 font-medium">Emissão</th>
                <th className="text-left px-2 py-2 font-medium">Participante</th>
                <th className="text-right px-2 py-2 font-medium">ICMS</th>
                <th className="text-right px-2 py-2 font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((inv) => (
                <tr
                  key={inv.id}
                  className={cn(
                    "border-b last:border-0 hover:bg-accent/30",
                    inv.cancelada && "opacity-50",
                  )}
                >
                  <td className="px-2 py-2.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] gap-1",
                        inv.tipo === "E" ? "border-success/40 text-success" : "border-primary/40 text-primary",
                      )}
                    >
                      {inv.tipo === "E" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
                      {inv.tipo === "E" ? "Entrada" : "Saída"}
                    </Badge>
                  </td>
                  <td className="px-2 py-2.5 font-mono text-xs">
                    {inv.numero ?? "—"}
                    {inv.serie && <span className="text-muted-foreground"> / {inv.serie}</span>}
                  </td>
                  <td className="px-2 py-2.5 text-muted-foreground">{inv.data_emissao ?? "—"}</td>
                  <td className="px-2 py-2.5">
                    <div className="truncate max-w-[280px]">{inv.participant_nome ?? "—"}</div>
                    {inv.participant_cnpj && (
                      <div className="text-[10px] text-muted-foreground font-mono">{inv.participant_cnpj}</div>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                    {formatBRL(inv.valor_icms ?? 0)}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-medium">
                    {formatBRL(inv.valor_total ?? 0)}
                    {inv.cancelada && (
                      <div><Badge variant="destructive" className="text-[9px] mt-1">Cancelada</Badge></div>
                    )}
                  </td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-10 text-center text-sm text-muted-foreground">
                    Nenhuma nota encontrada com esses filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <span>
              Página {page} de {totalPages} · {filtered.length} notas
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button size="sm" variant="outline" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
