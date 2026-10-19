import { describe, expect, it } from "vitest";
import { avaliarExpressao, buildContext, valoresTermosFormula, type Formula } from "./engine";

// Open formula verified against the August/2026 company ledger and user spreadsheet.
const formula: Formula = {
  "expressao": [
    {
      "tipo": "termo",
      "contas": [
        "1.01.02.01"
      ],
      "origem": "conta",
      "sinais": [
        "+"
      ]
    },
    {
      "tipo": "operador",
      "valor": "+"
    },
    {
      "tipo": "termo",
      "contas": [
        "1.01.02.07"
      ],
      "origem": "conta",
      "sinais": [
        "+"
      ]
    },
    {
      "tipo": "operador",
      "valor": "+"
    },
    {
      "tipo": "termo",
      "contas": [
        "1.01.02.08"
      ],
      "origem": "conta",
      "sinais": [
        "+"
      ]
    },
    {
      "tipo": "operador",
      "valor": "+"
    },
    {
      "tipo": "termo",
      "contas": [
        "1.01.02.09"
      ],
      "origem": "conta",
      "sinais": [
        "+"
      ]
    },
    {
      "tipo": "operador",
      "valor": "+"
    },
    {
      "tipo": "termo",
      "contas": [
        "1.01.02.10"
      ],
      "origem": "conta",
      "sinais": [
        "+"
      ]
    },
    {
      "tipo": "operador",
      "valor": "+"
    },
    {
      "tipo": "termo",
      "contas": [
        "1.01.03"
      ],
      "origem": "conta",
      "sinais": [
        "+"
      ]
    },
    {
      "tipo": "operador",
      "valor": "-"
    },
    {
      "tipo": "termo",
      "contas": [
        "2.01.01.01"
      ],
      "origem": "conta",
      "sinais": [
        "+"
      ]
    },
    {
      "tipo": "operador",
      "valor": "-"
    },
    {
      "tipo": "termo",
      "contas": [
        "2.01.01.02"
      ],
      "origem": "conta",
      "sinais": [
        "+"
      ]
    },
    {
      "tipo": "operador",
      "valor": "-"
    },
    {
      "tipo": "termo",
      "contas": [
        "2.01.01.03"
      ],
      "origem": "conta",
      "sinais": [
        "+"
      ]
    },
    {
      "tipo": "operador",
      "valor": "-"
    },
    {
      "tipo": "termo",
      "contas": [
        "2.01.01.04"
      ],
      "origem": "conta",
      "sinais": [
        "+"
      ]
    },
    {
      "tipo": "operador",
      "valor": "-"
    },
    {
      "tipo": "termo",
      "contas": [
        "2.01.01.07"
      ],
      "origem": "conta",
      "sinais": [
        "+"
      ]
    },
    {
      "tipo": "operador",
      "valor": "-"
    },
    {
      "tipo": "termo",
      "contas": [
        "2.01.01.09"
      ],
      "origem": "conta",
      "sinais": [
        "+"
      ]
    }
  ]
};
const periodo = "2026-08-01";
const saldos: Record<string, number> = {
  "1.01.02.01": 14303951.44, "1.01.02.07": 3216770.55,
  "1.01.02.08": 25656.23, "1.01.02.09": 4068426.78,
  "1.01.02.10": 11546.38, "1.01.03": 14105284.51,
  "2.01.01.01": -7112287.50, "2.01.01.02": -350876.94,
  "2.01.01.03": -1144012.13, "2.01.01.04": -397148.25,
  "2.01.01.07": -116850.46, "2.01.01.09": -100166.56,
};
const ctx = buildContext({
  plano: Object.keys(saldos).map(classificacao => ({ classificacao, descricao: classificacao, natureza: classificacao.startsWith("1") ? "D" : "C", is_sintetica: false })),
  saldos: [], aberturas: new Map(), saldoAcumuladoDC: cls => saldos[cls] ?? null,
});
describe("Capital de Giro Open — agosto/2026", () => {
  const termos = valoresTermosFormula(formula.expressao, periodo, ctx);
  it("inclui Adiantamento Diversos de R$ 3.216.770,55 uma vez", () => {
    expect(termos[1].valor).toBeCloseTo(3216770.55, 2);
    expect(formula.expressao.filter(t => t.tipo === "termo" && t.contas?.includes("1.01.02.07"))).toHaveLength(1);
    expect(formula.expressao.some(t => t.tipo === "termo" && t.contas?.some(c => c.startsWith("1.01.02.07.")))).toBe(false);
  });
  it("inclui Créditos Diversos de R$ 11.546,38", () => {
    expect(termos[4].valor).toBeCloseTo(11546.38, 2);
  });
  it("preserva funcionários e totaliza R$ 26.510.294,05", () => {
    expect(termos[2].valor).toBeCloseTo(25656.23, 2);
    expect(avaliarExpressao(formula.expressao, periodo, ctx)).toBeCloseTo(26510294.05, 2);
  });
});
