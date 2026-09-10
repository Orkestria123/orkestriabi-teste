// Atribuição de colunas pelo CONTEÚDO, não pelo nome da 1ª linha.
//
// Toda linha é analítica. A máscara deriva nível e as sintéticas-pai
// (prefixos) usadas no de-para em lote.

import {
  tokenPosicao,
  type CampoLayoutId,
  type LayoutImportacao,
} from "./layout";
import { valorDaLinha, type GradeArquivo } from "./ler-arquivo";
import {
  ancestraisDe,
  dividir,
  grupoDe,
  interpretarClassificacao,
  type MascaraConfig,
} from "@/lib/mascara/interpretar";

export function pareceClassificacao(raw: string, m: MascaraConfig): boolean {
  const s = (raw ?? "").trim();
  if (!s) return false;
  const partes = dividir(s, m);
  const minPartes = Math.min(3, Math.max(2, m.niveis.length - 1));
  if (partes.length < minPartes) return false;
  if (!partes.every((p) => /^[0-9A-Za-z]+$/.test(p))) return false;
  const ultima = partes[partes.length - 1] ?? "";
  if (/^(19|20)\d{2}$/.test(ultima)) return false;
  if (partes.length === 3 && partes.every((p) => p.length <= 2)) return false;
  const g = grupoDe(s, m);
  const nGrupo = Number(partes[0]);
  return g !== "desconhecido" || (Number.isFinite(nGrupo) && nGrupo >= 1 && nGrupo <= 9);
}

function parseValorBR(raw: string): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (!/\d/.test(s)) return null;
  if (!/[,.]/.test(s) && !/^-?\d+$/.test(s)) return null;
  const n = s.includes(",")
    ? Number(s.replace(/\./g, "").replace(",", "."))
    : Number(s);
  return Number.isFinite(n) ? n : null;
}

function pareceData(raw: string): boolean {
  const s = (raw ?? "").trim();
  return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s) || /^\d{4}-\d{2}-\d{2}/.test(s);
}

/** Sugere `#N` pelo padrão das células (máscara, valor, data, histórico…). */
export function sugerirColunasPorConteudo(
  linhas: string[][],
  mascara: MascaraConfig,
): LayoutImportacao["colunas"] {
  const amostra = linhas.slice(0, 40);
  if (amostra.length === 0) return {};
  const nCols = Math.max(0, ...amostra.map((r) => r.length));
  const score: {
    classif: number; valor: number; texto: number; codigo: number;
    data: number; historico: number;
  }[] = Array.from({ length: nCols }, () => ({
    classif: 0, valor: 0, texto: 0, codigo: 0, data: 0, historico: 0,
  }));

  for (const row of amostra) {
    for (let i = 0; i < nCols; i++) {
      const v = (row[i] ?? "").trim();
      if (!v) continue;
      const s = score[i];
      if (pareceClassificacao(v, mascara)) s.classif++;
      if (pareceData(v)) s.data++;
      if (parseValorBR(v) != null && /[.,]/.test(v)) s.valor++;
      if (/[A-Za-zÀ-ÿ]{4,}/.test(v) && v.length >= 6 && !pareceClassificacao(v, mascara) && !pareceData(v)) {
        if (v.length >= 22) s.historico++;
        else s.texto++;
      }
      if (/^\d{2,10}$/.test(v) && !pareceClassificacao(v, mascara)) s.codigo++;
    }
  }

  const minHits = Math.max(3, Math.ceil(amostra.length * 0.35));
  const usados = new Set<number>();
  const colunas: LayoutImportacao["colunas"] = {};
  const pick = (campo: CampoLayoutId, chave: keyof (typeof score)[0], min = minHits) => {
    let best = -1;
    let n = min - 1;
    for (let i = 0; i < nCols; i++) {
      if (usados.has(i)) continue;
      const v = score[i][chave];
      if (v > n) { n = v; best = i; }
    }
    if (best >= 0) {
      usados.add(best);
      colunas[campo] = tokenPosicao(best);
    }
  };

  pick("classificacao", "classif", Math.max(2, Math.ceil(amostra.length * 0.25)));
  pick("data", "data", Math.max(2, Math.ceil(amostra.length * 0.25)));
  pick("conta", "codigo", Math.max(2, Math.ceil(amostra.length * 0.2)));
  pick("descricao", "texto");
  pick("historico", "historico", Math.max(2, Math.ceil(amostra.length * 0.2)));

  const money = score
    .map((s, i) => ({ i, v: s.valor }))
    .filter((x) => !usados.has(x.i) && x.v >= Math.max(2, Math.ceil(amostra.length * 0.2)))
    .sort((a, b) => b.v - a.v)
    .slice(0, 2)
    .sort((a, b) => a.i - b.i);
  if (money.length >= 2) {
    colunas.debito = tokenPosicao(money[0].i);
    colunas.credito = tokenPosicao(money[1].i);
    usados.add(money[0].i);
    usados.add(money[1].i);
  } else {
    pick("valor", "valor");
  }
  return colunas;
}

