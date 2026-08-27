import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PortalShell } from "@/components/portal-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Save, Settings2, CheckCircle2 } from "lucide-react";
import { formatBRL } from "@/lib/format";

export const Route = createFileRoute("/admin/classificacao-custos")({
  component: Page,
});

type TipoCusto = "fixo" | "variavel" | null;

interface MapRow {
  id: string;
  company_id: string | null;
  classificacao_prefixo: string;
  linha_demonstracao: string;
  tipo_demonstracao: string;
  tipo_custo: TipoCusto;
}

function Page() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState<string>("");
  const [dirty, setDirty] = useState<Map<string, TipoCusto>>(new Map());
  const [saving, setSaving] = useState(false);

  const { data: companies = [] } = useQuery({
    queryKey: ["admin-classif-companies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, razao_social")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["plano-tipo-custo", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data: emp } = await supabase
        .from("companies")
        .select("tenant_id")
        .eq("id", companyId)
        .maybeSingle();
      if (!emp?.tenant_id) return [] as MapRow[];

      const { data, error } = await supabase
        .from("plano_contas")
        .select("id, company_id, classificacao, descricao, tipo, tipo_custo")
        .eq("tenant_id", emp.tenant_id)
        .or(`company_id.is.null,company_id.eq.${companyId}`)
        .eq("is_participante", false)
        .or("classificacao.like.3.06%,classificacao.like.3.15%")
        .order("classificacao")
        .limit(2000);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        company_id: r.company_id,
        classificacao_prefixo: r.classificacao,
        linha_demonstracao: r.descricao,
        tipo_demonstracao: r.tipo,
        tipo_custo: (r.tipo_custo ?? null) as TipoCusto,
      })) as MapRow[];
    },
  });

  const grupos = useMemo(() => {
    const map = new Map<string, MapRow[]>();
    for (const r of rows) {
      const k = r.classificacao_prefixo.split(".").slice(0, 2).join(".");
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return Array.from(map.entries()).sort();
  }, [rows]);

  const stats = useMemo(() => {
    const total = rows.length;
    const classificados = rows.filter((r) => {
      const eff = dirty.has(r.id) ? dirty.get(r.id) : r.tipo_custo;
      return eff != null;
    }).length;
    return { total, classificados, pct: total > 0 ? (classificados / total) * 100 : 0 };
  }, [rows, dirty]);

  function setLocal(id: string, v: TipoCusto) {
    const next = new Map(dirty);
    next.set(id, v);
    setDirty(next);
  }

  async function salvar() {
    if (dirty.size === 0) return;
    setSaving(true);
    try {
      // update em paralelo
      const updates = Array.from(dirty.entries()).map(([id, tipo_custo]) =>
        supabase.from("plano_contas").update({ tipo_custo }).eq("id", id),
      );
      const results = await Promise.all(updates);
      const errs = results.filter((r) => r.error);
      if (errs.length > 0) throw new Error(`${errs.length} falhas`);
      toast.success(`${dirty.size} classificações salvas.`);
      setDirty(new Map());
      qc.invalidateQueries({ queryKey: ["plano-tipo-custo", companyId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PortalShell variant="admin" title="Classificação Fixo / Variável">
      <div className="max-w-4xl space-y-5">
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <Settings2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Classifique cada grupo de despesa</h3>
              <p className="text-xs text-muted-foreground">
                A análise de <strong>Ponto de Equilíbrio</strong> precisa saber quais despesas
                são fixas (independem do volume) e quais variam com a receita (matéria-prima,
                comissões, impostos sobre vendas). Marque cada linha e clique em Salvar.
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs text-muted-foreground">Empresa</label>
            <select
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setDirty(new Map());
              }}
              className="text-sm border rounded-md px-2 py-1 bg-background"
            >
              <option value="">— selecione —</option>
              {companies.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.razao_social ?? c.name}
                </option>
              ))}
            </select>
            {companyId && rows.length > 0 && (
              <div className="ml-auto flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {stats.classificados}/{stats.total} classificados ·{" "}
                  <strong>{stats.pct.toFixed(0)}%</strong>
                </span>
                <Button size="sm" disabled={dirty.size === 0 || saving} onClick={salvar}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <Save className="h-4 w-4 mr-1.5" />
                  )}
                  Salvar ({dirty.size})
                </Button>
              </div>
            )}
          </div>

          {!companyId && (
            <p className="text-xs text-muted-foreground">
              Selecione uma empresa para começar.
            </p>
          )}
        </Card>

        {companyId && isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        )}

        {companyId && !isLoading && rows.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground space-y-2">
            <p>Esta empresa não tem mapeamento de despesa configurado ainda.</p>
            <Link
              to="/admin/empresas/$id/dados"
              params={{ id: companyId }}
              className="text-primary hover:underline"
            >
              Configurar mapeamento →
            </Link>
          </Card>
        )}

        {grupos.map(([grupo, items]) => (
          <Card key={grupo} className="p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Grupo {grupo}
            </p>
            <div className="divide-y">
              {items.map((r) => {
                const eff = dirty.has(r.id) ? dirty.get(r.id) : r.tipo_custo;
                return (
                  <div
                    key={r.id}
                    className="py-2.5 flex items-center justify-between gap-3 flex-wrap"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{r.linha_demonstracao}</p>
                      <p className="text-[11px] text-muted-foreground">
                        prefixo {r.classificacao_prefixo}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Pill
                        active={eff === "fixo"}
                        onClick={() => setLocal(r.id, eff === "fixo" ? null : "fixo")}
                        tone="fixo"
                      >
                        Fixo
                      </Pill>
                      <Pill
                        active={eff === "variavel"}
                        onClick={() =>
                          setLocal(r.id, eff === "variavel" ? null : "variavel")
                        }
                        tone="variavel"
                      >
                        Variável
                      </Pill>
                      {eff != null && dirty.has(r.id) && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-warning ml-1" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </PortalShell>
  );
}

function Pill({
  children,
  active,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  tone: "fixo" | "variavel";
}) {
  const activeCls =
    tone === "fixo"
      ? "bg-primary text-primary-foreground border-primary"
      : "bg-warning text-warning-foreground border-warning";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
        active ? activeCls : "border-border hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}
