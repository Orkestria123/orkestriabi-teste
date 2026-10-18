import * as XLSX from 'xlsx';
import { baixarArquivo } from '@/lib/importacao/encoding';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { StatementRow } from '@/components/statement-table';
import { montarColunas } from '@/lib/dre-acumulo';
import { buildStatementView, type StatementView, type ViewCell } from '@/lib/statement-view';

function fallback(rows: StatementRow[], periods: string[]): StatementView {
  return buildStatementView({ rows, columns: montarColunas(periods, 'mes'), variant: 'dre',
    bases: () => [], showAV: false, showAH: false, ahType: 'anterior', periods,
    visible: () => true, standard: r => r.nivel <= 1, thousands: false });
}
function formatted(cell: ViewCell, thousands: boolean) {
  if (cell.value == null || !Number.isFinite(cell.value)) return '—';
  const value = cell.format === 'money' && thousands ? cell.value / 1000 : cell.value;
  const number = Math.abs(value).toLocaleString('pt-BR', { minimumFractionDigits: cell.format === 'percent' || thousands ? 1 : 2, maximumFractionDigits: cell.format === 'percent' || thousands ? 1 : 2 });
  const text = cell.format === 'percent' ? `${number}%` : number;
  return value < 0 ? `(${text})` : text;
}
export function exportStatementXLSX(rows: StatementRow[], periods: string[], filename: string, title: string, view?: StatementView) {
  const model = view ?? fallback(rows, periods);
  const ws = XLSX.utils.aoa_to_sheet([[title], [model.thousands ? 'Valores em R$ mil' : 'Valores em R$'], ['Descrição', ...model.headers],
    ...model.rows.map(r => [r.source.descricao, ...r.cells.map(c => c.value == null ? null : c.value / (c.format === 'percent' ? 100 : model.thousands ? 1000 : 1))])]);
  ws['!cols'] = [{ wch: 55 }, ...model.headers.map(() => ({ wch: 23 }))];
  ws['!rows'] = [{}, {}, {}, ...model.rows.map(r => ({ level: Math.min(7, r.source.nivel), hidden: !r.visible }))];
  ws['!outline'] = { above: true, left: true };
  model.rows.forEach((r, i) => r.cells.forEach((c, j) => {
    const cell = ws[XLSX.utils.encode_cell({ r: i + 3, c: j + 1 })];
    if (cell) cell.z = c.format === 'percent' ? '0.0%;[Red](0.0%);"—"' : c.difference ? '[Red]#,##0.00;[Red](#,##0.00);"—"' : '#,##0.00;(#,##0.00);"—"';
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Demonstração');
  baixarArquivo(`${filename}.xlsx`, new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true })), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
export function exportStatementPDF(rows: StatementRow[], periods: string[], filename: string, title: string, subtitle?: string,
  brand?: { primaryColor?: string; logoUrl?: string | null; tenantName?: string }, view?: StatementView) {
  const model = view ?? fallback(rows, periods);
  const width = Math.max(595.28, 260 + model.headers.length * 88);
  const height = width > 842 ? 595.28 : 841.89;
  const doc = new jsPDF({ orientation: width > height ? 'landscape' : 'portrait', unit: 'pt', format: [width, height] });
  const pageWidth = doc.internal.pageSize.getWidth();
  const primary = brand?.primaryColor ?? '#3A3B4D';
  const modes = [
    { label: 'Consulta atual', accept: (r: StatementView['rows'][number]) => r.visible },
    { label: 'Padrão', accept: (r: StatementView['rows'][number]) => r.standard },
    { label: 'Expandir tudo', accept: () => true },
    { label: 'Recolher', accept: (r: StatementView['rows'][number]) => r.source.nivel <= Math.min(...model.rows.map(x => x.source.nivel)) },
  ];
  const starts: number[] = [];
  const pages: { page: number; mode: number }[] = [];
  modes.forEach((mode, modeIndex) => {
    if (modeIndex > 0) doc.addPage();
    starts.push(doc.getNumberOfPages());
    const selected = model.rows.filter(mode.accept);
    const numericWidth = (pageWidth - 280) / Math.max(1, model.headers.length);
    autoTable(doc, {
      startY: 112, margin: { top: 112, bottom: 32, left: 30, right: 30 }, tableWidth: pageWidth - 60,
      head: [['Descrição', ...model.headers]],
      body: selected.map(r => [r.source.descricao, ...r.cells.map(c => formatted(c, model.thousands))]),
      styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: primary, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 220 }, ...Object.fromEntries(model.headers.map((_, i) => [i + 1, { cellWidth: numericWidth, halign: 'right' }])) },
      didParseCell: data => {
        if (data.section !== 'body') return;
        const row = selected[data.row.index];
        if (!row) return;
        if (row.source.is_subtotal) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = '#F3F4F6'; }
        if (data.column.index === 0) data.cell.styles.cellPadding = { top: 4, bottom: 4, left: 4 + row.source.nivel * 8, right: 4 };
        const cell = row.cells[data.column.index - 1];
        if (cell?.difference && cell.value != null && Math.abs(cell.value) > 0.005) data.cell.styles.textColor = '#DC2626';
      },
      didDrawPage: () => { pages.push({ page: doc.getNumberOfPages(), mode: modeIndex }); },
    });
  });
  pages.forEach(({ page, mode }) => {
    doc.setPage(page);
    doc.setFillColor(primary); doc.rect(0, 0, pageWidth, 42, 'F');
    doc.setTextColor('#FFFFFF'); doc.setFontSize(13); doc.text(brand?.tenantName ?? 'Orkestria BI', 30, 27);
    doc.setTextColor('#111827'); doc.setFontSize(12); doc.text(title, 30, 62);
    doc.setFontSize(9); doc.text(`${subtitle ?? ''} · ${model.thousands ? 'R$ mil' : 'R$'} · ${modes[mode].label}`, 30, 78);
    modes.forEach((item, i) => {
      doc.setTextColor(primary); doc.text(item.label, 30 + i * 115, 97);
      doc.link(30 + i * 115, 85, 110, 15, { pageNumber: starts[i] });
    });
    doc.setTextColor('#6B7280'); doc.text(`${page} / ${doc.getNumberOfPages()}`, pageWidth - 30, height - 15, { align: 'right' });
  });
  doc.save(`${filename}.pdf`);
}
