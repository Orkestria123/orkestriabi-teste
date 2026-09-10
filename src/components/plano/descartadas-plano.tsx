// Contas novas do diário que o escritório descartou — restaurar volta à fila.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export function DescartadasPlano({
  tenantId, podeEditar,
}: {
  tenantId: string;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["contas-descartadas", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plano_contas_descartadas")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const restaurar = async (codigo: string) => {
    try {
      const { error } = await supabase.rpc("restaurar_conta_descartada", {
        _tenant_id: tenantId, _codigo: codigo,
      });
      if (error) throw error;
      toast.success(`${codigo} voltou para a fila.`);
      qc.invalidateQueries({ queryKey: ["contas-descartadas", tenantId] });
      qc.invalidateQueries({ queryKey: ["contas-novas", tenantId] });
      qc.invalidateQueries({ queryKey: ["contas-novas-empresa", tenantId] });
      qc.invalidateQueries({ queryKey: ["plano-padrao-resumo", tenantId] });
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30">
          <tr>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Código</th>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Motivo</th>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Quando</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((d: any) => (
            <tr key={d.id} className="border-t">
              <td className="px-3 py-2 font-mono">{d.codigo}</td>
              <td className="px-3 py-2 text-muted-foreground">{d.motivo ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {new Date(d.created_at).toLocaleDateString("pt-BR")}
              </td>
              <td className="px-3 py-2 text-right">
                <Button size="sm" variant="ghost" disabled={!podeEditar}
                  onClick={() => restaurar(d.codigo)}>
                  <Undo2 className="h-3.5 w-3.5 mr-1" /> Restaurar
                </Button>
              </td>
            </tr>
          ))}
          {(data ?? []).length === 0 && (
            <tr><td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
              Nenhuma conta descartada.
            </td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
