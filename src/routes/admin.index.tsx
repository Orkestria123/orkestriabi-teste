import { createFileRoute, Link } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAdminOverview } from "@/lib/api/orkestria.functions";
import { Card } from "@/components/ui/card";
import { Building2, Users, HardDrive, Tags, ArrowRight, ScrollText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/")({ component: Page });

const ACAO_LABEL: Record<string, string> = {
  login: "Login",
  logout: "Logout",
  exclusao: "Exclusão",
  vinculo_criado: "Vínculo criado",
  vinculo_removido: "Vínculo removido",
};

function UltimosLogs() {
  const { data } = useQuery({
    queryKey: ["admin-ultimos-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logs_auditoria")
        .select("id, created_at, user_nome, acao, entidade, entidade_nome")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ScrollText className="h-4 w-4" /> Últimos eventos
        </h3>
        <Link to="/admin/logs" className="text-xs text-primary hover:underline">
          Ver todos os logs
        </Link>
      </div>
      {!data?.length ? (
        <p className="text-xs text-muted-foreground">Nenhum evento registrado ainda.</p>
      ) : (
        <ul className="space-y-2">
          {data.map((l: any) => (
            <li key={l.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate">
                <span className="font-medium">{ACAO_LABEL[l.acao] ?? l.acao}</span>
                {" · "}
                {l.user_nome ?? "—"}
                {l.entidade_nome ? ` · ${l.entidade_nome}` : ""}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {new Date(l.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2).replace(".", ",")} GB`;
  return `${mb.toFixed(mb < 10 ? 2 : 1).replace(".", ",")} MB`;
}

function Page() {
  const overviewFn = useServerFn(getAdminOverview);
  const { data } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => overviewFn(),
  });

  return (
    <PortalShell variant="admin" title="Dashboard">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <BigAction
          to="/admin/empresas"
          icon={<Building2 className="h-6 w-6" />}
          title="Gerenciar Empresas"
          desc="Cadastre, configure e acesse o BI das empresas do escritório."
        />
        <BigAction
          to="/admin/usuarios"
          icon={<Users className="h-6 w-6" />}
          title="Gerenciar Usuários"
          desc="Colaboradores do escritório e clientes com acesso ao BI."
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Counter label="Total de Empresas" value={data ? String(data.empresas) : "—"} />
        <Counter
          label="Total de Usuários"
          value={data ? String(data.usuarios) : "—"}
          hint={
            data ? `${data.colaboradores} colaboradores · ${data.clientes} clientes` : undefined
          }
        />
        <Counter
          label="Armazenamento usado"
          value={data ? formatBytes(data.storageBytes) : "—"}
          hint="Arquivos contábeis do escritório"
          icon={<HardDrive className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Distribuicao
          title="Empresas por segmento"
          items={data?.porSegmento ?? []}
          total={data?.empresas ?? 0}
        />
        <Distribuicao
          title="Empresas por porte"
          items={data?.porPorte ?? []}
          total={data?.empresas ?? 0}
        />
      </div>

      <div className="mb-6">
        <UltimosLogs />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Shortcut to="/admin/empresas" icon={<Building2 />} label="Empresas" />
        <Shortcut to="/admin/usuarios" icon={<Users />} label="Usuários" />
        <Shortcut to="/admin/segmentos" icon={<Tags />} label="Segmentos" />
        <Shortcut to="/admin/logs" icon={<ScrollText />} label="Logs" />
      </div>
    </PortalShell>
  );
}

function BigAction({
  to,
  icon,
  title,
  desc,
}: {
  to: "/admin/empresas" | "/admin/usuarios";
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link to={to} className="group">
      <Card className="p-6 h-full flex items-start gap-4 transition-colors hover:border-primary shadow-[var(--shadow-soft)]">
        <div className="rounded-xl bg-primary/10 text-primary p-3">{icon}</div>
        <div className="flex-1">
          <div className="font-semibold text-lg flex items-center gap-2">
            {title}
            <ArrowRight className="h-4 w-4 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
          </div>
          <p className="text-sm text-muted-foreground mt-1">{desc}</p>
        </div>
      </Card>
    </Link>
  );
}

function Counter({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function Distribuicao({
  title,
  items,
  total,
}: {
  title: string;
  items: { nome: string; total: number }[];
  total: number;
}) {
  return (
    <Card className="p-5 shadow-[var(--shadow-soft)]">
      <h3 className="font-semibold mb-4">{title}</h3>
      <div className="space-y-3">
        {items.map((i) => {
          const pct = total > 0 ? (i.total / total) * 100 : 0;
          return (
            <div key={i.nome}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span
                  className={cn(
                    "truncate",
                    i.nome === "Não classificado" && "text-muted-foreground",
                  )}
                >
                  {i.nome}
                </span>
                <span className="tabular-nums font-medium">{i.total}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma empresa cadastrada.</p>
        )}
      </div>
    </Card>
  );
}

function Shortcut({
  to,
  icon,
  label,
}: {
  to: "/admin/empresas" | "/admin/usuarios" | "/admin/segmentos";
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link to={to}>
      <Card className="p-4 flex items-center gap-3 hover:border-primary transition-colors">
        <span className="text-primary [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
        <span className="font-medium">{label}</span>
      </Card>
    </Link>
  );
}
