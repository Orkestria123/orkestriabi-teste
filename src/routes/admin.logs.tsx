import { createFileRoute } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, ChevronLeft, ChevronRight, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/admin/logs")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Logs de auditoria | Orkestria BI" },
      { name: "description", content: "Histórico de eventos de segurança do escritório: acessos, exclusões e vínculos de acesso." },
      { property: "og:title", content: "Logs de auditoria | Orkestria BI" },
      { property: "og:description", content: "Histórico de eventos de segurança do escritório no Orkestria BI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const PAGE_SIZE = 25;

const ACOES: Record<string, { label: string; tone: string }> = {
  login: { label: "Login", tone: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  logout: { label: "Logout", tone: "bg-muted text-muted-foreground" },
  exclusao: { label: "Exclusão", tone: "bg-destructive/10 text-destructive border-destructive/30" },
  vinculo_criado: { label: "Vínculo criado", tone: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  vinculo_removido: { label: "Vínculo removido", tone: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  upload: { label: "Upload", tone: "bg-muted text-muted-foreground" },
  download: { label: "Download", tone: "bg-muted text-muted-foreground" },
  edicao: { label: "Edição", tone: "bg-muted text-muted-foreground" },
};

interface LogRow {
  id: string;
  created_at: string;
  user_nome: string | null;
  user_tipo: string | null;
  acao: string;
  entidade: string | null;
  entidade_nome: string | null;
  detalhes: Record<string, unknown> | null;
  ip: string | null;
}

function fmtData(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

function resumoDetalhes(l: LogRow) {
  const d = (l.detalhes ?? {}) as Record<string, any>;
  const partes: string[] = [];
  if (d.cliente_nome) partes.push(`cliente: ${d.cliente_nome}`);
  if (d.empresa_nome) partes.push(`empresa: ${d.empresa_nome}`);
  for (const [k, v] of Object.entries(d)) {
    if (["cliente_nome", "empresa_nome", "cliente_id"].includes(k)) continue;
    if (v === null || typeof v === "object") continue;
    partes.push(`${k}: ${String(v)}`);
  }
  return partes.join(" · ");
}

function Page() {
  const { profile } = useAuth();
  const [acao, setAcao] = useState("todas");
  const [entidade, setEntidade] = useState("todas");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);

  const filtros = { acao, entidade, de, ate, busca };
  const { data, isLoading, error } = useQuery({
    queryKey: ["logs-auditoria", filtros, pagina],
    queryFn: async () => {
      let q = supabase
        .from("logs_auditoria")
        .select("id, created_at, user_nome, user_tipo, acao, entidade, entidade_nome, detalhes, ip", {
          count: "exact",
        })
        .order("created_at", { ascending: false })
        .range(pagina * PAGE_SIZE, pagina * PAGE_SIZE + PAGE_SIZE - 1);

      if (acao !== "todas") q = q.eq("acao", acao);
      if (entidade !== "todas") q = q.eq("entidade", entidade);
      if (de) q = q.gte("created_at", new Date(`${de}T00:00:00`).toISOString());
      if (ate) q = q.lte("created_at", new Date(`${ate}T23:59:59`).toISOString());
      if (busca.trim()) {
        const t = `%${busca.trim()}%`;
        q = q.or(`user_nome.ilike.${t},entidade_nome.ilike.${t}`);
      }
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as LogRow[], total: count ?? 0 };
    },
  });

  const total = data?.total ?? 0;
  const maxPagina = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const entidades = useMemo(
    () => ["usuario", "empresa", "vinculo", "arquivo", "segmento", "sessao", "escritorio"],
    [],
  );

  const semAcesso = profile && (profile as any).tipo_usuario === "cliente";

  const resetar = () => {
    setAcao("todas"); setEntidade("todas"); setDe(""); setAte(""); setBusca(""); setPagina(0);
  };

  return (
    <PortalShell variant="admin" title="Logs de auditoria">
      {semAcesso ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <ShieldAlert className="mx-auto mb-3 h-6 w-6" />
          Esta área é restrita aos administradores do escritório.
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="grid gap-3 md:grid-cols-5">
              <div className="space-y-1">
                <Label className="text-xs">Ação</Label>
                <Select value={acao} onValueChange={(v) => { setAcao(v); setPagina(0); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    {Object.entries(ACOES).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Entidade</Label>
                <Select value={entidade} onValueChange={(v) => { setEntidade(v); setPagina(0); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    {entidades.map((e) => (
                      <SelectItem key={e} value={e}>{e}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">De</Label>
                <Input type="date" value={de} onChange={(e) => { setDe(e.target.value); setPagina(0); }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Até</Label>
                <Input type="date" value={ate} onChange={(e) => { setAte(e.target.value); setPagina(0); }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Buscar usuário/empresa</Label>
                <Input
                  value={busca}
                  onChange={(e) => { setBusca(e.target.value); setPagina(0); }}
                  placeholder="Nome..."
                />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{total} evento(s)</span>
              <Button variant="ghost" size="sm" onClick={resetar}>Limpar filtros</Button>
            </div>
          </Card>

          <Card className="overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center p-10 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
              </div>
            ) : error ? (
              <div className="p-8 text-center text-sm text-destructive">
                Não foi possível carregar os logs.
              </div>
            ) : !data?.rows.length ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Nenhum evento encontrado.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Data/hora</th>
                      <th className="px-3 py-2 text-left">Usuário</th>
                      <th className="px-3 py-2 text-left">Ação</th>
                      <th className="px-3 py-2 text-left">Entidade</th>
                      <th className="px-3 py-2 text-left">Detalhes</th>
                      <th className="px-3 py-2 text-left">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((l) => {
                      const meta = ACOES[l.acao] ?? { label: l.acao, tone: "bg-muted" };
                      return (
                        <tr key={l.id} className="border-t border-border/60 align-top">
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtData(l.created_at)}</td>
                          <td className="px-3 py-2">
                            <div>{l.user_nome ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{l.user_tipo ?? "—"}</div>
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className={meta.tone}>{meta.label}</Badge>
                          </td>
                          <td className="px-3 py-2">
                            <div>{l.entidade ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{l.entidade_nome ?? ""}</div>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{resumoDetalhes(l)}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{l.ip ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">
              Página {pagina + 1} de {maxPagina + 1}
            </span>
            <Button variant="outline" size="icon" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled={pagina >= maxPagina}
              onClick={() => setPagina((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
