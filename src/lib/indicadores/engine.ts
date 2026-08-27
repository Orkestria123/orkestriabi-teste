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
import { compararClassificacao, getEstruturaPadraoSync } from "@/lib/plano/estrutura";

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export type ModoAnalise = "numero" | "reais" | "percentual" | "ah_percent" | "ah_valor";
export type Visibilidade = "invisivel" | "indicadores" | "dashboard" | "ambos";

export function destinosDe(v: Visibilidade | string): { dashboard: boolean; aba: boolean } {
  return {
    dashboard: v === "dashboard" || v === "ambos",
    aba: v === "indicadores" || v === "ambos",
  };
}

export function visibilidadeDe(d: { dashboard: boolean; aba: boolean }): Visibilidade {
  if (d.dashboard && d.aba) return "ambos";
  if (d.dashboard) return "dashboard";
  if (d.aba) return "indicadores";
  return "invisivel";
}

/**
 * Um TERMO pode ter duas origens:
 *  - "conta"        (default): usa uma ou várias contas do plano (com sinais internos).
 *  - "demonstracao": referencia uma LINHA de demonstração (ex.: "Receita Líquida",
 *                    "Ativo Total") — resolvida pelo MESMO motor da DRE/BP.
 */
export type Token =
  | { tipo: "parentese"; valor: "(" | ")" }
  | { tipo: "operador"; valor: "+" | "-" | "*" | "/" }
  | {
      tipo: "termo";
      origem?: "conta" | "demonstracao";
      contas?: string[];
      sinais?: ("+" | "-")[];
      linha?: string;
    }
  | { tipo: "constante"; valor: number };

export interface Formula {
  expressao: Token[];
}

