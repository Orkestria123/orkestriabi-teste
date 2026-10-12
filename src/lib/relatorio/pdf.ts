// Gera o PDF do Relatório Executivo (A4 paisagem) no navegador.
// Visual aprovado: modelo "v4" (Casa do Vidro ago/2026) — fundo claro azulado,
// faixa Open no topo, rótulo técnico + título índigo, logo do escritório no canto,
// rodapé com link para o Sumário, tabelas leves e notas em cartões.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { SECOES, mesExtenso, mesCurto, MESES, normalizarSecoes, type ConteudoRelatorio, type LinhaDemo, type SecaoId } from "./tipos";

import headingFont from "@/assets/report-fonts/Poppins-SemiBold.ttf?url";
import bodyFont from "@/assets/report-fonts/PublicSans-Regular.ttf?url";
import monoFont from "@/assets/report-fonts/IBMPlexMono-Regular.ttf?url";

async function carregarFontes(doc: jsPDF) {
  await Promise.all([[headingFont, "Poppins"], [bodyFont, "PublicSans"], [monoFont, "PlexMono"]].map(async ([url, name]) => {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    let binary = ""; for (const b of bytes) binary += String.fromCharCode(b);
    doc.addFileToVFS(`${name}.ttf`, btoa(binary));
    doc.addFont(`${name}.ttf`, name, "normal");
    doc.addFont(`${name}.ttf`, name, "bold");
  }));
}
type RGB = readonly [number, number, number];
const C = {
  indigo: [62, 64, 149] as RGB, indigoD: [43, 44, 104] as RGB, azul: [0, 152, 219] as RGB,
  ciano: [91, 198, 208] as RGB, lima: [169, 207, 70] as RGB, paper: [243, 244, 249] as RGB,
  sunk: [234, 237, 247] as RGB, card: [250, 251, 254] as RGB, ink: [26, 28, 49] as RGB,
  ink2: [96, 100, 124] as RGB, line: [220, 223, 236] as RGB, branco: [255, 255, 255] as RGB,
};
const W = 841.89, H = 595.28, M = 40, TOPO = 112, BASE = H - 46;

const KICKER: Partial<Record<SecaoId, string>> = {
  sumario: "NAVEGAÇÃO DO RELATÓRIO", escritorio: "ESCRITÓRIO RESPONSÁVEL", empresa: "PERFIL CADASTRADO",
  resumo: "VISÃO EXECUTIVA", dre: "MÊS ANTERIOR, MÊS ATUAL E ACUMULADO · VALORES EM R$",
  bp: "POSIÇÃO PATRIMONIAL · VALORES EM R$", dfc: "MÉTODO INDIRETO · VALORES EM R$",
  indicadores: "INDICADORES · FÓRMULAS AO LADO", faturamento: "JANELA DE 12 MESES · VALORES EM R$",
  notas: "NOTAS EXPLICATIVAS ÀS DEMONSTRAÇÕES", conclusoes: "AGENDA DE ACOMPANHAMENTO PARA A ADMINISTRAÇÃO",
  glossario: "UMA PÁGINA · SIGLAS E CONTEÚDO DAS DEMONSTRAÇÕES",
};
const TITULO: Partial<Record<SecaoId, string>> = {
  escritorio: "Quem apresenta", empresa: "A empresa", resumo: "Resumo do mês", bp: "Balanço Patrimonial",
  dre: "Demonstração do Resultado", dfc: "Demonstração dos Fluxos de Caixa", indicadores: "Indicadores e fórmulas",
  faturamento: "Faturamento dos últimos 12 meses", notas: "Notas explicativas", conclusoes: "Conclusões e recomendações",
  glossario: "Glossário",
};

async function paraDataUrl(url?: string | null): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  try {
    const b = await (await fetch(url)).blob();
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.onerror = () => r(null); fr.readAsDataURL(b); });
  } catch { return null; }
}