export interface LinhaInterpretadaLayout {
  conta: string;
  classificacao: string;
  descricao: string;
  historico: string;
  valor: number;
  nivel: number;
  rotuloNivel: string;
  grupo: string;
}

export interface PreviaLayoutMascara {
  analiticas: LinhaInterpretadaLayout[];
  sinteticasInferidas: { classificacao: string; nivel: number; rotuloNivel: string; filhos: number }[];
  avisos: string[];
}

export function interpretarGradeComMascara(
  grade: GradeArquivo,
  layout: LayoutImportacao,
  mascara: MascaraConfig,
): PreviaLayoutMascara {
  const avisos: string[] = [];
  const analiticas: LinhaInterpretadaLayout[] = [];
  const porConta = new Set<string>();

  for (const row of grade.linhas) {
    const classificacao = valorDaLinha(grade.headers, row, layout.colunas.classificacao);
    const conta = valorDaLinha(grade.headers, row, layout.colunas.conta);
    if (!classificacao && !conta) continue;
    const chave = conta || classificacao;
    if (porConta.has(chave)) continue;
    porConta.add(chave);

    const interp = interpretarClassificacao(classificacao, mascara);
    const nivel = interp.nivel;
    const rotuloNivel =
      mascara.niveis[Math.max(0, nivel - 1)]?.nome ??
      interp.rotulos[interp.rotulos.length - 1]?.nome ??
      `Nível ${nivel}`;

    analiticas.push({
      conta: chave,
      classificacao,
      descricao: valorDaLinha(grade.headers, row, layout.colunas.descricao),
      historico: valorDaLinha(grade.headers, row, layout.colunas.historico),
      valor: parseValorBR(valorDaLinha(grade.headers, row, layout.colunas.valor)) ?? 0,
      nivel,
      rotuloNivel,
      grupo: interp.grupo,
    });
  }

  const filhosPorPai = new Map<string, { nivel: number; rotuloNivel: string; n: number }>();
  for (const l of analiticas) {
    for (const a of ancestraisDe(l.classificacao, mascara)) {
      const prev = filhosPorPai.get(a.classificacao);
      if (prev) prev.n += 1;
      else filhosPorPai.set(a.classificacao, { nivel: a.nivel, rotuloNivel: a.rotuloNivel, n: 1 });
    }
  }

  const sinteticasInferidas = [...filhosPorPai.entries()]
    .map(([classificacao, v]) => ({ classificacao, nivel: v.nivel, rotuloNivel: v.rotuloNivel, filhos: v.n }))
    .sort((a, b) => a.classificacao.localeCompare(b.classificacao, "pt-BR", { numeric: true }));

  if (grade.truncado) {
    avisos.push("Prévia da amostra — o arquivo completo não é carregado nesta tela.");
  }

  return { analiticas, sinteticasInferidas, avisos };
}