export function tokensDaFormula(formula: Formula | Token[] | null | undefined): Token[] {
  if (!formula) return [];
  if (Array.isArray(formula)) return formula;
  const exp = (formula as Formula).expressao;
  return Array.isArray(exp) ? exp : [];
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
  codigo?: string | null;
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
      const origem: "demonstracao" | "conta" =
        cur.origem === "demonstracao" || !!cur.linha ? "demonstracao" : "conta";
      if (origem === "conta") {
        if (!cur.contas || cur.contas.length === 0) err.push("Termo sem contas selecionadas.");
      } else if (!cur.linha) {
        err.push("Termo de linha de demonstração sem linha selecionada.");
      }
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
  // Sem `Set` aqui, uma classificação repetida no plano era contada uma vez
  // por conta. E ela se repete de verdade: no plano do escritório 31
  // classificações são compartilhadas por mais de uma conta (dois códigos
  // em 1.03.03.02.01 — "VEICULOS INDUSTRIA" e "VEICULOS SERVICOS" — e os
  // milhares de clientes/fornecedores pendurados na mesma classificação).
  // Como os saldos são indexados POR CLASSIFICAÇÃO, o mesmo saldo entrava
  // duas vezes: o Ativo Não Circulante saía 380.000 em vez de 180.000.
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const p of plano) {
    if (!descendeDe(p.classificacao, classificacao, mascara)) continue;
    // Consideramos "folha" quando não é sintética (participantes também).
    if (p.is_sintetica === true) continue;
    if (vistos.has(p.classificacao)) continue;
    vistos.add(p.classificacao);
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
  /** código reduzido → PlanoRowEng */
  planoByCodigo: Map<string, PlanoRowEng>;
  /** conta_codigo dos saldos → classificacao do plano (via `codigo`) */
  saldoKeyToClass: Map<string, string>;
  /** classificacao → array de saldos indexados por periodo */
  saldosByClass: Map<string, Map<string, SaldoRow>>;
  /** código reduzido → saldos por período (sem agregar contas que compartilham classificação) */
  saldosByCodigo: Map<string, Map<string, SaldoRow>>;
  /** todos os períodos com dado, ordenados */
  periodosDisponiveis: string[];
  /**
   * Saldo patrimonial JÁ acumulado, na convenção débito−crédito:
   * classificacao → periodo → saldo.
   *
   * Quando presente, manda: é o mesmo número que o Balanço usa, montado
   * pelo `acumulador` (abertura + movimento POSTERIOR à data dela).
   * Sem isto o indicador somava a abertura mais TODO o movimento até o
   * período — inclusive o anterior à abertura, que ela já embute. Numa
   * base com abertura no meio do ano isso quase dobra o Ativo.
   */
  acumuladoByClass?: Map<string, Map<string, number>>;
  /**
   * Saldo acumulado sob demanda (D−C), para QUALQUER período — inclusive
   * os que não têm movimento. O mapa acima só cobre períodos com
   * movimento; devolver 0 fora deles zerava todo o Balanço num período
   * sem lançamento, em vez de mostrar a abertura.
   * Devolve `null` quando a classificação não é conhecida.
   */
  saldoAcumuladoDC?: (classificacao: string, periodo: string) => number | null;
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
  acumuladoByClass?: Map<string, Map<string, number>>;
  /**
   * Saldo acumulado sob demanda (D−C), para QUALQUER período — inclusive
   * os que não têm movimento. O mapa acima só cobre períodos com
   * movimento; devolver 0 fora deles zerava todo o Balanço num período
   * sem lançamento, em vez de mostrar a abertura.
   * Devolve `null` quando a classificação não é conhecida.
   */
  saldoAcumuladoDC?: (classificacao: string, periodo: string) => number | null;
  /** Saldos indexados pelo código reduzido (não pela classificação). */
  saldosPorCodigo?: Map<string, Map<string, SaldoRow>>;
}): EngineContext {
  const mascara = input.mascara ?? MASCARA_DEFAULT;
  const planoByClass = new Map<string, PlanoRowEng>();
  const planoByCodigo = new Map<string, PlanoRowEng>();
  for (const p of input.plano) {
    planoByClass.set(p.classificacao, p);
    if (p.codigo) planoByCodigo.set(p.codigo, p);
  }

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
    planoByCodigo,
    saldoKeyToClass: new Map(),
    saldosByClass,
    saldosByCodigo: input.saldosPorCodigo ?? new Map(),
    acumuladoByClass: input.acumuladoByClass,
    saldoAcumuladoDC: input.saldoAcumuladoDC,
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
  saldosMapOverride?: Map<string, SaldoRow>,
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

  const saldosMap = saldosMapOverride ?? ctx.saldosByClass.get(classificacao);

  const signMov = (s: SaldoRow) =>
    natureza === "C"
      ? Number(s.total_creditos) - Number(s.total_debitos)
      : Number(s.total_debitos) - Number(s.total_creditos);

  if (isPatrimonial) {
    // Caminho novo: o saldo já vem acumulado pelo MESMO acumulador do
    // Balanço (abertura + movimento posterior à data dela). É o que
    // impede a abertura de ser somada duas vezes.
    const sob = ctx.saldoAcumuladoDC?.(classificacao, periodo);
    if (sob != null) return natureza === "C" ? -sob : sob;

    // Sem o acumulado (contas gerenciais virtuais, chamadas antigas):
    // abertura + movimento até o período.
    //
    // O saldo de abertura é gravado na convenção D−C (`saldoPadronizado`):
    // conta credora entra NEGATIVA. O movimento logo abaixo já é ajustado
    // pela natureza, mas a abertura vinha crua — misturando as duas
    // convenções na mesma soma. Efeito: todo indicador do lado do passivo
    // saía com o sinal trocado (Passivo Circulante -90.000), e liquidez /
    // endividamento davam números sem sentido.
    const aberturaRaw = Number(ctx.aberturas.get(classificacao) ?? 0) || 0;
    const abertura = natureza === "C" ? -aberturaRaw : aberturaRaw;
    let acum = abertura;
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
    total += s * valorRef(contas[i], periodo, ctx);
  }
  return total;
}

/** Soma movimento DRE (crédito − débito) das analíticas sob `classificacao`. */
function movimentoDreSob(
  classificacao: string,
  periodo: string,
  ctx: EngineContext,
): number {
  let total = 0;
  const vistos = new Set<string>();
  for (const p of ctx.plano) {
    if (p.is_sintetica) continue;
    if (vistos.has(p.classificacao)) continue;
    vistos.add(p.classificacao);
    if (
      p.classificacao !== classificacao &&
      !descendeDe(p.classificacao, classificacao, ctx.mascara)
    )
      continue;
    const saldos = ctx.saldosByClass.get(p.classificacao);
    if (!saldos) continue;
    const s = saldos.get(periodo) ?? [...saldos.entries()].find(([k]) => k.startsWith(periodo.slice(0, 7)))?.[1];
    if (!s) continue;
    total += Number(s.total_creditos) - Number(s.total_debitos);
  }
  return total;
}

