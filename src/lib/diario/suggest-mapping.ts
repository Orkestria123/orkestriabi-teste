// Sugestão automática de mapeamento DRE/BP a partir do plano importado.
// NÃO assume convenção fixa de códigos — lê a estrutura real do plano.

import type { PlanoContaRow } from "./plano-parser";

export type TipoDemonstracao = "DRE" | "BP_ATIVO" | "BP_PASSIVO" | "DFC";

export interface MapeamentoSugerido {
  classificacao_prefixo: string;
  tipo_demonstracao: TipoDemonstracao;
  linha_demonstracao: string;
  ordem: number;
  inverter_sinal: boolean;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

const REC_PATTERNS = [
  { rx: /receita.*bruta/i, linha: "Receita Bruta", ordem: 100, inverter: true },
  { rx: /deduc/i, linha: "(-) Deduções da Receita Bruta", ordem: 110, inverter: false },
  { rx: /receita.*liquida/i, linha: "Receita Líquida", ordem: 199, inverter: true },
  { rx: /custo.*industr/i, linha: "(-) Custos Industriais", ordem: 200, inverter: false },
  { rx: /custo.*comerci/i, linha: "(-) Custos Comerciais", ordem: 210, inverter: false },
  { rx: /custo.*imobili/i, linha: "(-) Custos Imobiliários", ordem: 220, inverter: false },
  { rx: /custo.*prestac|custo.*servic/i, linha: "(-) Custos dos Serviços", ordem: 230, inverter: false },
  { rx: /custo/i, linha: "(-) Custos", ordem: 240, inverter: false },
  { rx: /despesa.*operac/i, linha: "(-) Despesas Operacionais", ordem: 300, inverter: false },
  { rx: /despesa.*admin/i, linha: "(-) Despesas Administrativas", ordem: 310, inverter: false },
  { rx: /despesa.*vend|despesa.*comerci/i, linha: "(-) Despesas Comerciais", ordem: 320, inverter: false },
  { rx: /outras.*receit/i, linha: "(+) Outras Receitas Operacionais", ordem: 400, inverter: true },
  { rx: /outras.*despes/i, linha: "(-) Outras Despesas Operacionais", ordem: 410, inverter: false },
  { rx: /receita.*financ/i, linha: "(+) Receitas Financeiras", ordem: 500, inverter: true },
  { rx: /despesa.*financ/i, linha: "(-) Despesas Financeiras", ordem: 510, inverter: false },
  { rx: /ir|imposto.*renda|csll|contribuicao.*social/i, linha: "(-) IR/CSLL", ordem: 600, inverter: false },
];

const BP_ATIVO_PATTERNS = [
  { rx: /(circulante)(?!.*nao)/i, linha: "Ativo Circulante", ordem: 100 },
  { rx: /nao.*circulante|n.?o.*circulante/i, linha: "Ativo Não Circulante", ordem: 200 },
  { rx: /imobiliz/i, linha: "Imobilizado", ordem: 210 },
  { rx: /intang/i, linha: "Intangível", ordem: 220 },
];

const BP_PASSIVO_PATTERNS = [
  { rx: /(circulante)(?!.*nao)/i, linha: "Passivo Circulante", ordem: 100 },
  { rx: /nao.*circulante|n.?o.*circulante/i, linha: "Passivo Não Circulante", ordem: 200 },
  { rx: /patrimonio/i, linha: "Patrimônio Líquido", ordem: 300 },
  { rx: /capital/i, linha: "Capital Social", ordem: 310 },
  { rx: /reserva/i, linha: "Reservas", ordem: 320 },
  { rx: /lucro|prejuizo.*acum/i, linha: "Lucros/Prejuízos Acumulados", ordem: 330 },
];

export function sugerirMapeamento(plano: PlanoContaRow[]): MapeamentoSugerido[] {
  // Considera nós até nível 3, não participantes, sintéticos preferidos
  const candidatos = plano.filter(
    (c) => !c.is_participante && c.nivel >= 2 && c.nivel <= 3,
  );
  const out: MapeamentoSugerido[] = [];
  const seen = new Set<string>();

  for (const c of candidatos) {
    const d = norm(c.descricao);
    let added = false;

    if (c.tipo === "3-DRE") {
      for (const p of REC_PATTERNS) {
        if (p.rx.test(d)) {
          const key = `DRE|${c.classificacao}`;
          if (!seen.has(key)) {
            out.push({
              classificacao_prefixo: c.classificacao,
              tipo_demonstracao: "DRE",
              linha_demonstracao: p.linha,
              ordem: p.ordem,
              inverter_sinal: p.inverter,
            });
            seen.add(key);
            added = true;
          }
          break;
        }
      }
    } else if (c.tipo === "1-Ativo") {
      for (const p of BP_ATIVO_PATTERNS) {
        if (p.rx.test(d)) {
          const key = `BPA|${c.classificacao}`;
          if (!seen.has(key)) {
            out.push({
              classificacao_prefixo: c.classificacao,
              tipo_demonstracao: "BP_ATIVO",
              linha_demonstracao: p.linha,
              ordem: p.ordem,
              inverter_sinal: false,
            });
            seen.add(key);
            added = true;
          }
          break;
        }
      }
    } else if (c.tipo === "2-Passivo") {
      for (const p of BP_PASSIVO_PATTERNS) {
        if (p.rx.test(d)) {
          const key = `BPP|${c.classificacao}`;
          if (!seen.has(key)) {
            const isPL = /patrimonio|capital|reserva|lucro|prejuizo/i.test(d);
            out.push({
              classificacao_prefixo: c.classificacao,
              tipo_demonstracao: "BP_PASSIVO",
              linha_demonstracao: p.linha,
              ordem: p.ordem,
              inverter_sinal: true, // passivo: movimento credor → exibir positivo
            });
            seen.add(key);
            added = true;
          }
          break;
        }
      }
    }
    void added;
  }

  return out;
}

// Detecta classificações de DRE/BP que ficaram sem mapeamento
export function classificacoesNaoMapeadas(
  plano: PlanoContaRow[],
  mapa: { classificacao_prefixo: string }[],
): { classificacao: string; descricao: string; tipo: string }[] {
  const prefixos = mapa.map((m) => m.classificacao_prefixo);
  const matchaPrefix = (c: string) => prefixos.some((p) => c.startsWith(p));
  const pendentes: { classificacao: string; descricao: string; tipo: string }[] = [];
  const seen = new Set<string>();
  for (const c of plano) {
    if (c.is_participante) continue;
    if (!["1-Ativo", "2-Passivo", "3-DRE"].includes(c.tipo)) continue;
    if (c.nivel !== 3) continue; // foco no grupo
    if (matchaPrefix(c.classificacao)) continue;
    if (seen.has(c.classificacao)) continue;
    seen.add(c.classificacao);
    pendentes.push({ classificacao: c.classificacao, descricao: c.descricao, tipo: c.tipo });
  }
  return pendentes;
}
