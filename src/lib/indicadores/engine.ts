// Engine de indicadores customizados por empresa.
// Recebe plano_contas + saldos + expressão tokenizada e devolve série
// { periodo, valor }[]. Puro, testável, sem I/O.

import {
  dividir,
  descendeDe,
  grupoDe,
  type MascaraConfig,
  MASCARA_DEFAULT,
} from "@/lib/mascara/interpretar";

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export type ModoAnalise = "numero" | "reais" | "percentual" | "ah_percent" | "ah_valor";
export type Visibilidade = "invisivel" | "indicadores" | "dashboard" | "ambos";

export type Token =
  | { tipo: "parentese"; valor: "(" | ")" }
  | { tipo: "operador"; valor: "+" | "-" | "*" | "/" }
  | { tipo: "termo"; contas: string[]; sinais?: ("+" | "-")[] }
  | { tipo: "constante"; valor: number };

export interface Formula {
  expressao: Token[];
}

export interface Faixas {
  otimo?: number | null;
  bom?: number | null;
  atencao?: number | null;
  critico?: number | null;
  /** Se true, valores menores são melhores (ex.: endividamento). */
  direcao?: "maior_melhor" | "menor_melhor";
}

export interface IndicadorEmpresa {
  id: string;
  tenant_id: string;
  company_id: string;
  nome: string;
  categoria: string;
  formula: Formula;
  modo_analise: ModoAnalise;
  faixas: Faixas | null;
  descricao: string | null;
  visibilidade: Visibilidade;
  is_padrao: boolean;
  revisar_contas: boolean;
  ordem: number;
}

export interface PlanoRowEng {
  classificacao: string;
  descricao: string;
  natureza: string | null; // "C" | "D"
  is_sintetica: boolean | null;
  is_participante?: boolean;
}

export interface SaldoRow {
  conta_codigo: string;
  competencia: string; // "YYYY-MM-01"
  total_debitos: number;
  total_creditos: number;
}

// ------------------------------------------------------------
// Validação
// ------------------------------------------------------------

export function validarExpressao(tokens: Token[]): string[] {
  const err: string[] = [];
  if (!tokens || tokens.length === 0) {
    err.push("Expressão vazia.");
    return err;
  }
  // Parênteses balanceados
  let bal = 0;
  for (const t of tokens) {
    if (t.tipo === "parentese") {
      bal += t.valor === "(" ? 1 : -1;
      if (bal < 0) {
        err.push("Parêntese ')' sem '(' correspondente.");
        break;
      }
    }
  }
  if (bal !== 0) err.push("Parênteses não balanceados.");

  // Sequência operador/valor
  const isValor = (t: Token) => t.tipo === "termo" || t.tipo === "constante";
  const isOp = (t: Token) => t.tipo === "operador";
  for (let i = 0; i < tokens.length; i++) {
    const cur = tokens[i];
    const next = tokens[i + 1];
    if (cur.tipo === "termo") {
      if (!cur.contas || cur.contas.length === 0) err.push("Termo sem contas selecionadas.");
    }
    if (isOp(cur) && (!next || (isOp(next) && (next as any).valor !== "("))) {
      err.push("Operador seguido de outro operador ou fim da expressão.");
    }
    if (isValor(cur) && next && isValor(next)) {
      err.push("Dois valores consecutivos sem operador entre eles.");
    }
  }
  // Não pode começar com operador binário
  const first = tokens[0];
  if (first && first.tipo === "operador" && first.valor !== "-") {
    err.push("Expressão não pode começar com operador.");
  }
  return Array.from(new Set(err));
}

// ------------------------------------------------------------
// Expansão de sintéticas em analíticas
// ------------------------------------------------------------

/**
 * Dada uma classificação (sintética ou analítica), retorna todas as
 * classificações analíticas descendentes que existem no plano.
 * Analítica = folha (não sintética) OU participante (clientes/fornecedores).
 */
