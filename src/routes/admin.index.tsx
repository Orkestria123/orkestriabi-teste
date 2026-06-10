import { createFileRoute, Link } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getConsolidatedDashboard } from "@/lib/api/insights.functions";
import { Card } from "@/components/ui/card";
import {
  Building2,
  FileText,
  Upload as UploadIcon,
  TrendingUp,
  TrendingDown,
  ArrowRight,
} from "lucide-react";
import { formatBRLCompact, formatPct, periodoLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/")({ component: Page });

function Page() {
  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const [c, f, p] = await Promise.all([
        supabase.from("companies").select("id", { count: "exact", head: true }),
        supabase.from("sped_files").select("id", { count: "exact", head: true }),
        supabase
          .from("sped_files")
          .select("id", { count: "exact", head: true })
          .eq("status", "processing"),
      ]);
      return { companies: c.count ?? 0, files: f.count ?? 0, pending: p.count ?? 0 };
    },
  });

  const consolidatedFn = useServerFn(getConsolidatedDashboard);
  const { data: consolidated, isLoading } = useQuery({
    queryKey: ["admin-consolidated"],
    queryFn: () => consolidatedFn(),
  });

  const totals = consolidated?.totals;
  const companies = consolidated?.companies ?? [];
  const ranking = [...companies]
    .filter((c) => c.lucro != null)
    .sort((a, b) => (b.lucro ?? 0) - (a.lucro ?? 0));
  const variacoes = [...companies]
    .filter((c) => c.variacao_receita != null)
    .sort((a, b) => Math.abs(b.variacao_receita ?? 0) - Math.abs(a.variacao_receita ?? 0))
    .slice(0, 5);

  return (
    <PortalShell variant="admin" title="Dashboard">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Empresas</div>
          <div className="mt-2 text-3xl font-semibold">{stats?.companies ?? 0}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Arquivos processados
          </div>
          <div className="mt-2 text-3xl font-semibold">{stats?.files ?? 0}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Pendentes</div>
          <div className="mt-2 text-3xl font-semibold">{stats?.pending ?? 0}</div>
        </Card>
      </div>

      {companies.length > 0 && (
        <>
          <div className="flex items-center gap-2 border-b border-border/60 pb-2 mb-4">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium">
              Consolidado das empresas
            </span>
          </div>

          {totals && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <ConsolidatedKpi label="Receita consolidada" value={totals.receita} />
              <ConsolidatedKpi label="EBITDA consolidado" value={totals.ebitda} />
              <ConsolidatedKpi
                label="Lucro consolidado"
                value={totals.lucro}
                tone={totals.lucro >= 0 ? "positive" : "negative"}
              />
              <Card className="p-4">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Saúde da carteira
                </div>
                <div className="mt-2 flex items-center gap-3 text-sm">
                  <span className="inline-flex items-center gap-1.5 text-success">
                    <TrendingUp className="h-4 w-4" /> {totals.empresas_lucro} no lucro
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-destructive">
                    <TrendingDown className="h-4 w-4" /> {totals.empresas_deficit} no déficit
                  </span>
                </div>
              </Card>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <Card className="p-5 lg:col-span-2 shadow-[var(--shadow-soft)]">
              <h3 className="font-semibold mb-1">Ranking de lucratividade</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Lucro líquido do último período disponível por empresa
              </p>
              <div className="space-y-2">
                {ranking.map((c) => {
                  const max = Math.max(...ranking.map((r) => Math.abs(r.lucro ?? 0)), 1);
                  const pct = Math.min(100, (Math.abs(c.lucro ?? 0) / max) * 100);
                  const positive = (c.lucro ?? 0) >= 0;
                  return (
                    <Link
                      key={c.id}
                      to="/dashboard"
                      search={{ company: c.id }}
                      className="block group"
                    >
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium group-hover:text-primary transition-colors truncate">
                          {c.name}
                        </span>
                        <span
                          className={cn(
                            "tabular-nums font-medium",
                            positive ? "text-success" : "text-destructive",
                          )}
                        >
                          {formatBRLCompact(c.lucro)}
                          {c.margem != null && (
                            <span className="text-muted-foreground font-normal ml-2">
                              ({formatPct(c.margem)})
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            positive ? "bg-success" : "bg-destructive",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </Link>
                  );
                })}
                {ranking.length === 0 && (
                  <p className="text-sm text-muted-foreground">Sem dados consolidados.</p>
                )}
              </div>
            </Card>

            <Card className="p-5 shadow-[var(--shadow-soft)]">
              <h3 className="font-semibold mb-1">Maiores variações</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Variação de receita vs período anterior
              </p>
              <div className="space-y-3">
                {variacoes.map((c) => {
                  const v = c.variacao_receita ?? 0;
                  const positive = v >= 0;
                  return (
                    <Link
                      key={c.id}
                      to="/dashboard"
                      search={{ company: c.id }}
                      className="flex items-center justify-between text-sm group"
                    >
                      <span className="truncate group-hover:text-primary transition-colors">
                        {c.name}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 tabular-nums font-medium",
                          positive ? "text-success" : "text-destructive",
                        )}
                      >
                        {positive ? (
                          <TrendingUp className="h-3.5 w-3.5" />
                        ) : (
                          <TrendingDown className="h-3.5 w-3.5" />
                        )}
                        {positive ? "+" : ""}
                        {v.toFixed(1).replace(".", ",")}%
                      </span>
                    </Link>
                  );
                })}
                {variacoes.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Necessário dois períodos para comparar.
                  </p>
                )}
              </div>
            </Card>
          </div>

          <Card className="p-5 mb-6 shadow-[var(--shadow-soft)]">
            <h3 className="font-semibold mb-3">Todas as empresas</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-2 px-2 font-medium">Empresa</th>
                    <th className="text-left py-2 px-2 font-medium">Último período</th>
                    <th className="text-right py-2 px-2 font-medium">Receita</th>
                    <th className="text-right py-2 px-2 font-medium">EBITDA</th>
                    <th className="text-right py-2 px-2 font-medium">Lucro</th>
                    <th className="text-right py-2 px-2 font-medium">Margem</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td className="py-2 px-2 font-medium">{c.name}</td>
                      <td className="py-2 px-2 text-muted-foreground">
                        {c.ultimo_periodo ? periodoLabel(c.ultimo_periodo) : "—"}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {c.receita != null ? formatBRLCompact(c.receita) : "—"}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {c.ebitda != null ? formatBRLCompact(c.ebitda) : "—"}
                      </td>
                      <td
                        className={cn(
                          "py-2 px-2 text-right tabular-nums",
                          c.lucro != null && c.lucro < 0 && "text-destructive",
                          c.lucro != null && c.lucro >= 0 && "text-success",
                        )}
                      >
                        {c.lucro != null ? formatBRLCompact(c.lucro) : "—"}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">
                        {c.margem != null ? formatPct(c.margem) : "—"}
                      </td>
                      <td className="py-2 px-2">
                        <Link
                          to="/dashboard"
                          search={{ company: c.id }}
                          className="text-muted-foreground hover:text-primary inline-flex"
                          title="Abrir BI"
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {!isLoading && companies.length === 0 && (
        <Card className="p-6 mb-6 text-center text-sm text-muted-foreground">
          Nenhuma empresa cadastrada ainda. Cadastre suas empresas para ver o consolidado.
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/admin/empresas">
          <Card className="p-5 hover:border-primary transition-colors">
            <Building2 className="h-5 w-5 text-primary mb-3" />
            <div className="font-medium">Gerenciar Empresas</div>
            <div className="text-sm text-muted-foreground mt-1">
              Cadastre e organize seus clientes.
            </div>
          </Card>
        </Link>
        <Link to="/admin/upload">
          <Card className="p-5 hover:border-primary transition-colors">
            <UploadIcon className="h-5 w-5 text-primary mb-3" />
            <div className="font-medium">Upload de SPED</div>
            <div className="text-sm text-muted-foreground mt-1">Importe arquivos contábeis.</div>
          </Card>
        </Link>
        <Link to="/admin/usuarios">
          <Card className="p-5 hover:border-primary transition-colors">
            <FileText className="h-5 w-5 text-primary mb-3" />
            <div className="font-medium">Usuários</div>
            <div className="text-sm text-muted-foreground mt-1">
              Convide clientes para o portal.
            </div>
          </Card>
        </Link>
      </div>
    </PortalShell>
  );
}

function ConsolidatedKpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "positive" | "negative";
}) {
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-2 text-2xl font-semibold tabular-nums",
          tone === "positive" && "text-success",
          tone === "negative" && "text-destructive",
        )}
      >
        {formatBRLCompact(value)}
      </div>
    </Card>
  );
}
