import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
export const Route = createFileRoute("/dashboard/analise")({
  component: () => (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight mb-4">Análise comparativa</h2>
      <Card className="p-10 text-center text-muted-foreground text-sm">
        Use os filtros de período acima para comparar diferentes meses e anos nas demonstrações.
      </Card>
    </div>
  ),
});