export function expandirContas(
  classificacao: string,
  plano: PlanoRowEng[],
  mascara: MascaraConfig = MASCARA_DEFAULT,
): string[] {
  if (!classificacao) return [];
  const out: string[] = [];
  for (const p of plano) {
    if (!descendeDe(p.classificacao, classificacao, mascara)) continue;
    // Consideramos "folha" quando não é sintética (participantes também).
    if (p.is_sintetica === true) continue;
    out.push(p.classificacao);
  }
  // Se a própria classificação for analítica e não estiver, adiciona.
  if (out.length === 0) {
    const self = plano.find((p) => p.classificacao === classificacao);
    if (self && self.is_sintetica !== true) out.push(self.classificacao);
  }
  return out;
}

// ------------------------------------------------------------
// Contexto de cálculo (indexes)
// ------------------------------------------------------------

export interface EngineContext {
  plano: PlanoRowEng[];
  saldos: SaldoRow[];
  aberturas: Map<string, number>;
  mascara: MascaraConfig;
  /** classificacao → PlanoRowEng (para lookups rápidos) */
  planoByClass: Map<string, PlanoRowEng>;
  /** conta_codigo dos saldos → classificacao do plano (via `codigo`) */
  saldoKeyToClass: Map<string, string>;
  /** classificacao → array de saldos indexados por periodo */
  saldosByClass: Map<string, Map<string, SaldoRow>>;
  /** todos os períodos com dado, ordenados */
  periodosDisponiveis: string[];
}

/**
 * `codigo` no plano vs `classificacao`: `conta_codigo` em saldos_mensais
 * corresponde ao `codigo` (não à `classificacao`). Aqui recebemos os
 * saldos já mapeados (o hook faz o mapping); então saldoKey === classificacao.
 */
export function buildContext(input: {
  plano: PlanoRowEng[];
  saldos: SaldoRow[];
  aberturas: Map<string, number>;
  mascara?: MascaraConfig;
}): EngineContext {
  const mascara = input.mascara ?? MASCARA_DEFAULT;
  const planoByClass = new Map<string, PlanoRowEng>();
  for (const p of input.plano) planoByClass.set(p.classificacao, p);

  const saldosByClass = new Map<string, Map<string, SaldoRow>>();
  const periodosSet = new Set<string>();
  for (const s of input.saldos) {
    periodosSet.add(s.competencia);
    let m = saldosByClass.get(s.conta_codigo);
    if (!m) {
      m = new Map();
      saldosByClass.set(s.conta_codigo, m);
    }
    m.set(s.competencia, s);
  }

  return {
    plano: input.plano,
    saldos: input.saldos,
    aberturas: input.aberturas,
    mascara,
    planoByClass,
    saldoKeyToClass: new Map(),
    saldosByClass,
    periodosDisponiveis: Array.from(periodosSet).sort(),
  };
}

// ------------------------------------------------------------
// Valor de uma conta em um período
// ------------------------------------------------------------

/**
 * Valor de uma conta ANALÍTICA no período:
 * - Patrimoniais (ativo/passivo/pl): saldo acumulado ao fim do período
 *   = abertura + Σ(movimentos) até o período. Assinado por natureza.
 * - Resultado (receita/despesa/resultado): movimento do próprio período.
 * - Sinal por natureza: C → créditos−débitos ; D → débitos−créditos.
 */
export function valorContaAnalitica(
  classificacao: string,
  periodo: string,
  ctx: EngineContext,
): number {
  const p = ctx.planoByClass.get(classificacao);
  if (!p) return 0;
  const grupo = grupoDe(classificacao, ctx.mascara);
  const isPatrimonial = grupo === "ativo" || grupo === "passivo" || grupo === "pl";

  // Natureza contábil (Débito × Crédito) para inverter o sinal do movimento.
  // O campo `natureza` do plano guarda "S/A" (sintética/analítica) na maioria
  // dos escritórios brasileiros, então NÃO dá para inferir C/D dele.
  // Usamos o GRUPO da classificação como fonte de verdade:
  //   ativo, despesa  → devedor (D)
  //   passivo, pl, receita, resultado → credor (C)
  const naturezaRaw = (p.natureza ?? "").toUpperCase();
  const natureza: "C" | "D" =
    naturezaRaw === "C" || naturezaRaw === "D"
      ? (naturezaRaw as "C" | "D")
      : (grupo === "passivo" || grupo === "pl" || grupo === "receita" || grupo === "resultado")
      ? "C"
      : "D";

  const saldosMap = ctx.saldosByClass.get(classificacao);

  const signMov = (s: SaldoRow) =>
    natureza === "C"
      ? Number(s.total_creditos) - Number(s.total_debitos)
      : Number(s.total_debitos) - Number(s.total_creditos);

  if (isPatrimonial) {
    const abertura = ctx.aberturas.get(classificacao) ?? 0;
    let acum = Number(abertura) || 0;
    if (saldosMap) {
      for (const [comp, s] of saldosMap) {
        if (comp <= periodo) acum += signMov(s);
      }
    }
    return acum;
  }
  // resultado (receita/despesa)
  if (!saldosMap) return 0;
  const s = saldosMap.get(periodo);
  return s ? signMov(s) : 0;
}