function movimentoDreCorridoAte(
  limite: string,
  periodo: string,
  ctx: EngineContext,
): number {
  const raiz = dividir(limite, ctx.mascara)[0];
  let total = 0;
  const vistos = new Set<string>();
  for (const p of ctx.plano) {
    if (p.is_sintetica) continue;
    if (vistos.has(p.classificacao)) continue;
    vistos.add(p.classificacao);
    if (dividir(p.classificacao, ctx.mascara)[0] !== raiz) continue;
    const segs = dividir(p.classificacao, ctx.mascara);
    if (segs.slice(1).some((x) => x === "98" || x === "99")) continue;
    if (compararClassificacao(p.classificacao, limite) >= 0) continue;
    const saldos = ctx.saldosByClass.get(p.classificacao);
    if (!saldos) continue;
    const s = saldos.get(periodo) ?? [...saldos.entries()].find(([k]) => k.startsWith(periodo.slice(0, 7)))?.[1];
    if (!s) continue;
    total += Number(s.total_creditos) - Number(s.total_debitos);
  }
  return total;
}

/**
 * Contas .98/.99 da DRE (Resultado Operacional, Lucro Bruto, CPV…) não
 * recebem lançamento. O valor é o subtotal da demonstração: corrido
 * (tudo até ali) ou bloco (só o pai), igual à DRE.
 */
function valorAcumuladorDre(
  classificacao: string,
  periodo: string,
  ctx: EngineContext,
): number | null {
  const g = grupoDe(classificacao, ctx.mascara);
  if (g !== "receita" && g !== "despesa" && g !== "resultado") return null;
  const segs = dividir(classificacao, ctx.mascara);
  const ehApur = segs.slice(1).some((x) => x === "98" || x === "99");
  const est = getEstruturaPadraoSync() ?? [];
  const def = est.find((e) => e.classificacao === classificacao && e.demonstracao === "DRE")
    ?? est.find((e) => e.classificacao === classificacao);
  let tipo = def?.tipo_linha;
  if (tipo === "tag") return null;
  if (tipo === "detalhe" && ehApur) tipo = "bloco";
  if (!tipo && !ehApur) return null;
  if (!tipo) {
    const folhas = expandirContas(classificacao, ctx.plano, ctx.mascara);
    tipo = folhas.length === 0 ? "corrido" : "bloco";
  }
  if (tipo === "corrido") return movimentoDreCorridoAte(classificacao, periodo, ctx);
  if (tipo === "bloco") {
    return movimentoDreSob(paiClassificacao(classificacao, ctx.mascara), periodo, ctx);
  }
  return null;
}

function paiClassificacao(classificacao: string, mascara: MascaraConfig): string {
  const segs = dividir(classificacao, mascara);
  if (segs.length <= 1) return classificacao;
  return segs.slice(0, -1).join(mascara.separador || ".");
}

/** Resolução por código reduzido (preferido) ou classificação (fórmulas antigas). */
function valorRef(ref: string, periodo: string, ctx: EngineContext): number {
  const p = ctx.planoByCodigo.get(ref) ?? ctx.planoByClass.get(ref);
  const cls = p?.classificacao ?? ref;
  const acum = valorAcumuladorDre(cls, periodo, ctx);
  if (acum != null) return acum;
  if (p?.codigo) {
    if (p.is_sintetica === true) return valorConta(p.classificacao, periodo, ctx);
    const porCod = ctx.saldosByCodigo.get(p.codigo);
    if (porCod) return valorContaAnalitica(p.classificacao, periodo, ctx, porCod);
    return valorContaAnalitica(p.classificacao, periodo, ctx);
  }
  return valorConta(ref, periodo, ctx);
}

/**
 * Resolver injetável para termos com `origem: "demonstracao"`.
 * (linha, periodo) => valor | null. Injetado para evitar dependência
 * circular entre engine e o catálogo de linhas.
 */
export type ResolverLinha = (linha: string, periodo: string) => number | null;
export type ResolverConta = (
  contas: string[],
  sinais: ("+" | "-")[] | undefined,
  periodo: string,
) => number;

