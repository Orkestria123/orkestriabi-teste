import { createFileRoute } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Building2, Users, FileText, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/orkestria-admin/")({ component: Page });

function Page() {
  const { data: stats } = useQuery({
    queryKey: ["ork-stats"],
    queryFn: async () => {
      const [t, c, f] = await Promise.all([
        supabase.from("tenants").select("id", { count: "exact", head: true }),
        supabase.from("companies").select("id", { count: "exact", head: true }),
        supabase.from("sped_files").select("id", { count: "exact", head: true }),
      ]);
      return { tenants: t.count ?? 0, companies: c.count ?? 0, files: f.count ?? 0 };
    },
  });

  const cards = [
    { label: "Tenants ativos", value: stats?.tenants ?? 0, icon: Building2 },
    { label: "Empresas", value: stats?.companies ?? 0, icon: Users },
    { label: "Arquivos SPED", value: stats?.files ?? 0, icon: FileText },
    { label: "MRR estimado", value: "R$ 0", icon: TrendingUp },
  ];

  return (
    <PortalShell variant="orkestria" title="Visão geral da plataforma">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.label} className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</div>
              </div>
              <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <c.icon className="h-4 w-4" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </PortalShell>
  );
}
