import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
export const Route = createFileRoute("/dashboard/indicadores")({
  component: () => (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight mb-4">Indicadores</h2>
      <Card className="p-10 text-center text-muted-foreground text-sm">
        Página de indicadores em construção. Configure fórmulas em Admin → Configurações.
      </Card>
    </div>
  ),
});
