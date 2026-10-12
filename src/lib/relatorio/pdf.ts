// Gera o PDF do Relatório Executivo (A4 paisagem) no navegador.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { SECOES, mesExtenso, mesCurto, type ConteudoRelatorio, type LinhaDemo, type SecaoId } from "./tipos";

const C = {
  indigo: [62, 64, 149] as const, indigoD: [43, 44, 104] as const, azul: [0, 152, 219] as const,
  ciano: [91, 198, 208] as const, lima: [169, 207, 70] as const, paper: [243, 244, 249] as const,
  sunk: [238, 240, 247] as const, ink: [26, 28, 49] as const, ink2: [77, 81, 105] as const, line: [226, 228, 239] as const,
};
const W = 841.89, H = 595.28, M = 40;

async function paraDataUrl(url?: string | null): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  try {
    const b = await (await fetch(url)).blob();
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.onerror = () => r(null); fr.readAsDataURL(b); });
  } catch { return null; }
}

function fmtV(v: number | undefined) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${a})` : a;
}
function fmtI(v: number | null, formato: string) {
  if (v == null || !isFinite(v)) return "N/D";
  if (formato === "percent") return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
  if (formato === "money_mil") return fmtV(v / 1000);
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export async function gerarPdfRelatorio(c: ConteudoRelatorio): Promise<Blob> {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const [logoEsc, logoEmp, fotoEmp] = await Promise.all([paraDataUrl(c.imagens.logoEscritorio), paraDataUrl(c.imagens.logoEmpresa), paraDataUrl(c.imagens.fotoEmpresa)]);
  const d = c.dados;
  const visiveis = c.secoes.filter((s) => s.visivel).map((s) => s.id);
  const paginas: { id: SecaoId; titulo: string; pagina: number }[] = [];
  let primeira = true;

  const img = (data: string | null, x: number, y: number, w: number, h: number) => {
    if (!data) return;
    try {
      const p = doc.getImageProperties(data);
      const r = Math.min(w / p.width, h / p.height);
      doc.addImage(data, x + (w - p.width * r) / 2, y + (h - p.height * r) / 2, p.width * r, p.height * r);
    } catch { /* imagem inválida */ }
  };
  const faixa = () => {
    const cores = [C.indigo, C.azul, C.ciano, C.lima] as const;
    cores.forEach((cor, i) => { doc.setFillColor(cor[0], cor[1], cor[2]); doc.rect((W / 4) * i, 0, W / 4, 5, "F"); });
  };
  const novaPagina = (id: SecaoId | null, titulo: string) => {
    if (!primeira) doc.addPage(); primeira = false;
    doc.setFillColor(...C.paper); doc.rect(0, 0, W, H, "F");
    faixa();
    if (id) paginas.push({ id, titulo, pagina: doc.getNumberOfPages() });
    doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(...C.indigoD);
    doc.text(titulo, M, 50);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...C.ink2);
    doc.text(`${c.empresa.nome} · ${mesExtenso(d.periodo)} · ${c.escritorio.nome}`, M, H - 20);
    doc.text(String(doc.getNumberOfPages()), W - M, H - 20, { align: "right" });
    if (paginas.length && id) doc.textWithLink("‹ Sumário", W - M, 50, { align: "right", pageNumber: 2 } as any);
    return 75;
  };
  const texto = (t: string | undefined, y: number, largura = W - 2 * M, x = M): number => {
    if (!t?.trim()) return y;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(...C.ink);
    for (const par of t.split(/\n+/)) {
      const linhas = doc.splitTextToSize(par.trim(), largura) as string[];
      if (y + linhas.length * 14 > H - 40) { y = novaPagina(null, "(continuação)"); }
      doc.text(linhas, x, y, { align: "justify", maxWidth: largura });
      y += linhas.length * 14 + 8;
    }
    return y;
  };
  const tabela = (ls: LinhaDemo[], periodos: string[], y: number, comAV = false) => {
    const rl = ls.find((l) => /receita l[ií]quida/i.test(l.descricao))?.valores[d.periodo] || ls[0]?.valores[d.periodo] || 0;
    const head = ["Descrição", ...periodos.map(mesCurto), ...(periodos.length > 1 ? ["AH %"] : []), ...(comAV ? ["AV %"] : [])];
    const body = ls.map((l) => {
      const at = l.valores[d.periodo] ?? 0, an = d.anterior ? l.valores[d.anterior] ?? 0 : 0;
      return ["  ".repeat(Math.max(0, l.nivel - 1)) + l.descricao, ...periodos.map((p) => fmtV(l.valores[p])),
        ...(periodos.length > 1 ? [an ? `${(((at - an) / Math.abs(an)) * 100).toFixed(1).replace(".", ",")}` : "—"] : []),
        ...(comAV ? [rl ? `${((at / rl) * 100).toFixed(1).replace(".", ",")}` : "—"] : [])];
    });
    autoTable(doc, {
      startY: y, head: [head], body, margin: { left: M, right: M, top: 70, bottom: 40 },
      styles: { fontSize: 8, cellPadding: 3, textColor: C.ink as any, lineColor: C.line as any, lineWidth: 0.4 },
      headStyles: { fillColor: C.indigo as any, textColor: 255 },
      alternateRowStyles: { fillColor: C.sunk as any },
      columnStyles: Object.fromEntries(head.map((_, i) => [i, i === 0 ? { cellWidth: 300 } : { halign: "right" }])),
      didParseCell: (h) => { if (h.section === "body" && ls[h.row.index]?.subtotal) h.cell.styles.fontStyle = "bold"; },
      willDrawPage: () => { doc.setFillColor(...C.paper); },
    });
    return ((doc as any).lastAutoTable?.finalY ?? y) + 16;
  };
  const periodos = d.anterior ? [d.anterior, d.periodo] : [d.periodo];
  const T = c.textos;

  for (const id of visiveis) {
    const tit = SECOES.find((s) => s.id === id)!.titulo;
    if (id === "capa") {
      if (!primeira) doc.addPage(); primeira = false;
      doc.setFillColor(...C.indigoD); doc.rect(0, 0, W, H, "F");
      faixa();
      doc.setFillColor(255, 255, 255); doc.roundedRect(M, 60, 200, 80, 8, 8, "F");
      img(logoEsc, M + 10, 70, 180, 60);
      doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(34);
      doc.text("Relatório Executivo", M, 270);
      doc.setFontSize(20); doc.text(c.empresa.nome, M, 310);
      doc.setFont("helvetica", "normal"); doc.setFontSize(14);
      doc.text(`Resultados de ${mesExtenso(d.periodo)}`, M, 340);
      doc.setFontSize(11); doc.text(`Apresentado por ${c.escritorio.nome}`, M, H - 60);
      if (logoEmp) { doc.setFillColor(255, 255, 255); doc.roundedRect(W - M - 200, H - 160, 200, 100, 8, 8, "F"); img(logoEmp, W - M - 190, H - 150, 180, 80); }
      continue;
    }
    if (id === "sumario") { novaPagina(null, "Sumário"); continue; }
    let y = novaPagina(id, tit);
    if (id === "escritorio") { img(logoEsc, M, y, 180, 70); y = texto(T.escritorio, y + 90); }
    else if (id === "empresa") {
      const info = [c.empresa.razao, c.empresa.cnpj && `CNPJ ${c.empresa.cnpj}`, c.empresa.cidade, c.empresa.regime].filter(Boolean).join(" · ");
      doc.setFontSize(10); doc.setTextColor(...C.ink2); doc.text(info, M, y); y += 18;
      const temFoto = !!fotoEmp;
      img(logoEmp, M, y, 160, 60);
      if (temFoto) img(fotoEmp, W - M - 300, y, 300, 220);
      texto(T.empresa, y + 80, temFoto ? W - 2 * M - 320 : W - 2 * M);
    } else if (id === "resumo") {
      const kp = ["resultado", "margLiq", "lc", "margEbitda"].map((k) => d.indices.find((i) => i.key === k)).filter(Boolean) as typeof d.indices;
      const bw = (W - 2 * M - 30) / 4;
      kp.forEach((k, i) => {
        const x = M + i * (bw + 10);
        doc.setFillColor(255, 255, 255); doc.roundedRect(x, y, bw, 70, 6, 6, "F");
        doc.setFontSize(8); doc.setTextColor(...C.ink2); doc.text(k.label, x + 10, y + 18);
        doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...C.indigo); doc.text(fmtI(k.atual, k.formato), x + 10, y + 45);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...C.ink2); doc.text(`Mês anterior: ${fmtI(k.anterior, k.formato)}`, x + 10, y + 60);
      });
      texto(T.resumo, y + 95);
    } else if (id === "dre") { y = tabela(d.dre, periodos, y, true); texto(T.dre, y); }
    else if (id === "bp") { y = tabela(d.bpAtivo, periodos, y); y = tabela(d.bpPassivo, periodos, y); texto(T.bp, y); }
    else if (id === "dfc") { y = d.dfc.length ? tabela(d.dfc, [d.periodo], y) : texto("Demonstração dos fluxos de caixa não disponível para o período.", y); texto(T.dfc, y); }
    else if (id === "indicadores") {
      autoTable(doc, {
        startY: y, margin: { left: M, right: M, top: 70, bottom: 40 },
        head: [["Indicador", "Fórmula", mesCurto(d.periodo), d.anterior ? mesCurto(d.anterior) : "Anterior"]],
        body: d.indices.map((i) => [i.label, i.formula, fmtI(i.atual, i.formato), fmtI(i.anterior, i.formato)]),
        styles: { fontSize: 8.5, cellPadding: 4, textColor: C.ink as any }, headStyles: { fillColor: C.indigo as any },
        alternateRowStyles: { fillColor: C.sunk as any }, columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } },
      });
      texto(T.indicadores, ((doc as any).lastAutoTable?.finalY ?? y) + 16);
    } else if (id === "faturamento") {
      const max = Math.max(1, ...d.faturamento.map((f) => Math.abs(f.valor)));
      const gw = W - 2 * M, gh = 200, bw = gw / Math.max(12, d.faturamento.length);
      d.faturamento.forEach((f, i) => {
        const h = (Math.abs(f.valor) / max) * (gh - 30);
        { const cor = i === d.faturamento.length - 1 ? C.azul : C.indigo; doc.setFillColor(cor[0], cor[1], cor[2]); }
        doc.rect(M + i * bw + 6, y + gh - h, bw - 12, h, "F");
        doc.setFontSize(7); doc.setTextColor(...C.ink2);
        doc.text(mesCurto(f.periodo), M + i * bw + bw / 2, y + gh + 12, { align: "center" });
        doc.text(fmtV(f.valor / 1000), M + i * bw + bw / 2, y + gh - h - 4, { align: "center" });
      });
      doc.text("Valores em R$ mil", M, y + gh + 26);
      texto(T.faturamento, y + gh + 45);
    } else { texto(T[id], y); }
  }

  // Sumário clicável na página 2
  if (visiveis.includes("sumario")) {
    const pagSum = visiveis[0] === "capa" ? 2 : 1;
    doc.setPage(pagSum);
    let y = 90;
    doc.setFontSize(12);
    for (const p of paginas) {
      doc.setTextColor(...C.indigo);
      doc.textWithLink(p.titulo, M, y, { pageNumber: p.pagina } as any);
      doc.setTextColor(...C.ink2); doc.text(String(p.pagina), W - M, y, { align: "right" });
      doc.setDrawColor(...C.line); doc.line(M, y + 6, W - M, y + 6);
      y += 24;
    }
  }
  return doc.output("blob");
}