/** Valor de uma classificação (expande sintética). */
export function valorConta(
  classificacao: string,
  periodo: string,
  ctx: EngineContext,
): number {
  const analiticas = expandirContas(classificacao, ctx.plano, ctx.mascara);
  let total = 0;
  for (const a of analiticas) total += valorContaAnalitica(a, periodo, ctx);
  return total;
}

// ------------------------------------------------------------
// Avaliação da expressão (shunting-yard)
// ------------------------------------------------------------

const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };

function valorTermo(
  contas: string[],
  sinais: ("+" | "-")[] | undefined,
  periodo: string,
  ctx: EngineContext,
): number {
  let total = 0;
  for (let i = 0; i < contas.length; i++) {
    const s = sinais?.[i] === "-" ? -1 : 1;
    total += s * valorConta(contas[i], periodo, ctx);
  }
  return total;
}

export function avaliarExpressao(
  tokens: Token[],
  periodo: string,
  ctx: EngineContext,
): number | null {
  // Converte para RPN
  const output: Token[] = [];
  const stack: Token[] = [];
  for (const t of tokens) {
    if (t.tipo === "termo" || t.tipo === "constante") {
      output.push(t);
    } else if (t.tipo === "operador") {
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.tipo === "operador" && PREC[top.valor] >= PREC[t.valor]) {
          output.push(stack.pop()!);
        } else break;
      }
      stack.push(t);
    } else if (t.tipo === "parentese") {
      if (t.valor === "(") stack.push(t);
      else {
        while (stack.length && !(stack[stack.length - 1].tipo === "parentese")) {
          output.push(stack.pop()!);
        }
        if (stack.length) stack.pop(); // "("
      }
    }
  }
  while (stack.length) output.push(stack.pop()!);

  // Avalia RPN
  const rpn: number[] = [];
  for (const t of output) {
    if (t.tipo === "termo") {
      rpn.push(valorTermo(t.contas, t.sinais, periodo, ctx));
    } else if (t.tipo === "constante") {
      rpn.push(Number(t.valor) || 0);
    } else if (t.tipo === "operador") {
      const b = rpn.pop();
      const a = rpn.pop();
      if (a === undefined || b === undefined) return null;
      let r = 0;
      switch (t.valor) {
        case "+": r = a + b; break;
        case "-": r = a - b; break;
        case "*": r = a * b; break;
        case "/": r = b === 0 ? NaN : a / b; break;
      }
      rpn.push(r);
    }
  }
  if (rpn.length !== 1) return null;
  const v = rpn[0];
  return isFinite(v) ? v : null;
}

// ------------------------------------------------------------
// Cálculo por indicador × períodos
// ------------------------------------------------------------

export interface SeriePonto {
  periodo: string;
  valor: number | null;
}

export function calcularSerie(
  ind: IndicadorEmpresa,
  periodos: string[],
  ctx: EngineContext,
): SeriePonto[] {
  return periodos.map((p) => ({ periodo: p, valor: avaliarExpressao(ind.formula.expressao, p, ctx) }));
}

/**
 * Aplica o modo de análise sobre a série "crua" (número da fórmula por
 * período). Retorna a série que a UI deve exibir.
 */
