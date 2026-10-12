import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useDashboardCompany } from "@/components/dashboard-context";
import { Button } from "@/components/ui/button";
import { mesExtenso } from "@/lib/relatorio/tipos";

export const Route = createFileRoute("/dashboard/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios Executivos — Orkestria BI" },
      { name: "description", content: "Relatórios executivos mensais disponibilizados pelo seu escritório." },
      { property: "og:title", content: "Relatórios Executivos — Orkestria BI" },
      { property: "og:description", content: "Baixe os relatórios mensais de resultados da sua empresa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { companyId } = useDashboardCompany();
  const { data, isLoading } = useQuery({
    queryKey: ["relatorios-cliente", companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data } = await (supabase as any).from("relatorios_executivos")
        .select("id, competencia, titulo, pdf_path, disponibilizado_em").eq("company_id", companyId)
        .eq("status", "disponibilizado").order("competencia", { ascending: false });
      return data ?? [];
    },
  });
  const abrir = async (path: string) => {
    const { data, error } = await supabase.storage.from("relatorios").createSignedUrl(path, 600);
    if (error || !data) return toast.error("Não foi possível abrir o relatório.");
    window.open(data.signedUrl, "_blank");
  };
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Relatórios Executivos</h2>
      <div className="rounded-lg border bg-card divide-y">
        {isLoading ? <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
          : !data?.length ? <div className="p-6 text-center text-sm text-muted-foreground">Nenhum relatório disponibilizado ainda.</div>
          : data.map((r: any) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <FileText className="h-5 w-5 text-primary" />
              <div className="flex-1">
                <div className="font-medium">Relatório Executivo — {mesExtenso(r.competencia)}</div>
                <div className="text-xs text-muted-foreground">Disponibilizado em {new Date(r.disponibilizado_em).toLocaleDateString("pt-BR")}</div>
              </div>
              {r.pdf_path && <Button size="sm" onClick={() => abrir(r.pdf_path)}><Download className="h-4 w-4 mr-1" />Abrir PDF</Button>}
            </div>
          ))}
      </div>
    </div>
  );
}
