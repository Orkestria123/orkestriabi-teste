import { createFileRoute } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { useAuth } from "@/hooks/use-auth";
import { AnalisesConfigPanel } from "@/components/analise/analises-config-panel";

export const Route = createFileRoute("/admin/analises")({ component: Page });

function Page() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;

  return (
    <PortalShell variant="admin" title="Análises">
      {tenantId ? (
        <AnalisesConfigPanel tenantId={tenantId} />
      ) : (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          Tenant não identificado.
        </div>
      )}
    </PortalShell>
  );
}
