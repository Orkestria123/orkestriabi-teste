import { createFileRoute } from "@tanstack/react-router";
import { useBiQuery as useQuery } from "@/lib/demo/query";
import { Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useDashboardCompany } from "@/components/dashboard-context";
import { Button } from "@/components/ui/button";
import { mesExtenso } from "@/lib/relatorio/tipos";
import { useIsDemo } from "@/lib/demo/context";
import { demoPeriods, demoReport } from "@/lib/demo/data";
import { useState } from "react";

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

export function Page() {
  const demo = useIsDemo();
  const [generating, setGenerating] = useState(false);
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
  const reports = demo ? demoPeriods.slice(-3).reverse().map((p) => ({id:p,competencia:p,pdf_path:p,disponibilizado_em:"2026-10-18"})) : data;
  const abrir = async (path: string) => {
    if (demo) {
      setGenerating(true);
      try {
        const { gerarPdfRelatorio } = await import("@/lib/relatorio/pdf");
        const blob = await gerarPdfRelatorio(demoReport(path));
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `Relatorio-Executivo-Modelo-Ltda-${path.slice(0,7)}.pdf`; a.click();
        setTimeout(() => URL.revokeObjectURL(url),30000);
      } catch { toast.error("Não foi possível gerar o relatório."); }
      finally { setGenerating(false); }
      return;
    }
    const { data, error } = await supabase.storage.from("relatorios").createSignedUrl(path, 600);
    if (error || !data) return toast.error("Não foi possível abrir o relatório.");
    window.open(data.signedUrl, "_blank");
  };
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Relatórios Executivos</h2>
      <div className="rounded-lg border bg-card divide-y">
        {isLoading ? <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
          : !reports?.length ? <div className="p-6 text-center text-sm text-muted-foreground">Nenhum relatório disponibilizado ainda.</div>
          : reports.map((r: any) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <FileText className="h-5 w-5 text-primary" />
              <div className="flex-1">
                <div className="font-medium">Relatório Executivo — {mesExtenso(r.competencia)}</div>
                <div className="text-xs text-muted-foreground">Disponibilizado em {new Date(r.disponibilizado_em).toLocaleDateString("pt-BR")}</div>
              </div>
              {r.pdf_path && <Button size="sm" disabled={generating} onClick={() => abrir(r.pdf_path)}><Download className="h-4 w-4 mr-1" />{generating ? "Gerando…" : "Abrir PDF"}</Button>}
            </div>
          ))}
      </div>
    </div>
  );
}
