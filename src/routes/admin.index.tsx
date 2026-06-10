import { createFileRoute, Link } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Building2, FileText, Upload as UploadIcon } from "lucide-react";

export const Route = createFileRoute("/admin/")({ component: Page });

function Page() {
  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const [c, f, p] = await Promise.all([
        supabase.from("companies").select("id", { count: "exact", head: true }),
        supabase.from("sped_files").select("id", { count: "exact", head: true }),
        supabase.from("sped_files").select("id", { count: "exact", head: true }).eq("status", "processing"),
      ]);
      return { companies: c.count ?? 0, files: f.count ?? 0, pending: p.count ?? 0 };
    },
  });

  return (
    <PortalShell variant="admin" title="Dashboard">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-5"><div className="text-xs uppercase tracking-wider text-muted-foreground">Empresas</div><div className="mt-2 text-3xl font-semibold">{stats?.companies ?? 0}</div></Card>
        <Card className="p-5"><div className="text-xs uppercase tracking-wider text-muted-foreground">Arquivos processados</div><div className="mt-2 text-3xl font-semibold">{stats?.files ?? 0}</div></Card>
        <Card className="p-5"><div className="text-xs uppercase tracking-wider text-muted-foreground">Pendentes</div><div className="mt-2 text-3xl font-semibold">{stats?.pending ?? 0}</div></Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/admin/empresas"><Card className="p-5 hover:border-primary transition-colors"><Building2 className="h-5 w-5 text-primary mb-3" /><div className="font-medium">Gerenciar Empresas</div><div className="text-sm text-muted-foreground mt-1">Cadastre e organize seus clientes.</div></Card></Link>
        <Link to="/admin/upload"><Card className="p-5 hover:border-primary transition-colors"><UploadIcon className="h-5 w-5 text-primary mb-3" /><div className="font-medium">Upload de SPED</div><div className="text-sm text-muted-foreground mt-1">Importe arquivos contábeis.</div></Card></Link>
        <Link to="/admin/usuarios"><Card className="p-5 hover:border-primary transition-colors"><FileText className="h-5 w-5 text-primary mb-3" /><div className="font-medium">Usuários</div><div className="text-sm text-muted-foreground mt-1">Convide clientes para o portal.</div></Card></Link>
      </div>
    </PortalShell>
  );
}
