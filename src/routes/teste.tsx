import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { getTesteData } from "@/lib/api/teste.functions";
import { StatementTable, type StatementRow } from "@/components/statement-table";
import { Loader2 } from "lucide-react";

const TIPOS: { key: string; label: string }[] = [
  { key: "DRE", label: "DRE" },
  { key: "BP_ATIVO", label: "BP — Ativo" },
  { key: "BP_PASSIVO", label: "BP — Passivo" },
  { key: "DFC", label: "DFC" },
  { key: "DLPA", label: "DLPA" },
  { key: "DVA", label: "DVA" },
];

function buildRows(data: any[]): { rows: StatementRow[]; periods: string[] } {
  const map = new Map<string, StatementRow>();
  const periodSet = new Set<string>();
  for (const r of data) {
    const key = `${r.linha_ordem}-${r.descricao}`;
    if (!map.has(key)) {
      map.set(key, {
        descricao: r.descricao,
        codigo_conta: r.codigo_conta,
        nivel: r.nivel ?? 0,
        is_subtotal: r.is_subtotal ?? false,
        values: {},
        linha_ordem: r.linha_ordem ?? 0,
      });
    }
    map.get(key)!.values[r.periodo] = Number(r.valor) || 0;
    periodSet.add(r.periodo);
  }
  return {
    rows: Array.from(map.values()).sort((a, b) => a.linha_ordem - b.linha_ordem),
    periods: Array.from(periodSet).sort(),
  };
}

function TestePage() {
  const fetchData = useServerFn(getTesteData);
  const { data, isLoading, error } = useQuery({
    queryKey: ["teste-data"],
    queryFn: () => fetchData(),
  });
  const [tipo, setTipo] = useState("DRE");

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of data?.statements ?? []) {
      c.set(r.tipo_demonstracao, (c.get(r.tipo_demonstracao) ?? 0) + 1);
    }
    return c;
  }, [data]);

  const { rows, periods } = useMemo(
    () =>
      buildRows((data?.statements ?? []).filter((r: any) => r.tipo_demonstracao === tipo)),
    [data, tipo],
  );

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          Página de teste — sem autenticação. Remover após validação.
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {data?.company?.name ?? "Empresa de teste"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data?.company?.razao_social} {data?.company?.cnpj ? `• ${data.company.cnpj}` : ""}
            {data ? ` • ${data.statements.length} linhas carregadas` : ""}
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando dados do banco…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            Erro ao carregar: {(error as Error).message}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {TIPOS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTipo(t.key)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    tipo === t.key
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card hover:bg-muted"
                  }`}
                >
                  {t.label}
                  <span className="ml-1.5 text-xs opacity-70">
                    {counts.get(t.key) ?? 0}
                  </span>
                </button>
              ))}
            </div>
            <StatementTable rows={rows} periods={periods} />
          </>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/teste")({
  component: TestePage,
});
