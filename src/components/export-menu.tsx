import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { StatementRow } from "@/components/statement-table";
import { exportStatementPDF, exportStatementXLSX } from "@/lib/exports";
import type { StatementView } from "@/lib/statement-view";
import { useVisaoGerencial } from "@/hooks/use-visao-gerencial";
import { useAuth } from "@/hooks/use-auth";

interface Props {
  rows: StatementRow[];
  periods: string[];
  filename: string;
  title: string;
  subtitle?: string;
  view?: StatementView;
}

export function ExportMenu({ rows, periods, filename, title, subtitle, view }: Props) {
  const { tenant } = useAuth();
  const { visao } = useVisaoGerencial();
  const exportTitle = `${title} — ${visao === "comparativo" ? "Comparativo Contábil / Gerencial" : visao === "gerencial" ? "Gerencial" : "Contábil"}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Download className="h-4 w-4 mr-1.5" /> Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => exportStatementXLSX(rows, periods, `${filename}-${visao}`, exportTitle, view)}>
          <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            exportStatementPDF(rows, periods, `${filename}-${visao}`, exportTitle, subtitle, {
              primaryColor: tenant?.primary_color,
              logoUrl: tenant?.logo_url,
              tenantName: tenant?.name,
            }, view)
          }
        >
          <FileText className="h-4 w-4 mr-2" /> PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