function fmtV(v: number | undefined | null) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${a})` : a;
}
const fmtR = (v: number | undefined | null) => (v == null || !isFinite(v) ? "N/D" : v < 0 ? `(R$ ${fmtV(-v)})` : `R$ ${fmtV(v)}`);
const pct = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
function fmtI(v: number | null, formato: string) {
  if (v == null || !isFinite(v)) return "N/D";
  if (formato === "percent") return pct(v);
  if (formato === "money_mil" || formato === "money") return fmtV(formato === "money_mil" ? v / 1000 : v);
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}
const mesTitulo = (p: string) => { const m = MESES[Number(p.slice(5, 7)) - 1]; return `${m[0].toUpperCase()}${m.slice(1)}/${p.slice(0, 4)}`; };

export async function gerarPdfRelatorio(c: ConteudoRelatorio): Promise<Blob> {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  await carregarFontes(doc);
  const [logoEsc, logoEmp, fotoEmp] = await Promise.all([paraDataUrl(c.imagens.logoEscritorio), paraDataUrl(c.imagens.logoEmpresa), paraDataUrl(c.imagens.fotoEmpresa)]);
  const d = c.dados;
  const T = c.textos;
  const visiveis = normalizarSecoes(c.secoes).filter((s) => s.visivel).map((s) => s.id);
  const paginas: { id: SecaoId; titulo: string; pagina: number }[] = [];
  let pagSumario = 0;
  let primeira = true;
  let secaoAtual: { id: SecaoId; titulo: string } | null = null;

  const fill = (c0: RGB) => doc.setFillColor(c0[0], c0[1], c0[2]);
  const cor = (c0: RGB) => doc.setTextColor(c0[0], c0[1], c0[2]);
  const traco = (c0: RGB) => doc.setDrawColor(c0[0], c0[1], c0[2]);
  const fonte = (estilo: "normal" | "bold", tam: number, c0: RGB = C.ink, fam = "helvetica") => { doc.setFont(fam === "courier" ? "PlexMono" : estilo === "bold" ? "Poppins" : "PublicSans", "normal"); doc.setFontSize(tam); cor(c0); };

  const img = (data: string | null, x: number, y: number, w: number, h: number, cobrir = false) => {
    if (!data) return false;
    try {
      const p = doc.getImageProperties(data);
      const r = cobrir ? Math.max(w / p.width, h / p.height) : Math.min(w / p.width, h / p.height);
      const iw = p.width * r, ih = p.height * r;
      doc.addImage(data, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
      return true;
    } catch { return false; }
  };
  const faixa = (y: number, h = 3) => {
    const cs = [C.indigo, C.azul, C.ciano, C.lima];
    const n = 60;
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * (cs.length - 1), k = Math.min(cs.length - 2, Math.floor(t)), f = t - k;
      const a = cs[k], b = cs[k + 1];
      doc.setFillColor(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
      doc.rect((W / n) * i, y, W / n + 0.5, h, "F");
    }
  };

  const cabecalho = (id: SecaoId | null, titulo: string, kicker: string, nova = true) => {
    if (nova) { if (!primeira) doc.addPage(); primeira = false; }
    fill(C.paper); doc.rect(0, 0, W, H, "F");
    faixa(0, 3);
    fonte("normal", 7.5, C.azul, "courier"); doc.text(kicker.toUpperCase(), M, 46, { charSpace: 0.6 });
    fonte("bold", 21, C.indigo); doc.text(doc.splitTextToSize(titulo, W - 2 * M - 100), M, 72);
    if (logoEsc) img(logoEsc, W - M - 70, 24, 70, 52);
    if (id && id !== "sumario") { fonte("normal", 7.5, C.ink2); doc.text(`${c.empresa.nome}  |  ${mesTitulo(d.periodo)}`, W - M - 82, 46, { align: "right" }); }
    traco(C.line); doc.setLineWidth(0.6); doc.line(M, BASE + 8, W - M, BASE + 8);
    fonte("normal", 7, C.ink2); doc.text(`${c.escritorio.nome} · Material privado e confidencial`, M, BASE + 22);
    fonte("normal", 7.5, C.ink2); doc.text(String(doc.getNumberOfPages()), W - M, BASE + 22, { align: "right" });
    if (visiveis.includes("sumario") && pagSumario && id !== "sumario") {
      fonte("normal", 7.5, C.azul); doc.textWithLink("Sumário", W - M - 70, BASE + 22, { pageNumber: pagSumario } as any);
    }
    if (id === "sumario") pagSumario = doc.getNumberOfPages();
    return TOPO;
  };
  const novaPagina = (id: SecaoId, titulo?: string) => {
    const tit = titulo ?? TITULO[id] ?? (SECOES.find((s) => s.id === id)?.titulo ?? id);
    secaoAtual = { id, titulo: tit };
    const y = cabecalho(id, tit, KICKER[id] ?? "");
    paginas.push({ id, titulo: titulo ?? (SECOES.find((s) => s.id === id)?.titulo ?? id), pagina: doc.getNumberOfPages() });
    return y;
  };
  const continuacao = (nova = true) => cabecalho(secaoAtual?.id ?? null, `${secaoAtual?.titulo ?? ""} (continuação)`, secaoAtual ? KICKER[secaoAtual.id] ?? "" : "", nova);

  const texto = (t: string | undefined, y: number, largura = W - 2 * M, x = M, tam = 10): number => {
    if (!t?.trim()) return y;
    const lh = tam * 1.45;
    for (const par of t.split(/\n+/)) {
      if (!par.trim()) continue;
      fonte("normal", tam, C.ink);
      const linhas = doc.splitTextToSize(par.trim(), largura) as string[];
      let resto = linhas;
      while (resto.length) {
        const cabem = Math.max(1, Math.floor((BASE - y) / lh));
        if (cabem < 2 && resto.length > 1) { y = continuacao(); continue; }
        const parte = resto.slice(0, cabem); resto = resto.slice(cabem);
        fonte("normal", tam, C.ink);
        doc.text(parte, x, y, { align: "justify", maxWidth: largura, lineHeightFactor: 1.45 });
        y += parte.length * lh;
        if (resto.length) y = continuacao();
      }
      y += 8;
    }
    return y;
  };

  const tabelaBase = (head: string[], body: (string | number)[][], y: number, opts: { negrito?: (i: number) => boolean; larg0?: number; esquerda?: number[]; compacto?: boolean } = {}) => {
    autoTable(doc, {
      startY: y, head: [head], body: body as any, margin: { left: M, right: M, top: TOPO, bottom: H - BASE + 6 },
      theme: "plain",
      styles: { font: "PublicSans", fontSize: 7.8, cellPadding: { top: opts.compacto ? 2.5 : 3.2, bottom: opts.compacto ? 2.5 : 3.2, left: 6, right: 6 }, textColor: C.ink as any, lineColor: C.line as any, lineWidth: { bottom: 0.4 } as any, fillColor: C.paper as any },
      headStyles: { fillColor: C.sunk as any, textColor: C.ink2 as any, fontStyle: "normal" },
      columnStyles: Object.fromEntries(head.map((_, i) => [i, i === 0 ? { cellWidth: opts.larg0 ?? 260, halign: "left" } : { halign: opts.esquerda?.includes(i) ? "left" : "right" }])),
      didParseCell: (h) => { if (h.section === "body" && opts.negrito?.(h.row.index)) { h.cell.styles.font = "Poppins"; h.cell.styles.fontStyle = "normal"; h.cell.styles.fillColor = C.sunk as any; } },
      willDrawPage: (h) => { if (h.pageNumber > 1) continuacao(false); },
    });
    return ((doc as any).lastAutoTable?.finalY ?? y) + 16;
  };

  const tabelaDemo = (ls: LinhaDemo[], periodos: string[], y: number, comAV = false) => {
    const rl = ls.find((l) => /receita l[ií]quida/i.test(l.descricao))?.valores[d.periodo] || 0;
    const head = ["Descrição", ...periodos.map(mesCurto), ...(periodos.length > 1 ? ["AH %"] : []), ...(comAV ? ["AV % RL"] : [])];
    const body = ls.map((l) => {
      const at = l.valores[d.periodo] ?? 0, an = d.anterior ? l.valores[d.anterior] ?? 0 : 0;
      return ["   ".repeat(Math.max(0, l.nivel - 1)) + l.descricao, ...periodos.map((p) => fmtV(l.valores[p])),
        ...(periodos.length > 1 ? [an ? pct(((at - an) / Math.abs(an)) * 100) : "—"] : []),
        ...(comAV ? [rl ? pct((at / rl) * 100) : "—"] : [])];
    });
    return tabelaBase(head, body, y, { negrito: (i) => !!ls[i]?.subtotal });
  };

  // Cartões de notas: cada parágrafo vira uma nota numerada; "Título: texto" vira cabeçalho.
  const notas = (t: string | undefined, y: number) => {
    const itens = (t ?? "").split(/\n+/).map((s) => s.trim()).filter(Boolean).map((p) => {
      const m = p.match(/^(?:\d+[.)-]?\s*)?([^:—]{3,60})\s*[:—]\s+(.+)$/);
      return m ? { t: m[1].trim(), x: m[2].trim() } : { t: "", x: p };
    });
    if (!itens.length) return y;
    const cw = (W - 2 * M - 16) / 2, pad = 14;
    let col = 0, yc = [y, y], n = 0;
    const alturaItem = (it: { t: string; x: string }) => { fonte("normal", 8.6); return (it.t ? 22 : 4) + (doc.splitTextToSize(it.x, cw - 2 * pad) as string[]).length * 12.4 + 14; };
    for (const it of itens) {
      n++;
      const h = alturaItem(it);
      col = yc[0] <= yc[1] ? 0 : 1;
      if (yc[col] + h > BASE) { col = col === 0 ? 1 : 0; if (yc[col] + h > BASE) { const y0 = continuacao(); yc = [y0, y0]; col = 0; } }
      const x = M + col * (cw + 16), yy = yc[col];
      fill(C.card); traco(C.line); doc.setLineWidth(0.5); doc.roundedRect(x, yy, cw, h, 6, 6, "FD");
      let ty = yy + pad + 6;
      if (it.t) { fonte("bold", 11, C.azul); doc.text(String(n).padStart(2, "0"), x + pad, ty); fonte("bold", 9, C.indigo); doc.text(it.t, x + pad + 22, ty); ty += 18; }
      fonte("normal", 8.6, C.ink);
      const ls = doc.splitTextToSize(it.x, cw - 2 * pad) as string[];
      doc.text(ls, x + pad, ty, { align: "justify", maxWidth: cw - 2 * pad, lineHeightFactor: 1.45 });
      yc[col] = yy + h + 12;
    }
    return Math.max(...yc);
  };

  const periodos = d.anterior ? [d.anterior, d.periodo] : [d.periodo];
  const ind = (k: string) => d.indices.find((i) => i.key === k);
  const linha = (ls: LinhaDemo[], re: RegExp) => ls.find((l) => re.test(l.descricao));
  const anoMes = mesExtenso(d.periodo);

  for (const id of visiveis) {
    if (id === "capa") {
      if (!primeira) doc.addPage(); primeira = false;
      fill(C.indigoD); doc.rect(0, 0, W, H, "F");
      fill(C.branco); doc.roundedRect(M, 40, 112, 92, 4, 4, "F");
      img(logoEsc, M + 8, 46, 96, 80);
      fonte("normal", 8, C.ciano, "courier"); doc.text("APRESENTAÇÃO MENSAL DE RESULTADOS", M, 232, { charSpace: 0.8 });
      fonte("bold", 30, C.branco); doc.text(doc.splitTextToSize(c.empresa.nome, W - 2 * M), M, 276);
      const sub = [c.empresa.razao, c.empresa.cnpj && `CNPJ ${c.empresa.cnpj}`].filter(Boolean).join(" · ");
      if (sub) { fonte("normal", 10, C.ciano); doc.text(sub, M, 300); }
      const mm = MESES[Number(d.periodo.slice(5, 7)) - 1];
      fonte("bold", 16, C.lima); doc.text(`${mm[0].toUpperCase()}${mm.slice(1)} · ${d.periodo.slice(0, 4)}`, M, 356);
      fonte("normal", 9, C.branco); doc.text("Preparado por ", M, H - 92);
      fonte("bold", 9, C.branco); doc.text(c.escritorio.nome, M + doc.getTextWidth("Preparado por ") + 1, H - 92);

      faixa(H - 10, 10);
      continue;
    }
    if (id === "sumario") { cabecalho("sumario", "Sumário", (KICKER.sumario ?? "")); continue; }

    let y = novaPagina(id);
    if (id === "escritorio") {
      const cw = 250;
      fill(C.card); traco(C.line); doc.setLineWidth(0.5); doc.roundedRect(M, y, cw, 360, 6, 6, "FD");
      img(logoEsc, M + 25, y + 30, cw - 50, 160);
      fonte("normal", 7, C.azul, "courier"); doc.text("ESCRITÓRIO RESPONSÁVEL", M + 22, y + 240, { charSpace: 0.6 });
      fonte("bold", 11, C.indigo); doc.text(doc.splitTextToSize(c.escritorio.nome, cw - 44), M + 22, y + 262);
      const xt = M + cw + 36, lt = W - M - xt;
      const yt = texto(T.escritorio, y + 10, lt, xt);
      const yb = Math.max(yt + 10, y + 200);
      fill(C.sunk); doc.roundedRect(xt, yb, lt, 74, 6, 6, "F");
      fonte("normal", 7, C.azul, "courier"); doc.text("PERÍODO E FONTE", xt + 16, yb + 20, { charSpace: 0.6 });
      fonte("normal", 9, C.ink);
      const ant = d.anterior ? ` comparado a ${mesExtenso(d.anterior)}` : "";
      doc.text(doc.splitTextToSize(`${mesTitulo(d.periodo)}${ant}. Acumulado: janeiro a ${anoMes}. Fonte: escrituração contábil processada no Orkestria BI.`, lt - 32), xt + 16, yb + 38, { lineHeightFactor: 1.45 });
    } else if (id === "empresa") {
      const temFoto = !!fotoEmp, lt = temFoto ? W - 2 * M - 300 : W - 2 * M;
      if (logoEmp) { fill(C.branco); doc.roundedRect(M + (lt - 220) / 2, y - 6, 220, 70, 4, 4, "F"); img(logoEmp, M + (lt - 220) / 2 + 10, y, 200, 58); y += 84; }
      y = texto(T.empresa, y + 4, lt);
      const info: [string, string][] = ([["CNPJ", c.empresa.cnpj], ["Razão social", c.empresa.razao], ["Regime tributário", c.empresa.regime], ["Localização", c.empresa.cidade]] as [string, string | null | undefined][])
        .filter(([, v]) => !!v) as [string, string][];
      if (info.length) {
        fill(C.sunk); doc.roundedRect(M, y, lt, info.length * 20 + 12, 6, 6, "F");
        info.forEach(([k, v], i) => { fonte("normal", 8.5, C.ink2); doc.text(k, M + 14, y + 22 + i * 20); fonte("bold", 8.5, C.indigo); doc.text(v, M + lt / 2.6, y + 22 + i * 20); });
      }
      if (temFoto) {
        const xf = W - M - 270;
        img(fotoEmp, xf, TOPO - 4, 270, 300);
        if (c.empresa.cidade) { fonte("bold", 9, C.indigo); doc.text(c.empresa.cidade, xf, TOPO + 316); }
        fonte("normal", 7.5, C.ink2); doc.text("Foto e informações provenientes do cadastro e perfil da empresa.", xf, TOPO + 330, { maxWidth: 270 });
      }
    } else if (id === "resumo") {
      const rl = linha(d.dre, /receita l[ií]quida/i), ll = linha(d.dre, /lucro.*exerc[ií]cio|lucro l[ií]quido|resultado l[ií]quido/i), eb = linha(d.dre, /ebitda/i);
      const cx = linha(d.bpAtivo, /caixa|dispon/i);
      const v = (l?: LinhaDemo, p?: string | null) => (l && p ? l.valores[p] : undefined);
      const vs = (l?: LinhaDemo) => { const a = v(l, d.periodo), b = v(l, d.anterior); return a != null && b ? `${pct(((a - b) / Math.abs(b)) * 100)} vs ${d.anterior ? MESES[Number(d.anterior.slice(5, 7)) - 1] : ""}` : ""; };
      const cards: [string, string, string][] = rl || ll ? [
        ["RECEITA LÍQUIDA", fmtR(v(rl, d.periodo)), vs(rl)],
        ["EBITDA", fmtR(v(eb, d.periodo)), eb && v(rl, d.periodo) ? `Margem ${pct(((v(eb, d.periodo) ?? 0) / (v(rl, d.periodo) || 1)) * 100)}` : ""],
        ["LUCRO LÍQUIDO", fmtR(v(ll, d.periodo)), vs(ll)],
        ["CAIXA E APLICAÇÕES", fmtR(v(cx, d.periodo)), cx && d.anterior ? `Variação ${fmtR((v(cx, d.periodo) ?? 0) - (v(cx, d.anterior) ?? 0))}` : ""],
      ] : (["resultado", "margLiq", "lc", "margEbitda"].map(ind).filter(Boolean) as typeof d.indices).map((k) => [k.label.toUpperCase(), fmtI(k.atual, k.formato), `Mês anterior: ${fmtI(k.anterior, k.formato)}`] as [string, string, string]);
      const bw = (W - 2 * M - 24) / 4;
      cards.forEach(([l, val, s], i) => {
        const x = M + i * (bw + 8);
        fill(C.sunk); doc.rect(x, y, bw, 82, "F");
        fonte("normal", 7, C.azul, "courier"); doc.text(l, x + 12, y + 20, { charSpace: 0.5 });
        fonte("bold", 16, C.indigo); doc.text(val, x + 12, y + 48);
        fonte("normal", 7.5, C.ink2); doc.text(s, x + 12, y + 68);
      });
      y += 100; traco(C.line); doc.line(M, y - 6, W - M, y - 6);
      texto(T.resumo, y + 14);
    } else if (id === "dre") {
      const ls = d.dre.filter((l) => l.subtotal || l.nivel === 0);
      const rl = linha(ls, /receita l[ií]quida/i)?.valores[d.periodo] ?? 0;
      const acc = (l: LinhaDemo) => d.acumulado?.dre.find((x) => x.descricao === l.descricao);
      const body = ls.map((l) => {
        const at = l.valores[d.periodo] ?? 0, ant = d.anterior ? l.valores[d.anterior] : null;
        return [l.descricao, d.anterior ? fmtV(ant) : "N/D", fmtV(at), rl ? pct(at / rl * 100) : "—", ant ? pct((at - ant) / Math.abs(ant) * 100) : "—", d.acumulado ? fmtV(Object.values(acc(l)?.valores ?? {}).reduce((a,b) => a+b,0)) : "N/D"];
      });
      y = tabelaBase(["Descrição", d.anterior ? mesCurto(d.anterior) : "Anterior", mesCurto(d.periodo), "AV% RL", "AH% mês", `Jan–${mesCurto(d.periodo)}`], body, y, { larg0: 270, compacto: true, negrito: (i) => !/materiais|dedu[çc]|despesas operacionais|provis[aã]o/i.test(ls[i]?.descricao ?? "") });
      y = texto("AV% = linha / receita líquida × 100. AH% = (atual − anterior) / |anterior| × 100. Custo de materiais integra o CPV e não é somado novamente. Acumulado considera somente meses disponíveis no ano.", y, W - 2*M, M, 8);
      texto(T.dre, y, W - 2*M, M, 9);
    } else if (id === "custos") {
      const ls = d.dre.filter((l) => l.nivel === 2 && /gastos|despesas|compras|estoque inicial|estoque final/i.test(l.descricao));
      const rl = linha(d.dre, /receita l[ií]quida/i)?.valores[d.periodo] ?? 0;
      y = tabelaBase(["Grupo / componente", ...periodos.map(mesCurto), "% receita líquida"], ls.map((l) => [l.descricao, ...periodos.map((p) => fmtV(l.valores[p])), rl ? pct((l.valores[d.periodo] ?? 0)/rl*100) : "—"]), y, {larg0:340});
      y = texto("A segregação segue os grupos configurados no BI. Componentes dos custos não devem ser somados novamente aos respectivos totais.", y, W-2*M, M, 8);
      texto(T.custos, y, W-2*M, M,9);
    } else if (id === "bp") {
      const compactar = (ls: LinhaDemo[]) => ls.filter((l) => l.nivel <= 3 && !(/^(ATIVO|PASSIVO)$/i.test(l.descricao)) && (l.subtotal || Object.values(l.valores).some((v) => Math.abs(v) > .005)));
      const ativo = compactar(d.bpAtivo), passivo = compactar(d.bpPassivo);
      y = tabelaBase(["Ativo", mesCurto(d.periodo), "Passivo + patrimônio líquido", mesCurto(d.periodo)], Array.from({length:Math.max(ativo.length, passivo.length)}, (_, i) => [ativo[i]?.descricao ?? "", ativo[i] ? fmtV(ativo[i].valores[d.periodo]) : "", passivo[i]?.descricao ?? "", passivo[i] ? fmtV(passivo[i].valores[d.periodo]) : ""]), y, { larg0:230, esquerda:[2], compacto:true, negrito:(i)=>!!ativo[i]?.subtotal || !!passivo[i]?.subtotal });
      texto(T.bp, y, W-2*M, M, 9);
    } else if (id === "dfc") {
      const ls = d.dfc.filter((l) => !/^Bloco|^Fechamento|Validação CPC/i.test(l.descricao));
      y = ls.length ? tabelaDemo(ls, periodos, y) : texto("Demonstração dos fluxos de caixa não disponível para o período.",y);
      texto(T.dfc, y, W-2*M, M,9);
    } else if (id === "caixa") {
      const get = (re: RegExp) => linha(d.dfc,re)?.valores[d.periodo] ?? 0;
      const caixa = linha(d.bpAtivo,/dispon[ií]vel|caixa/i);
      const inicial = d.anterior ? caixa?.valores[d.anterior] ?? 0 : null;
      const final = caixa?.valores[d.periodo] ?? 0;
      const values = [inicial ?? 0,get(/caixa das atividades operacionais/i), get(/caixa das atividades de investimento/i),get(/caixa das atividades de financiamento/i),final];
      const labels = ["Caixa inicial", "Operacional", "Investimento", "Financiamento", "Caixa final"];
      const colors = [C.ink2,C.azul,C.indigo,C.ciano,C.lima];
      const positions: [number,number][] = []; let running = values[0];
      values.forEach((v,i) => { const start = i===0 || i===4 ? 0 : running; const end = start + v; positions.push([start,end]); if(i>0 && i<4) running=end; });
      const max = Math.max(1,...positions.flat()), min = Math.min(0,...positions.flat()), gh=205, gx=M+40, gw=W-2*M-60;
      fill(C.sunk);doc.rect(M,y-4,W-2*M,gh+42,"F"); fill(C.branco);doc.rect(M+12,y+8,W-2*M-24,gh+18,"F");
      const yy=(v:number)=>y+gh-(v-min)/(max-min)* (gh-28);
      for(let i=0;i<=4;i++){ const v=min+(max-min)*i/4;traco(C.line);doc.line(gx,yy(v),gx+gw,yy(v));fonte("normal",7,C.ink2);doc.text(fmtV(v/1e6),gx-8,yy(v)+3,{align:"right"});}
      positions.forEach(([a,b],i)=>{const x=gx+i*gw/5+30,w=gw/5-60;fill(colors[i]);doc.rect(x,Math.min(yy(a),yy(b)),w,Math.max(1,Math.abs(yy(a)-yy(b))),"F");fonte("normal",9);doc.text(i===0&&inicial==null?"N/D":fmtV(values[i]/1e6),x+w/2,Math.min(yy(a),yy(b))-5,{align:"center"});fonte("normal",8);doc.text(labels[i],x+w/2,y+gh+16,{align:"center"});});
      y+=gh+62;
      y=texto(T.caixa || T.dfc,y,W-2*M,M,9);
      texto(`Conciliação: FCO ${fmtR(values[1])} + FCI ${fmtR(values[2])} + FCF ${fmtR(values[3])} = ${fmtR(values[1]+values[2]+values[3])}. Caixa final ${fmtR(final)}; inicial ${fmtR(inicial)}. Valores do gráfico em R$ milhões.`,y,W-2*M,M,8);
    } else if (id === "patrimonio") {
      const start=d.bpPassivo.findIndex((l)=>/patrim[oô]nio l[ií]quido/i.test(l.descricao));
      const ls=start<0 ? [] : d.bpPassivo.slice(start).filter((l)=>!/total do passivo/i.test(l.descricao) && l.nivel<=3);
      y=tabelaBase(["Componente",d.anterior?mesCurto(d.anterior):"Anterior",mesCurto(d.periodo),"Variação"],ls.map((l)=>[l.descricao,d.anterior?fmtV(l.valores[d.anterior]):"N/D",fmtV(l.valores[d.periodo]),d.anterior?fmtV((l.valores[d.periodo]??0)-(l.valores[d.anterior]??0)):"N/D"]),y,{negrito:i=>!!ls[i]?.subtotal});
      y=texto(T.patrimonio,y,W-2*M,M,9);
      texto("Conciliação patrimonial baseada nos saldos do Balanço. A DMPL formal depende da classificação e documentação dos movimentos por componente; não se atribuem naturezas a variações não documentadas.",y,W-2*M,M,9);
    } else if (id === "indicadores") {
      const groups = [
        {title:"Liquidez e estrutura de capital", keys:["lc","ls","li","cgl","endivPL","cobCaixa"]},
        {title:"Rentabilidade e posição financeira", keys:["margBruta","margEbitda","margLiq","roe","roa","giroAtivo","caixa","divBruta","divLiq","caixaDiv","resultado"]}
      ];
      const meanings:Record<string,string>={lc:"Cobertura das obrigações de curto prazo.",ls:"Cobertura sem depender dos estoques.",li:"Cobertura imediata com disponibilidades.",cgl:"Recursos circulantes menos obrigações de curto prazo.",endivPL:"Dívida bancária relativa aos recursos próprios.",cobCaixa:"Cobertura do passivo circulante com caixa.",margBruta:"Resultado após os custos.",margEbitda:"Desempenho operacional antes de D&A; não é caixa.",margLiq:"Parcela da receita convertida em lucro.",roe:"Retorno mensal sobre saldo final do PL.",roa:"Retorno mensal sobre saldo final do ativo.",giroAtivo:"Receita mensal relativa ao saldo final do ativo.",divLiq:"Dívida bancária menos caixa; não inclui fornecedores.",caixaDiv:"Relação entre caixa e dívida bancária líquida.",resultado:"Lucro ou prejuízo mensal.",caixa:"Disponibilidades na data de fechamento.",divBruta:"Empréstimos e financiamentos bancários."};
      for(let j=0;j<groups.length;j++) {
        const g=groups[j]; if(j===0){secaoAtual={id,titulo:g.title};cabecalho(id,g.title,KICKER[id]??"",false);paginas[paginas.length-1].titulo=g.title;}else y=novaPagina(id,g.title);
        const ls=d.indices.filter(i=>g.keys.includes(i.key));
        y=tabelaBase(["Indicador","Fórmula",d.anterior?mesCurto(d.anterior):"Anterior",mesCurto(d.periodo),"O que demonstra"],ls.map(i=>[i.label,i.formula,fmtI(i.anterior,i.formato),fmtI(i.atual,i.formato),meanings[i.key]??""]),y,{larg0:165,esquerda:[1,4]});
        texto(j===0?T.indicadores:"ROA, ROE e giro são mensais, não anualizados, usando saldos finais. Dívida bancária não inclui fornecedores; dívida líquida negativa não elimina risco de liquidez.",y,W-2*M,M,9);
      }
    } else if (id === "faturamento") {
      const existing = new Map(d.faturamento.map(f=>[f.periodo.slice(0,7),f]));
      const fat=Array.from({length:12},(_,i)=>{const dt=new Date(Date.UTC(Number(d.periodo.slice(0,4)),Number(d.periodo.slice(5,7))-12+i,1));const p=`${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,"0")}-01`;return existing.get(p.slice(0,7))??{periodo:p,valor:null,liquida:null};});
      const n=fat.filter(f=>f.valor!=null).length, nl=fat.filter(f=>f.liquida!=null).length;
      const total=fat.reduce((a,f)=>a+(f.valor??0),0), totalRL=fat.reduce((a,f)=>a+(f.liquida??0),0);
      const rows=fat.map(f=>[mesCurto(f.periodo),f.valor==null?"N/D":fmtV(f.valor),f.liquida==null?"N/D":fmtV(f.liquida),f.valor==null?"Sem dados no BI":"Disponível"]);
      rows.push([`Total parcial (${n} meses)`,fmtV(total),nl?fmtV(totalRL):"N/D","Meses disponíveis"],["Total dos 12 meses",n===12?fmtV(total):"N/D",nl===12?fmtV(totalRL):"N/D",n===12?"Cobertura completa":`${12-n} meses ausentes`]);
      y=tabelaBase(["Mês","Receita bruta","Receita líquida","Cobertura"],rows,y,{larg0:145,esquerda:[3],compacto:true,negrito:i=>i>=12});
      const gh=60,gx=M+32,gw=W-2*M-42,bw=gw/12,max=Math.max(1,...fat.map(f=>Math.abs(f.valor??0)));
      fill(C.branco);doc.rect(M,y-6,W-2*M,gh+26,"F");
      for(let j=0;j<=3;j++){const yy=y+gh-j*gh/3;traco(C.line);doc.line(gx,yy,gx+gw,yy);fonte("normal",6,C.ink2);doc.text(fmtV(max*j/3/1e6),gx-5,yy+2,{align:"right"});}
      fat.forEach((f,i)=>{const h=Math.abs(f.valor??0)/max*gh;fill(i===11?C.lima:C.azul);if(f.valor!=null)doc.rect(gx+i*bw+4,y+gh-h,bw-8,h,"F");fonte("normal",6.5,C.ink2);doc.text(mesCurto(f.periodo),gx+i*bw+bw/2,y+gh+12,{align:"center"});if(f.valor==null)doc.text("N/D",gx+i*bw+bw/2,y+gh-3,{align:"center"});});
      y+=gh+39;
      const missing=fat.filter(f=>f.valor==null).map(f=>mesCurto(f.periodo)).join(", ");
      texto(`Média da receita bruta nos ${n} meses disponíveis: ${n?fmtR(total/n):"N/D"}. ${missing?`Meses sem dados: ${missing}; não são tratados como faturamento zero. O total fechado de 12 meses depende desses dados.`:"Janela de 12 meses completa."}`,y,W-2*M,M,8.5);
    } else if (id === "notas") {
      const itens=(T.notas??"").split(/\n+/).map(x=>x.trim()).filter(Boolean);
      const titles=["Bases e ativo circulante","Ativo não circulante e obrigações","Patrimônio e resultado do período","Fluxo de caixa e informações complementares"];
      for(let j=0;j<Math.ceil(itens.length/4);j++){
        if(j===0){secaoAtual={id,titulo:titles[0]};cabecalho(id,titles[0],KICKER[id]??"",false);paginas[paginas.length-1].titulo=titles[0];}else y=novaPagina(id,titles[j]??"Notas complementares");
        const cw=(W-2*M-16)/2;
        for(let col=0;col<2;col++){
          const x=M+col*(cw+16);fill(C.sunk);traco(C.line);doc.roundedRect(x,y-4,cw,BASE-y-4,8,8,"FD");let yy=y+20;
          for(let k=0;k<2;k++){
            const i=j*4+col*2+k,it=itens[i];if(!it)continue;
            const m=it.match(/^(?:Nota\s+\d+\s*[—–-]\s*)?([^:]+):\s*([\s\S]*)$/i);
            fonte("bold",11,C.azul);doc.text(String(i+1).padStart(2,"0"),x+14,yy);
            fonte("bold",9.5,C.indigo);const title=doc.splitTextToSize(m?.[1]??"Nota explicativa",cw-60);doc.text(title,x+42,yy);yy+=title.length*14+16;
            const body=m?.[2]??it;fonte("normal",9);const lines=doc.splitTextToSize(body,cw-28);doc.text(lines,x+14,yy,{align:"justify",maxWidth:cw-28,lineHeightFactor:1.45});yy+=lines.length*13.05+26;
          }
        }
      }
    } else if (id === "conclusoes") {
      for (const par of (T.conclusoes ?? "").split(/\n+/).map((s) => s.trim()).filter(Boolean)) {
        const m = par.match(/^(\d+\s*[·.)-]\s*[^:]{3,60}):\s*(.+)$/);
        if (m) { if (y > BASE - 50) y = continuacao(); fonte("bold", 9, C.indigo); doc.text(m[1], M, y); y = texto(m[2], y + 16, W - 2 * M, M, 9); }
        else y = texto(par, y, W - 2 * M, M, 9.5);
      }
    } else if (id === "glossario") {
      const itens = (T.glossario ?? "").split(/\n+/).map((s) => s.trim()).filter(Boolean).map((p) => { const k = p.search(/\s[—–-]\s/); return k > 0 ? [p.slice(0, k), p.slice(k + 3)] : [p, ""]; });
      const cw = (W - 2 * M - 30) / 2; let col = 0, yy = y;
      const meio = Math.ceil(itens.length / 2);
      itens.forEach(([t, x], i) => {
        if (i === meio) { col = 1; yy = y; }
        const xx = M + col * (cw + 30);
        fonte("bold", 8, C.indigo); doc.text(t, xx, yy);
        fonte("normal", 7.8, C.ink2); const ls = doc.splitTextToSize(x, cw) as string[]; doc.text(ls, xx, yy + 11);
        yy += 11 + ls.length * 10 + 8;
      });
    } else { texto(T[id], y); }
  }

  // Sumário clicável (duas colunas numeradas)
  if (pagSumario) {
    doc.setPage(pagSumario);
    const cw = (W - 2 * M - 20) / 2, rh = 24, porCol = Math.max(1, Math.ceil(paginas.length / 2));
    paginas.forEach((p, i) => {
      const col = i < porCol ? 0 : 1, x = M + col * (cw + 20), y = TOPO + (i % porCol) * (rh + 5);
      fill(C.card); traco(C.line); doc.setLineWidth(0.5); doc.roundedRect(x, y, cw, rh, 4, 4, "FD");
      fonte("normal", 8, C.azul, "courier"); doc.text(String(i + 1).padStart(2, "0"), x + 12, y + 17);
      fonte("normal", 8, C.indigo); doc.text(doc.splitTextToSize(p.titulo, cw - 75), x + 38, y + 15);
      fonte("normal", 9, C.ink2); doc.text(String(p.pagina), x + cw - 12, y + 17, { align: "right" });
      doc.link(x, y, cw, rh, { pageNumber: p.pagina });
    });
    const yr = TOPO + porCol * (rh + 5) + 16;
    fonte("normal", 8, C.ink2);
    doc.text(`Período principal: ${anoMes}.${d.anterior ? ` Comparação: ${mesExtenso(d.anterior)}.` : ""} Todas as informações referem-se exclusivamente a ${c.empresa.nome}.`, M, yr, { maxWidth: W - 2 * M });
  }
  return doc.output("blob");
}
