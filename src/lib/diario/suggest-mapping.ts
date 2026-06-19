// Sugestão automática de mapeamento DRE/BP a partir do plano importado.
// NÃO assume convenção fixa de códigos — lê a estrutura real do plano.
//
// Regras importantes:
// - Padrões são avaliados em ordem; o PRIMEIRO match vence. Por isso patterns
//   mais específicos (deduções, "não circulante", provisão IR) vêm antes dos
//   genéricos (receita bruta, circulante, custos).
// - "NÃO CIRCULANTE" precisa ser detectado ANTES do match de "CIRCULANTE",
//   independente da ordem das palavras na descrição.

import type { PlanoContaRow } from "./plano-parser";
import {
  descendeDe,
  MASCARA_DEFAULT,
  type MascaraConfig,
} from "@/lib/mascara/interpretar";

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
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// DRE — ordem importa (específico antes de genérico).
const REC_PATTERNS: { rx: RegExp; linha: string; ordem: number; inverter: boolean }[] = [
  // Deduções ANTES de receita bruta (senão "deduções da receita bruta" casa como receita)
  { rx: /deduc/, linha: "(-) Deduções da Receita Bruta", ordem: 110, inverter: false },
  { rx: /receita.*liquida|receita liquida/, linha: "Receita Líquida", ordem: 199, inverter: true },
  { rx: /receita.*bruta|receita de vendas|receita de prestac|receitas imobili/, linha: "Receita Bruta", ordem: 100, inverter: true },

  // Custos (específicos antes do genérico)
  { rx: /custo.*industr/, linha: "(-) Custos Industriais", ordem: 200, inverter: false },
  { rx: /custo.*comerci|custo.*mercador/, linha: "(-) Custos Comerciais", ordem: 210, inverter: false },
  { rx: /custo.*imobili|custo.*unid.*imob/, linha: "(-) Custos Imobiliários", ordem: 220, inverter: false },
  { rx: /custo.*prestac|custo.*servic/, linha: "(-) Custos dos Serviços", ordem: 230, inverter: false },
  { rx: /custo/, linha: "(-) Custos", ordem: 240, inverter: false },

  // Despesas — específicas antes
  { rx: /despesa.*admin/, linha: "(-) Despesas Administrativas", ordem: 310, inverter: false },
  { rx: /despesa.*vend|despesa.*comerci|despesa.*comercializ/, linha: "(-) Despesas Comerciais", ordem: 320, inverter: false },
  { rx: /despesa.*financ/, linha: "(-) Despesas Financeiras", ordem: 510, inverter: false },
  { rx: /despesa.*tribut/, linha: "(-) Despesas Tributárias", ordem: 330, inverter: false },
  { rx: /despesa.*operac/, linha: "(-) Despesas Operacionais", ordem: 300, inverter: false },
  { rx: /outras despesas/, linha: "(-) Outras Despesas Operacionais", ordem: 410, inverter: false },

  // Receitas adicionais
  { rx: /receita.*financ/, linha: "(+) Receitas Financeiras", ordem: 500, inverter: true },
  { rx: /outras receitas/, linha: "(+) Outras Receitas Operacionais", ordem: 400, inverter: true },
  { rx: /ganho.*capital/, linha: "(+) Ganhos de Capital", ordem: 450, inverter: true },
  { rx: /perda.*capital/, linha: "(-) Perdas de Capital", ordem: 460, inverter: false },

  // Provisões IR/CSLL
  { rx: /provis.*contribuic|provis.*csll|contribuic.*social/, linha: "(-) CSLL", ordem: 610, inverter: false },
  { rx: /provis.*imposto.*renda|provis.*ir|imposto.*renda/, linha: "(-) IRPJ", ordem: 600, inverter: false },

  { rx: /distribuic.*lucro/, linha: "(-) Distribuição de Lucros", ordem: 700, inverter: false },
];

// BP Ativo — "nao circulante" PRIMEIRO (regex independente da ordem das palavras)
const BP_ATIVO_PATTERNS: { rx: RegExp; linha: string; ordem: number }[] = [
  { rx: /nao circulante|n circulante/, linha: "Ativo Não Circulante", ordem: 200 },
  { rx: /realizavel.*longo|longo prazo/, linha: "Realizável a Longo Prazo", ordem: 205 },
  { rx: /investiment/, linha: "Investimentos", ordem: 215 },
  { rx: /imobiliz/, linha: "Imobilizado", ordem: 210 },
  { rx: /intang/, linha: "Intangível", ordem: 220 },
  { rx: /circulante/, linha: "Ativo Circulante", ordem: 100 },
];

