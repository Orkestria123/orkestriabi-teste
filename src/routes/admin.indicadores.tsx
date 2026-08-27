// Definições de indicadores no nível do ESCRITÓRIO.
// A fórmula é global (plano padrão). A alocação (dashboard / aba) é da empresa.
import { createFileRoute, Link } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { Card } from "@/components/ui/card";
import { LineChart } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { IndicadoresGlobaisPanel } from "@/components/indicadores/indicadores-globais-panel";

export const Route = createFileRoute("/admin/indicadores")({ component: Page });

function Page() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;

  return (
    <PortalShell variant="admin" title="Indicadores">
      <Card className="p-4 mb-4 border-primary/20 bg-primary/5">
        <div className="flex items-start gap-3 text-sm">
          <LineChart className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Plano padrão do escritório</div>
            <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">
              Aqui se cria e edita a fórmula. Todas as empresas usam o mesmo plano —
              o que muda por empresa é só <strong>quais indicadores entram</strong> no dashboard
              e na aba Indicadores, em{" "}
              <Link to="/admin/empresas" className="underline">
                Empresas → Dados → Indicadores
              </Link>
              . Cards e gráficos da Visão Geral também se configuram abaixo.
            </p>
          </div>
        </div>
      </Card>

      {tenantId && <IndicadoresGlobaisPanel tenantId={tenantId} />}
    </PortalShell>
  );
}
