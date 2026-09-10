import { createFileRoute } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { Card } from "@/components/ui/card";
import { Cable } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { SistemasPanel } from "@/components/sistemas/sistemas-panel";

export const Route = createFileRoute("/admin/sistemas")({ component: Page });

function Page() {
  const { profile, role } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const podeEditar = role === "tenant_admin" || role === "orkestria_admin";

  return (
    <PortalShell variant="admin" title="Sistemas e layouts">
      <Card className="p-4 mb-4 border-primary/20 bg-primary/5">
        <div className="flex items-start gap-3 text-sm">
          <Cable className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Como o arquivo de cada ERP chega</div>
            <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">
              Um sistema, um layout. Só as colunas mapeadas entram no BI —
              o arquivo do ERP pode ser grande; o que grava é enxuto.
              O de-para para o Plano Padrão continua por empresa.
            </p>
          </div>
        </div>
      </Card>
      {tenantId ? (
        <SistemasPanel tenantId={tenantId} podeEditar={podeEditar} />
      ) : (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Seu usuário não está vinculado a um escritório.
        </Card>
      )}
    </PortalShell>
  );
}