const BP_PASSIVO_PATTERNS: { rx: RegExp; linha: string; ordem: number }[] = [
  { rx: /nao circulante|n circulante|exigivel.*longo|longo prazo/, linha: "Passivo Não Circulante", ordem: 200 },
  { rx: /capital social|capital e reserva/, linha: "Capital Social", ordem: 310 },
  { rx: /reserva/, linha: "Reservas", ordem: 320 },
  { rx: /lucros? acumulad|prejuizos? acumulad|lucro.*prejuizo/, linha: "Lucros/Prejuízos Acumulados", ordem: 330 },
  { rx: /patrimonio liquido|patrimonio/, linha: "Patrimônio Líquido", ordem: 300 },
  { rx: /circulante/, linha: "Passivo Circulante", ordem: 100 },
];

export function sugerirMapeamento(
  plano: PlanoContaRow[],
  mascara: MascaraConfig = MASCARA_DEFAULT,
): MapeamentoSugerido[] {
  // Sintéticos (não participantes) até nível 4. Nível 4 é importante para captar
  // despesas administrativas / financeiras / provisões IR que ficam abaixo do grupo.
  const candidatos = plano.filter(
    (c) => !c.is_participante && c.nivel >= 2 && c.nivel <= 4,
  );
  const out: MapeamentoSugerido[] = [];
  const seen = new Set<string>();

  // Para evitar mapear nível 4 quando o nível 3 acima já cobre a mesma linha,
  // primeiro montamos um índice por classificação para os já mapeados.
  const prefixosMapeadosPorTipo: Record<string, string[]> = { DRE: [], BPA: [], BPP: [] };

  // Processa em ordem: primeiro nível 2, depois 3, depois 4
  const ordenados = [...candidatos].sort((a, b) => a.nivel - b.nivel);

  for (const c of ordenados) {
    const d = norm(c.descricao);

    if (c.tipo === "3-DRE") {
      // Pula se um ancestral já está mapeado para a mesma classificação prefixo
      const jaCoberto = prefixosMapeadosPorTipo.DRE.some(
        (p) => c.classificacao !== p && descendeDe(c.classificacao, p, mascara),
      );
      if (jaCoberto) continue;

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
            prefixosMapeadosPorTipo.DRE.push(c.classificacao);
          }
          break;
        }
      }
    } else if (c.tipo === "1-Ativo") {
      const jaCoberto = prefixosMapeadosPorTipo.BPA.some(
        (p) => c.classificacao !== p && descendeDe(c.classificacao, p, mascara),
      );
      // Permite refinar Imobilizado/Intangível/Investimentos sob "Ativo Não Circulante"
      const isRefinamento = /imobiliz|intang|investiment|realizavel|longo/.test(d);
      if (jaCoberto && !isRefinamento) continue;

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
            prefixosMapeadosPorTipo.BPA.push(c.classificacao);
          }
          break;
        }
      }
    } else if (c.tipo === "2-Passivo") {
      const jaCoberto = prefixosMapeadosPorTipo.BPP.some(
        (p) => c.classificacao !== p && descendeDe(c.classificacao, p, mascara),
      );
      const isRefinamento = /capital|reserva|lucro|prejuizo|patrimonio/.test(d);
      if (jaCoberto && !isRefinamento) continue;

      for (const p of BP_PASSIVO_PATTERNS) {
        if (p.rx.test(d)) {
          const key = `BPP|${c.classificacao}`;
          if (!seen.has(key)) {
            out.push({
              classificacao_prefixo: c.classificacao,
              tipo_demonstracao: "BP_PASSIVO",
              linha_demonstracao: p.linha,
              ordem: p.ordem,
              inverter_sinal: true, // passivo: movimento credor → exibir positivo
            });
            seen.add(key);
            prefixosMapeadosPorTipo.BPP.push(c.classificacao);
          }
          break;
        }
      }
    }
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