export function avaliarExpressao(
  tokens: Token[],
  periodo: string,
  ctx: EngineContext,
  resolverLinha?: ResolverLinha,
  resolverConta?: ResolverConta,
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
      const origem: "demonstracao" | "conta" =
        t.origem === "demonstracao" || !!t.linha ? "demonstracao" : "conta";
      if (origem === "demonstracao") {
        if (!t.linha || !resolverLinha) return null;
        const v = resolverLinha(t.linha, periodo);
        if (v == null) return null;
        rpn.push(v);
      } else {
        rpn.push(
          resolverConta
            ? resolverConta(t.contas ?? [], t.sinais, periodo)
            : valorTermo(t.contas ?? [], t.sinais, periodo, ctx),
        );
      }
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

export function valoresTermosFormula(
  tokens: Token[],
  periodo: string,
  ctx: EngineContext,
  resolverLinha?: ResolverLinha,
  labelDaLinha?: (key: string) => string,
): { label: string; valor: number | null; origem: string }[] {
  const out: { label: string; valor: number | null; origem: string }[] = [];
  for (const t of tokens) {
    if (t.tipo !== "termo") continue;
    const keyLinha = t.linha ?? "";
    const origem: "demonstracao" | "conta" =
      t.origem === "demonstracao" || !!keyLinha ? "demonstracao" : "conta";
    if (origem === "demonstracao") {
      const key = keyLinha;
      out.push({
        label: labelDaLinha ? (labelDaLinha(key) || key) : key,
        valor: key && resolverLinha ? resolverLinha(key, periodo) : null,
        origem,
      });
    } else {
      const contas = t.contas ?? [];
      out.push({
        label: contas.join(" + ") || "(sem contas)",
        valor: contas.length > 0 ? valorTermo(contas, t.sinais, periodo, ctx) : null,
        origem,
      });
    }
  }
  return out;
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
  resolverLinha?: ResolverLinha,
): SeriePonto[] {
  return periodos.map((p) => ({
    periodo: p,
    valor: avaliarExpressao(tokensDaFormula(ind.formula), p, ctx, resolverLinha),
  }));
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
  labelDaLinha?: (linhaKey: string) => string,
): string {
  const parts: string[] = [];
  const tokens = tokensDaFormula(formula);
  for (const t of tokens) {
    if (t.tipo === "parentese") parts.push(t.valor);
    else if (t.tipo === "operador") {
      const map: Record<string, string> = { "+": "+", "-": "−", "*": "×", "/": "÷" };
      parts.push(map[t.valor] ?? t.valor);
    } else if (t.tipo === "constante") parts.push(String(t.valor));
    else {
      const origem: "demonstracao" | "conta" =
        t.origem === "demonstracao" || !!t.linha ? "demonstracao" : "conta";
      if (origem === "demonstracao") {
        const key = t.linha ?? "";
        const label = labelDaLinha ? labelDaLinha(key) : key;
        parts.push(`[${label || "?"}]`);
      } else {
        const contas = t.contas ?? [];
        const inside = contas
          .map((c, i) => `${t.sinais?.[i] === "-" ? "− " : i > 0 ? "+ " : ""}[${labelDaConta(c) || c}]`)
          .join(" ");
        parts.push(contas.length > 1 ? `(${inside})` : inside);
      }
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

// ------------------------------------------------------------
// Cálculo com base alternativa (RB/RL)
// ------------------------------------------------------------

export const LINHA_RECEITA_BRUTA = "RECEITA_BRUTA";
export const LINHA_RECEITA_LIQUIDA = "RECEITA_LIQUIDA";

/**
 * Troca RECEITA_BRUTA ↔ RECEITA_LIQUIDA nos termos da fórmula.
 * Indicadores que não usam nenhuma das duas ficam iguais.
 */
export function tokensComBaseReceita(
  tokens: Token[],
  base: "rb" | "rl" | undefined,
): Token[] {
  if (!base) return tokens;
  const alvo = base === "rb" ? LINHA_RECEITA_BRUTA : LINHA_RECEITA_LIQUIDA;
  const origem = base === "rb" ? LINHA_RECEITA_LIQUIDA : LINHA_RECEITA_BRUTA;
  return tokens.map((t) => {
    if (t.tipo !== "termo") return t;
    if (t.linha !== origem) return t;
    return { ...t, origem: "demonstracao" as const, linha: alvo };
  });
}

/**
 * Recalcula o indicador com RB ou RL no lugar do outro, quando a fórmula
 * usa uma dessas partidas (margem, giro, prazos…). Não divide o resultado
 * inteiro — só substitui o termo.
 */
export function calcularSerieComBase(
  ind: IndicadorEmpresa,
  periodos: string[],
  ctx: EngineContext,
  resolverLinha: ResolverLinha,
  base: "padrao" | "rb" | "rl" = "padrao",
): SeriePonto[] {
  if (base === "padrao") return calcularSerie(ind, periodos, ctx, resolverLinha);
  const tokens = tokensComBaseReceita(tokensDaFormula(ind.formula), base);
  return periodos.map((p) => ({
    periodo: p,
    valor: avaliarExpressao(tokens, p, ctx, resolverLinha),
  }));
}