export function aplicarModo(
  serie: SeriePonto[],
  modo: ModoAnalise,
): { serie: SeriePonto[]; valorPrincipal: number | null } {
  const validos = serie.filter((p) => p.valor != null) as { periodo: string; valor: number }[];
  if (modo === "ah_percent" || modo === "ah_valor") {
    if (validos.length < 2) return { serie, valorPrincipal: null };
    const ini = validos[0].valor;
    const fim = validos[validos.length - 1].valor;
    if (modo === "ah_valor") return { serie, valorPrincipal: fim - ini };
    if (ini === 0) return { serie, valorPrincipal: null };
    return { serie, valorPrincipal: ((fim - ini) / Math.abs(ini)) * 100 };
  }
  if (modo === "percentual") {
    const s = serie.map((p) => ({ periodo: p.periodo, valor: p.valor == null ? null : p.valor * 100 }));
    return { serie: s, valorPrincipal: s[s.length - 1]?.valor ?? null };
  }
  return { serie, valorPrincipal: serie[serie.length - 1]?.valor ?? null };
}

// ------------------------------------------------------------
// Formatação
// ------------------------------------------------------------

export function formatarValor(v: number | null, modo: ModoAnalise): string {
  if (v == null || !isFinite(v)) return "—";
  const fmtNum = (n: number, d = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (modo === "reais") return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (modo === "percentual" || modo === "ah_percent") return `${fmtNum(v, 1)}%`;
  if (modo === "ah_valor") return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return fmtNum(v, 2);
}

// ------------------------------------------------------------
// Serialização da fórmula em texto legível
// ------------------------------------------------------------

export function formulaParaTexto(
  formula: Formula,
  labelDaConta: (cls: string) => string,
): string {
  const parts: string[] = [];
  for (const t of formula.expressao) {
    if (t.tipo === "parentese") parts.push(t.valor);
    else if (t.tipo === "operador") {
      const map: Record<string, string> = { "+": "+", "-": "−", "*": "×", "/": "÷" };
      parts.push(map[t.valor] ?? t.valor);
    } else if (t.tipo === "constante") parts.push(String(t.valor));
    else {
      const inside = t.contas
        .map((c, i) => `${t.sinais?.[i] === "-" ? "− " : i > 0 ? "+ " : ""}[${labelDaConta(c) || c}]`)
        .join(" ");
      parts.push(t.contas.length > 1 ? `(${inside})` : inside);
    }
  }
  return parts.join(" ");
}

// ------------------------------------------------------------
// Faixa por valor (usada pela UI para colorir)
// ------------------------------------------------------------

export type FaixaChave = "otimo" | "bom" | "atencao" | "critico" | "neutro";

export function classificarFaixa(v: number | null, faixas: Faixas | null | undefined): FaixaChave {
  if (v == null || !faixas) return "neutro";
  const dir = faixas.direcao ?? "maior_melhor";
  const geq = (a: number, b?: number | null) => (b == null ? false : a >= b);
  const leq = (a: number, b?: number | null) => (b == null ? false : a <= b);
  if (dir === "maior_melhor") {
    if (geq(v, faixas.otimo)) return "otimo";
    if (geq(v, faixas.bom)) return "bom";
    if (geq(v, faixas.atencao)) return "atencao";
    return "critico";
  }
  if (leq(v, faixas.otimo)) return "otimo";
  if (leq(v, faixas.bom)) return "bom";
  if (leq(v, faixas.atencao)) return "atencao";
  return "critico";
}

// ------------------------------------------------------------
// Utilitário: sugestões de contas por termo padrão (heurística)
// ------------------------------------------------------------

export function sugerirContasPorLabel(label: string, plano: PlanoRowEng[]): string[] {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const alvo = norm(label);
  const tokens = alvo.split(/\s+/).filter(Boolean);
  const candidatos = plano
    .filter((p) => !p.is_participante && p.is_sintetica !== false || p.is_sintetica === true)
    .filter((p) => {
      const d = norm(p.descricao);
      return tokens.some((t) => d.includes(t));
    });
  // Preferir sintéticas em nível baixo (mais agregadas).
  candidatos.sort(
    (a, b) => dividir(a.classificacao).length - dividir(b.classificacao).length,
  );
  return candidatos.slice(0, 1).map((p) => p.classificacao);
}
