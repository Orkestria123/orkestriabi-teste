import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PortalShell } from "@/components/portal-shell";
import { useAuth } from "@/hooks/use-auth";
import { RelatoriosAdmin } from "@/components/relatorio/relatorios-admin";

export const Route = createFileRoute("/admin/relatorios")({
  validateSearch: z.object({ company: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Relatório Executivo — Orkestria BI" },
      { name: "description", content: "Modelo padrão e relatórios executivos mensais por empresa." },
      { property: "og:title", content: "Relatório Executivo — Orkestria BI" },
      { property: "og:description", content: "Gere, edite e disponibilize o relatório executivo mensal de cada empresa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { profile } = useAuth();
  const { company } = Route.useSearch();
  return (
    <PortalShell variant="admin" title="Relatório Executivo">
      <div className="p-4">
        {profile?.tenant_id ? <RelatoriosAdmin tenantId={profile.tenant_id} companyId={company} /> : <div className="text-sm text-muted-foreground">Tenant não identificado.</div>}
      </div>
    </PortalShell>
  );
}
