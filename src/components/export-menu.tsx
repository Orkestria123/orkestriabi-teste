import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { StatementRow } from "@/components/statement-table";
import { exportStatementPDF, exportStatementXLSX } from "@/lib/exports";
import { useAuth } from "@/hooks/use-auth";

interface Props {
  rows: StatementRow[];
  periods: string[];
  filename: string;
  title: string;
  subtitle?: string;
  /** rótulos customizados por coluna (ex.: DFC agrupada por trimestre) */
  periodLabels?: string[];
}

export function ExportMenu({ rows, periods, filename, title, subtitle, periodLabels }: Props) {
  const { tenant } = useAuth();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Download className="h-4 w-4 mr-1.5" /> Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => exportStatementXLSX(rows, periods, filename, title, periodLabels)}>
          <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            exportStatementPDF(rows, periods, filename, title, subtitle, {
              primaryColor: tenant?.primary_color,
              logoUrl: tenant?.logo_url,
              tenantName: tenant?.name,
            }, periodLabels)
          }
        >
          <FileText className="h-4 w-4 mr-2" /> PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
