import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { StatementRow } from "@/components/statement-table";
import { periodoLabel } from "@/lib/format";

function fmt(v: number | undefined | null): string {
  if (v == null || isNaN(Number(v))) return "";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function exportStatementXLSX(
  rows: StatementRow[],
  periods: string[],
  filename: string,
  title: string,
) {
  const header = ["Descrição", ...periods.map(periodoLabel)];
  const body = rows.map((r) => [
    `${"  ".repeat(r.nivel)}${r.descricao}`,
    ...periods.map((p) => r.values[p] ?? 0),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([[title], [], header, ...body]);
  ws["!cols"] = [{ wch: 50 }, ...periods.map(() => ({ wch: 18 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Demonstração");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function exportStatementPDF(
  rows: StatementRow[],
  periods: string[],
  filename: string,
  title: string,
  subtitle?: string,
  brand?: { primaryColor?: string; logoUrl?: string | null; tenantName?: string },
) {
  const doc = new jsPDF({ orientation: periods.length > 3 ? "landscape" : "portrait", unit: "pt" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const primary = brand?.primaryColor ?? "#6366F1";

  // Header band
  doc.setFillColor(primary);
  doc.rect(0, 0, pageWidth, 50, "F");
  doc.setTextColor("#FFFFFF");
  doc.setFontSize(16);
  doc.text(brand?.tenantName ?? "Orkestria BI", 40, 32);
  doc.setFontSize(10);
  doc.text(new Date().toLocaleDateString("pt-BR"), pageWidth - 40, 32, { align: "right" });

  doc.setTextColor("#111827");
  doc.setFontSize(14);
  doc.text(title, 40, 80);
  if (subtitle) {
    doc.setFontSize(10);
    doc.setTextColor("#6B7280");
    doc.text(subtitle, 40, 96);
  }

  autoTable(doc, {
    startY: 110,
    head: [["Descrição", ...periods.map(periodoLabel)]],
    body: rows.map((r) => [
      `${"  ".repeat(r.nivel)}${r.descricao}`,
      ...periods.map((p) => fmt(r.values[p])),
    ]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: primary, textColor: "#FFFFFF", fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: "auto" },
      ...Object.fromEntries(periods.map((_, i) => [i + 1, { halign: "right", cellWidth: 70 }])),
    },
    didParseCell: (data) => {
      const row = rows[data.row.index];
      if (row?.is_subtotal && data.section === "body") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = "#F3F4F6";
      }
    },
  });

  doc.save(`${filename}.pdf`);
}
