// Cartão de contexto do de-para: qual sistema de origem a empresa usa e
// como o arquivo dele é lido. O layout é do sistema (Admin → Sistemas e
// layouts); aqui só se mostra e se troca o sistema da empresa.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  tenantId: string;
  companyId: string;
  sistemaId: string | null;
}

interface Sistema {
  id: string;
  nome: string;
  layout: Record<string, string> | null;
}

const SEM = "__SEM__";

export function DeParaArquivoCard({ tenantId, companyId, sistemaId }: Props) {
  const qc = useQueryClient();

  const { data: sistemas = [] } = useQuery({
    queryKey: ["sistemas-contabeis", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sistemas_contabeis")
        .select("id, nome, layout")
        .eq("tenant_id", tenantId)
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Sistema[];
    },
  });

  const atual = sistemas.find((s) => s.id === sistemaId) ?? null;
  const colunas = Object.entries(atual?.layout ?? {}).filter(([, v]) => !!v);

  const trocar = async (valor: string) => {
    const novo = valor === SEM ? null : valor;
    const { error } = await (supabase as any)
      .from("companies")
      .update({ sistema_id: novo })
      .eq("id", companyId);
    if (error) { toast.error(error.message); return; }
    toast.success("Sistema de origem atualizado.");
    qc.invalidateQueries({ queryKey: ["empresa", companyId] });
    qc.invalidateQueries({ queryKey: ["sistemas-contabeis", tenantId] });
  };

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3 flex-wrap">
        <FileSpreadsheet className="h-4 w-4 text-primary mt-1 shrink-0" />
        <div className="grow min-w-[240px]">
          <div className="text-sm font-medium">Arquivo de origem</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            O mapa de colunas é do sistema e se edita em{" "}
            <Link to="/admin/sistemas" className="underline">Sistemas e layouts</Link>.
          </p>
          {colunas.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {colunas.map(([k, v]) => (
                <Badge key={k} variant="outline" className="text-[11px] font-normal">
                  {k}: {v}
                </Badge>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground mt-2">
              {atual ? "Sistema sem layout configurado." : "Nenhum sistema de origem definido."}
            </div>
          )}
        </div>
        <div className="min-w-[200px]">
          <Select value={sistemaId ?? SEM} onValueChange={trocar}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Sistema de origem" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM}>Sem sistema definido</SelectItem>
              {sistemas.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </Card>
  );
}
