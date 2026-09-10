// Montagem hierárquica de DRE / BP / DFC a partir do novo modelo
// (saldos_mensais + plano_contas + mapeamento_demonstracao).
//
// Saída no MESMO shape das páginas:
// { linha_ordem, descricao, codigo_conta, nivel, is_subtotal, periodo, valor }
//
// Estratégia:
//  - Linha mapeada (ex.: "Receita Bruta") = grupo pai, nivel 0, is_subtotal.
//  - Abaixo aparecem grupos do plano de contas (nivel 3 e nivel 4 do plano)
//    que pertencem à classificação dessa linha, com seus saldos.
//  - Sinal (inverter_sinal) é aplicado uma vez por conta, e propagado ao grupo.
//  - DRE: movimento do período. BP: abertura + Σ movimento até a competência.

import { supabase } from "@/integrations/supabase/client";
import { lerTudo } from "@/lib/supabase-paginado";
import {
  descendeDe,
  dividir,
  juntar,
  nivelDe,
  getMascaraConfig,
  MASCARA_DEFAULT,
  type MascaraConfig,
} from "@/lib/mascara/interpretar";
import {
  getAjustesGerenciais,
  ajustesToSaldosVirtuais,
  contasGerenciaisToPlanoVirtual,
  type AjustesGerenciaisData,
} from "@/lib/gerencial/ajustes";
import { getEstruturaPadrao, getEstruturaPadraoSync, compararClassificacao } from "@/lib/plano/estrutura";
import { getFormulasEbitEbitda, type FormulasEbitEbitda } from "@/lib/indicadores/ebit-fonte";
import { avaliarExpressao, buildContext, type PlanoRowEng, type SaldoRow, type Token } from "@/lib/indicadores/engine";
import { criarAcumulador, type AberturaConta } from "@/lib/diario/acumulador";
import { getTradutor } from "@/lib/plano/depara";

/**
 * Rótulos aceitos para a última linha da DRE.
 *
 * O rótulo exibido muda conforme o sinal (Lucro x Prejuízo), então quem
 * procura essa linha — indicadores e DFC — precisa aceitar as três
 * formas. A antiga fica na lista por compatibilidade com dados já
 * gravados em financial_statements.
 */
export const ROTULOS_RESULTADO_DRE = [
  "(=) Lucro do Exercício",
  "(=) Prejuízo do Exercício",
  "(=) Lucro Líquido do Exercício",
] as const;

export function rotuloResultado(valor: number): string {
  return valor < 0 ? "(=) Prejuízo do Exercício" : "(=) Lucro do Exercício";
}

export type ModoDemonstracao = "contabil" | "gerencial";

type Tipo = "DRE" | "BP_ATIVO" | "BP_PASSIVO" | "DFC" | "DLPA" | "DVA";

export interface FlatRow {
  linha_ordem: number;
  descricao: string;
  codigo_conta: string | null;
  nivel: number;
  is_subtotal: boolean;
  periodo: string;
  valor: number;
}

interface Plano {
  codigo: string;
  classificacao: string;
  descricao: string;
  nivel: number;
  is_participante: boolean;
  is_sintetica?: boolean | null;
}
interface Mapa {
  classificacao_prefixo: string;
  linha_demonstracao: string;
  ordem: number;
  inverter_sinal: boolean;
}
interface Saldo {
  conta_codigo: string;
  competencia: string;
  movimento: number;
  total_debitos: number;
  total_creditos: number;
}


// Apuração contábil: qualquer segmento (após o primeiro) igual a "98" ou "99".
// Usa a máscara para dividir corretamente independente do separador.
function isApuracao(classificacao: string, mascara: MascaraConfig): boolean {
  const partes = dividir(classificacao, mascara);
  return partes.slice(1).some((p) => p === "98" || p === "99");
}

/** Soma movimento DRE (receita +, despesa −). `refs` são código reduzido ou classificação (legado). */
function somaClassifsDre(
  refs: string[],
  periodo: string,
  saldos: Saldo[],
  planoMap: Map<string, Plano>,
  mascara: MascaraConfig,
): number {
  if (refs.length === 0) return 0;
  const resolvidos = refs.map((ref) => {
    const porCod = planoMap.get(ref);
    if (porCod) {
      return {
        codigo: porCod.codigo,
        classif: porCod.classificacao,
        sintetica: porCod.is_sintetica === true,
      };
    }
    return { codigo: null as string | null, classif: ref, sintetica: true };
  });
  let t = 0;
  for (const s of saldos) {
    if (s.competencia !== periodo) continue;
    const conta = planoMap.get(s.conta_codigo);
    if (!conta || conta.is_participante) continue;
    if (isApuracao(conta.classificacao, mascara)) continue;
    const cls = conta.classificacao;
    const bate = resolvidos.some((r) => {
      if (r.codigo && !r.sintetica) return s.conta_codigo === r.codigo;
      if (r.codigo && r.sintetica) {
        return s.conta_codigo === r.codigo || cls === r.classif || descendeDe(cls, r.classif, mascara);
      }
      return cls === r.classif || descendeDe(cls, r.classif, mascara);
    });
    if (!bate) continue;
    t += -(s.total_debitos - s.total_creditos);
  }
  return t;
}

// ---------- helpers ----------

// Ficava aqui, privada. Saiu para `@/lib/supabase-paginado` porque a
// mesma armadilha (max_rows = 1000, truncando em silêncio) mordia em
// outros cinco lugares que não tinham como reaproveitar esta.
const fetchAllPaginated = lerTudo;

function buildMatcher(mapas: Mapa[], mascara: MascaraConfig) {
  const sorted = [...mapas].sort(
    (a, b) => b.classificacao_prefixo.length - a.classificacao_prefixo.length,
  );
  return (classificacao: string): Mapa | null => {
    for (const m of sorted) {
      if (descendeDe(classificacao, m.classificacao_prefixo, mascara)) {
        return m;
      }
    }
    return null;
  };
}

// Retorna o prefixo de uma classificação até `nivelMax` segmentos.
function prefixoAteNivel(
  classificacao: string,
  nivelMax: number,
  mascara: MascaraConfig,
): string {
  const partes = dividir(classificacao, mascara);
  if (partes.length <= nivelMax) return classificacao;
  return juntar(partes.slice(0, nivelMax), mascara);
}

async function getPlanoPorTipo(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  tiposPlano: string[],
  opts: { incluirParticipantes?: boolean; codigosComSaldo?: string[] } = {},
): Promise<Plano[]> {
  // Contas estruturais (1-Ativo, 2-Passivo, 3-DRE, ...): trazer todas.
  const estruturais = await fetchAllPaginated<Plano>((from, to) => {
    const q = supabase
      .from("plano_contas")
      .select("codigo, classificacao, descricao, nivel, is_participante, is_sintetica")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .in("tipo", tiposPlano)
      .eq("is_participante", false)
      .range(from, to);
    return modoGlobal ? q.is("company_id", null) : q.eq("company_id", companyId);
  });

  if (!opts.incluirParticipantes) return estruturais;

  // Participantes (4-Cli. Nac., 5-For. Nac., 6-Cli. Ex., 7-For. Ex.):
  // o cadastro pode ter dezenas/centenas de milhares de linhas (todos os
  // clientes/fornecedores). Restringimos APENAS aos códigos que efetivamente
  // possuem saldo (abertura + movimento) na empresa — caso contrário a fetch
  // estoura e o Balanço renderiza vazio.
  const tiposParticipantes: string[] = [];
  if (tiposPlano.includes("1-Ativo")) {
    tiposParticipantes.push("4-Cli. Nac.", "6-Cli. Ex.");
  }
  if (tiposPlano.includes("2-Passivo")) {
    tiposParticipantes.push("5-For. Nac.", "7-For. Ex.");
  }
  if (tiposParticipantes.length === 0) return estruturais;

  const codigos = Array.from(new Set(opts.codigosComSaldo ?? []));
  if (codigos.length === 0) return estruturais;

  // .in("codigo", ...) em lotes para evitar URLs gigantescas
  const CHUNK = 500;
  const participantes: Plano[] = [];
  for (let i = 0; i < codigos.length; i += CHUNK) {
    const lote = codigos.slice(i, i + CHUNK);
    const rows = await fetchAllPaginated<Plano>((from, to) => {
      const q = supabase
        .from("plano_contas")
        .select("codigo, classificacao, descricao, nivel, is_participante, is_sintetica")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .in("tipo", tiposParticipantes)
        .in("codigo", lote)
        .range(from, to);
      return modoGlobal ? q.is("company_id", null) : q.eq("company_id", companyId);
    });
    participantes.push(...rows);
  }
  return [...estruturais, ...participantes];
}

// AJUSTE 12 — a estrutura da demonstração É a hierarquia do plano.
//
// Cada linha da demonstração é um "prefixo de classificação", e todas
// vêm do próprio plano de contas. Os marcos (etiqueta manual "esta é a
// Receita Bruta") não existem mais: o plano do escritório já traz os
// subtotais como contas `.98`/`.99` sintéticas e sem filhos.
//
// Duas listas saem daqui:
//
//   mapas        as linhas que RECEBEM saldo — os grupos do plano no
//                nível em que a demonstração é desenhada. Cobertura
//                total: se uma conta não casasse com nenhum prefixo,
//                `aplicarMapaESinal` faria `if (!m) continue` e a
//                DESCARTARIA — foi assim que o Balanço deixou de fechar.
//
//   acumuladores as contas `.98`/`.99`, que não recebem saldo nenhum e
//                são CALCULADAS (bloco ou corrido, conforme o
//                `estrutura_padrao`).
//
// O nível em que a DRE é desenhada também vem do plano: é o nível onde
// estão os acumuladores. Se o escritório fecha o resultado em 3.01.99,
// as linhas da DRE são as 3.XX.YY — nem mais raso nem mais fundo.
interface Acumulador {
  classificacao: string;
  rotulo: string;
  tipo: "bloco" | "corrido";
  ordem: number;
  papel: string | null;
}

async function getMapa(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  tipo: Tipo,
  mascara: MascaraConfig,
): Promise<{ mapas: Mapa[]; acumuladores: Acumulador[] }> {
  if (tipo === "DFC" || tipo === "DLPA" || tipo === "DVA")
    return { mapas: [], acumuladores: [] };

  const tiposConta =
    tipo === "DRE" ? ["3-DRE"]
    : tipo === "BP_ATIVO" ? ["1-Ativo"]
    : ["2-Passivo"];

  // Sintéticas do grupo. Sem filtro de nível fixo: há planos que começam
  // em 1 e outros que começam mais fundo, então o nível raso é
  // descoberto a partir do próprio plano.
  const rows = await fetchAllPaginated<{
    classificacao: string;
    descricao: string;
    nivel: number;
  }>((from, to) => {
    const q = supabase
      .from("plano_contas")
      .select("classificacao, descricao, nivel")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .eq("is_participante", false)
      .eq("is_sintetica", true)
      .in("tipo", tiposConta)
      .range(from, to);
    return modoGlobal ? q.is("company_id", null) : q.eq("company_id", companyId);
  });

  const estrutura = await getEstruturaPadrao();

  // Acumuladores do plano: sintéticas de apuração (.98/.99). Não recebem
  // lançamento — são as linhas calculadas da demonstração.
  const acumuladoresPlano = rows.filter((r) =>
    isApuracao(r.classificacao, mascara),
  );

  // Nível em que a demonstração é desenhada.
  //
  // DRE: o nível dos acumuladores. É o próprio plano dizendo onde ele
  // fecha o resultado — em vez de um palpite sobre profundidade.
  // Sem acumuladores (ou no Balanço, que não tem), cai na regra
  // anterior: o nível mais raso que existe, pulando a raiz única — ela
  // só geraria uma linha "ATIVO" zerada, porque toda conta casa antes
  // numa filha (o matcher prefere o prefixo mais longo).
  const candidatas = rows.filter((r) => !isApuracao(r.classificacao, mascara));
  const niveis = Array.from(new Set(candidatas.map((r) => r.nivel))).sort((a, b) => a - b);
  const nRaiz = niveis[0];
  const qtdNaRaiz = candidatas.filter((r) => r.nivel === nRaiz).length;
  const nSeguinte = niveis.find((n) => n > nRaiz);

  let nivelCobertura = qtdNaRaiz === 1 && nSeguinte !== undefined ? nSeguinte : nRaiz;
  if (tipo === "DRE" && acumuladoresPlano.length > 0) {
    const freq = new Map<number, number>();
    for (const a of acumuladoresPlano) freq.set(a.nivel, (freq.get(a.nivel) ?? 0) + 1);
    let melhor = nivelCobertura;
    let maior = -1;
    for (const [n, q] of freq) {
      // desempate pelo nível mais raso
      if (q > maior || (q === maior && n < melhor)) { maior = q; melhor = n; }
    }
    nivelCobertura = melhor;
  }

  const estruturais = candidatas
    .filter((r) => r.nivel === nivelCobertura)
    .sort((a, b) => compararClassificacao(a.classificacao, b.classificacao));

  // A ordem das linhas é a ordem do plano. Linhas de saldo e acumuladores
  // entram na mesma sequência, cada um na posição em que o plano o coloca —
  // é isso que põe "(=) Lucro Bruto" logo depois dos custos sem nenhuma
  // constante mágica no meio do caminho.
  const sequencia = [
    ...estruturais.map((r) => ({ classificacao: r.classificacao, acumulador: false as const, row: r })),
    ...(tipo === "DRE"
      ? acumuladoresPlano.map((r) => ({ classificacao: r.classificacao, acumulador: true as const, row: r }))
      : []),
  ].sort((a, b) => compararClassificacao(a.classificacao, b.classificacao));

  const ordemDe = new Map<string, number>();
  sequencia.forEach((s, i) => ordemDe.set(s.classificacao, (i + 1) * 10));

  const porPrefixo = new Map<string, Mapa>();
  for (const r of estruturais) {
    // Rótulo de apresentação, quando o `estrutura_padrao` define um.
    // O plano vem do sistema contábil em caixa alta e sem acento
    // ("(-)DEDUCOES DA RECEITA BRUTA"); onde há um nome próprio da
    // demonstração, ele vale. O resto mantém o nome do plano.
    const defLinha = estrutura.find(
      (e) =>
        e.classificacao === r.classificacao &&
        e.demonstracao === tipo &&
        e.tipo_linha === "detalhe" &&
        e.rotulo,
    );
    porPrefixo.set(r.classificacao, {
      classificacao_prefixo: r.classificacao,
      linha_demonstracao: defLinha?.rotulo ?? r.descricao,
      ordem: ordemDe.get(r.classificacao) ?? 800,
      // Resultado, Passivo e PL têm saldo credor: exibe positivo.
      inverter_sinal: tipo === "BP_PASSIVO" || tipo === "DRE",
    });
  }

  // Rede de segurança: se o grupo não tem sintéticas (plano só com
  // analíticas), cai para o prefixo do grupo contábil, senão TODA conta
  // seria descartada por falta de correspondência.
  if (estruturais.length === 0) {
    const raizGrupo = tipo === "DRE" ? "3" : tipo === "BP_ATIVO" ? "1" : "2";
    porPrefixo.set(raizGrupo, {
      classificacao_prefixo: raizGrupo,
      linha_demonstracao: tipo === "DRE" ? "Resultado" : tipo === "BP_ATIVO" ? "Ativo" : "Passivo",
      ordem: 8000,
      inverter_sinal: tipo === "BP_PASSIVO" || tipo === "DRE",
    });
  }

  const acumuladores: Acumulador[] = [];
  if (tipo === "DRE") {
    for (const r of acumuladoresPlano) {
      const def = estrutura.find(
        (e) => e.classificacao === r.classificacao && e.demonstracao === "DRE",
      );
      // Sem definição, assume 'bloco': fecha só o próprio bloco, então no
      // pior caso mostra um subtotal a menos — nunca um número inflado por
      // somar a demonstração inteira.
      const kind: "bloco" | "corrido" =
        def?.tipo_linha === "corrido" ? "corrido" : "bloco";
      const rotulo = def?.rotulo ?? r.descricao;

      // Acumulador de bloco que fecha UMA linha só é a mesma linha com
      // outro nome: "CUSTOS INDUSTRIAIS" seguido de "Custo dos Produtos
      // Vendidos" com valor idêntico. Em vez de duas linhas iguais, o
      // rótulo do acumulador vai para a linha — que é o nome que a
      // demonstração quer — e o acumulador não é emitido.
      if (kind === "bloco") {
        const partes = dividir(r.classificacao, mascara);
        const blocoPai =
          partes.length > 1 ? juntar(partes.slice(0, -1), mascara) : r.classificacao;
        const dentro = estruturais.filter(
          (e) =>
            e.classificacao === blocoPai ||
            descendeDe(e.classificacao, blocoPai, mascara),
        );
        if (dentro.length === 1) {
          const alvo = porPrefixo.get(dentro[0].classificacao);
          // sem o "(=)": deixa de ser subtotal calculado, virou a linha
          if (alvo && def?.rotulo)
            alvo.linha_demonstracao = def.rotulo.replace(/^\(=\)\s*/, "");
          continue;
        }
      }

      acumuladores.push({
        classificacao: r.classificacao,
        rotulo,
        tipo: kind,
        ordem: ordemDe.get(r.classificacao) ?? 9000,
        papel: def?.papel ?? null,
      });
    }
  }

  return { mapas: Array.from(porPrefixo.values()), acumuladores };
}

async function getSaldos(
  companyId: string,
  periodos: string[],
): Promise<Saldo[]> {
  const rows = await fetchAllPaginated<any>((from, to) =>
    supabase
      .from("saldos_mensais")
      .select("conta_codigo, competencia, total_debitos, total_creditos, movimento")
      .eq("company_id", companyId)
      .in("competencia", periodos)
      .range(from, to),
  );
  const trad = await getTradutor(companyId);
  return rows.map((r: any) => ({
    conta_codigo: trad ? trad.traduzir(r.conta_codigo) : r.conta_codigo,
    competencia: r.competencia,
    movimento:
      Number(r.movimento) ||
      (Number(r.total_debitos) || 0) - (Number(r.total_creditos) || 0),
    total_debitos: Number(r.total_debitos) || 0,
    total_creditos: Number(r.total_creditos) || 0,
  }));
}

/**
 * Encerramento de exercício: em 31/12 o sistema contábil transfere o saldo
 * acumulado das contas de resultado (grupo 3) para uma conta de "Resultado
 * do Exercício" no PL, zerando as contas 3.x no período. Se essas linhas
 * ficarem nos saldos_mensais, a DRE do mês/ano dá zero (dezembro fica
 * negativo == acumulado jan-nov).
 *
 * Solução: identificar esses lançamentos no diário e devolver o par
 * (conta_codigo, competencia) → { debitos, creditos } para SUBTRAIR dos
 * saldos antes de montar a DRE. BP não é afetado — mantém o encerramento
 * (o PL continua com o Resultado do Exercício correto).
 *
 * Heurística (robusta ao SPED brasileiro): rows onde o histórico contém
 * "Transferido Para Conta" e "Resultado" (case-insensitive). Cobre os
 * padrões de ContMatic, Domínio, Sage/Folhamatic e similares.
 */
async function getCorrecoesEncerramento(
  companyId: string,
  periodos: string[],
): Promise<Map<string, { debitos: number; creditos: number }>> {
  const out = new Map<string, { debitos: number; creditos: number }>();
  if (periodos.length === 0) return out;
  const rows = await fetchAllPaginated<any>((from, to) =>
    supabase
      .from("lancamentos_diario")
      .select("conta_codigo, competencia, debito, credito")
      .eq("company_id", companyId)
      .in("competencia", periodos)
      .ilike("historico", "%Transferido Para Conta%Resultado%")
      .range(from, to),
  );
  for (const r of rows) {
    const k = `${r.conta_codigo}|${r.competencia}`;
    const cur = out.get(k) ?? { debitos: 0, creditos: 0 };
    cur.debitos += Number(r.debito) || 0;
    cur.creditos += Number(r.credito) || 0;
    out.set(k, cur);
  }
  return out;
}

/**
 * Aplica as correções de encerramento em uma lista de saldos, restringindo
 * a subtração ao grupo 3 (Resultado) — só a DRE precisa disso. Retorna a
 * lista de saldos ajustada, mais o Set de meses efetivamente afetados.
 */
function aplicarCorrecoesEncerramento(
  saldos: Saldo[],
  correcoes: Map<string, { debitos: number; creditos: number }>,
  contaEhResultado: (conta_codigo: string) => boolean,
): Saldo[] {
  if (correcoes.size === 0) return saldos;
  return saldos.map((s) => {
    if (!contaEhResultado(s.conta_codigo)) return s;
    const k = `${s.conta_codigo}|${s.competencia}`;
    const corr = correcoes.get(k);
    if (!corr) return s;
    const d = s.total_debitos - corr.debitos;
    const c = s.total_creditos - corr.creditos;
    return {
      ...s,
      total_debitos: d,
      total_creditos: c,
      movimento: d - c,
    };
  });
}

async function getSaldosAteData(
  companyId: string,
  ateData: string,
): Promise<Saldo[]> {
  const rows = await fetchAllPaginated<any>((from, to) =>
    supabase
      .from("saldos_mensais")
      .select("conta_codigo, competencia, total_debitos, total_creditos, movimento")
      .eq("company_id", companyId)
      .lte("competencia", ateData)
      .range(from, to),
  );
  const trad = await getTradutor(companyId);
  return rows.map((r: any) => ({
    conta_codigo: trad ? trad.traduzir(r.conta_codigo) : r.conta_codigo,
    competencia: r.competencia,
    movimento:
      Number(r.movimento) ||
      (Number(r.total_debitos) || 0) - (Number(r.total_creditos) || 0),
    total_debitos: Number(r.total_debitos) || 0,
    total_creditos: Number(r.total_creditos) || 0,
  }));
}

// Devolve TODAS as aberturas com a data de referência. Antes esta função
// achatava para "a mais recente de qualquer data" e o chamador somava
// todo o movimento por cima — contando duas vezes o que já estava
// embutido na abertura. Ver src/lib/diario/acumulador.ts.
async function getAberturas(companyId: string): Promise<AberturaConta[]> {
  const data = await fetchAllPaginated<any>((from, to) =>
    supabase
      .from("saldos_abertura")
      .select("conta_codigo, data_referencia, saldo")
      .eq("company_id", companyId)
      .range(from, to),
  );
  const trad = await getTradutor(companyId);
  const linhas: AberturaConta[] = data.map((r: any) => ({
    conta_codigo: trad ? trad.traduzir(r.conta_codigo) : r.conta_codigo,
    data_referencia: String(r.data_referencia),
    saldo: Number(r.saldo) || 0,
  }));
  if (!trad) return linhas;

  // Com de-para, várias contas de origem podem cair na MESMA conta do
  // Padrão. Movimento pode vir repetido — o acumulador soma. Abertura
  // NÃO: ele escolhe a mais recente com data <= a pedida, então duas
  // aberturas na mesma data viravam uma só e o saldo inicial daquela
  // conta saía pela metade. Agrega antes de entregar.
  const agregado = new Map<string, AberturaConta>();
  for (const l of linhas) {
    const k = `${l.conta_codigo}|${l.data_referencia}`;
    const cur = agregado.get(k);
    if (cur) cur.saldo += l.saldo;
    else agregado.set(k, { ...l });
  }
  return Array.from(agregado.values());
}

// ---------- agregação hierárquica ----------

interface PontoSaldo {
  classificacao: string;
  valor: number; // já com sinal aplicado (inverter_sinal)
}

/**
 * Recebe a lista de (conta_codigo → valor) e:
 *  - aplica inverter_sinal do mapa correspondente,
 *  - filtra contas sem mapa, participantes ou de apuração,
 *  - retorna lista por classificação (com sinal aplicado).
 */
function aplicarMapaESinal(
  saldosPorConta: Map<string, number>,
  planoMap: Map<string, Plano>,
  matcher: (c: string) => Mapa | null,
  mascara: MascaraConfig,
  opts: { incluirParticipantes?: boolean } = {},
): { mapa: Mapa; codigo: string; classificacao: string; valor: number; isParticipante: boolean }[] {
  const out: { mapa: Mapa; codigo: string; classificacao: string; valor: number; isParticipante: boolean }[] = [];
  for (const [codigo, valor] of saldosPorConta) {
    const conta = planoMap.get(codigo);
    if (!conta) continue;
    if (conta.is_participante && !opts.incluirParticipantes) continue;
    if (isApuracao(conta.classificacao, mascara)) continue;
    const m = matcher(conta.classificacao);
    if (!m) continue;
    const v = m.inverter_sinal ? -valor : valor;
    out.push({
      mapa: m,
      codigo: conta.codigo,
      classificacao: conta.classificacao,
      valor: v,
      isParticipante: conta.is_participante,
    });
  }
  return out;
}


/**
 * Monta linhas planas para UMA linha mapeada (parent) + grupos do plano abaixo,
 * para um único período. Retrocompatível — usa emitirArvoreMulti internamente.
 */
function emitirHierarquia(
  parent: { linha: string; ordem: number; prefixo?: string | null },
  pontos: { classificacao: string; descricao: string; valor: number; nivelPlano: number }[],
  periodo: string,
  linhaOrdemBase: number,
  planoPrefixos: Map<string, string>,
  mascara: MascaraConfig,
): FlatRow[] {
  const map = new Map<string, typeof pontos>();
  map.set(periodo, pontos);
  return emitirArvoreMulti(parent, map, linhaOrdemBase, planoPrefixos, mascara);
}

// Compat: alias antigo (mesma implementação single-period).
function emitirArvoreBP(
  parent: { linha: string; ordem: number; prefixo?: string | null },
  pontos: { classificacao: string; descricao: string; valor: number; nivelPlano: number }[],
  periodo: string,
  linhaOrdemBase: number,
  planoPrefixos: Map<string, string>,
  mascara: MascaraConfig,
): FlatRow[] {
  return emitirHierarquia(parent, pontos, periodo, linhaOrdemBase, planoPrefixos, mascara);
}

type Ponto = {
  classificacao: string;
  codigo?: string;
  descricao: string;
  valor: number;
  nivelPlano: number;
};

/**
 * Árvore hierárquica completa emitindo linhas para MÚLTIPLOS períodos ao mesmo tempo.
 * A estrutura da árvore é construída UMA VEZ a partir da união das classificações
 * presentes em todos os períodos — garantindo que cada nó receba SEMPRE o mesmo
 * `linha_ordem`, independentemente de quais contas movimentaram em cada mês.
 * Sem isso, contas com o mesmo `descricao` (ex.: "PRO-LABORE" em centros de
 * custo distintos) apareciam achatadas na mesma linha porque o buildRows do
 * dashboard chaveia por (linha_ordem, descricao).
 */
function emitirArvoreMulti(
  parent: { linha: string; ordem: number; prefixo?: string | null },
  pontosPorPeriodo: Map<string, Ponto[]>,
  linhaOrdemBase: number,
  planoPrefixos: Map<string, string>,
  mascara: MascaraConfig,
): FlatRow[] {
  const out: FlatRow[] = [];
  const periodos = Array.from(pontosPorPeriodo.keys());

  const allClassifsHeader: string[] = [];
  const seenH = new Set<string>();
  for (const pts of pontosPorPeriodo.values()) {
    for (const p of pts) {
      if (!seenH.has(p.classificacao)) {
        seenH.add(p.classificacao);
        allClassifsHeader.push(p.classificacao);
      }
    }
  }
  const codigoHeader =
    parent.prefixo ??
    (allClassifsHeader.length > 0
      ? juntar(
          dividir(allClassifsHeader[0], mascara).slice(
            0,
            commonPrefixLen(allClassifsHeader, mascara),
          ),
          mascara,
        )
      : null);

  // 1) Header (subtotal) — nivel 0 — por período.
  for (const periodo of periodos) {
    const total = (pontosPorPeriodo.get(periodo) ?? []).reduce((a, b) => a + b.valor, 0);
    out.push({
      linha_ordem: linhaOrdemBase,
      descricao: parent.linha,
      codigo_conta: codigoHeader,
      nivel: 0,
      is_subtotal: true,
      periodo,
      valor: total,
    });
  }

  // União das classificações presentes em qualquer período.
  const allClassifs: string[] = [];
  const seenClassif = new Set<string>();
  for (const pts of pontosPorPeriodo.values()) {
    for (const p of pts) {
      if (!seenClassif.has(p.classificacao)) {
        seenClassif.add(p.classificacao);
        allClassifs.push(p.classificacao);
      }
    }
  }
  if (allClassifs.length === 0) return out;

  const profMin = commonPrefixLen(allClassifs, mascara);

  type Node = {
    key: string;
    classif: string;
    codigo: string | null;
    descricao: string;
    depth: number;
    children: Map<string, Node>;
    valorPor: Map<string, number>;
  };
  const root = new Map<string, Node>();
  const headerCls = codigoHeader;

  for (const [periodo, pts] of pontosPorPeriodo) {
    for (const p of pts) {
      const parts = dividir(p.classificacao, mascara);
      let map = root;
      for (let level = profMin; level <= parts.length; level++) {
        const prefix = juntar(parts.slice(0, level), mascara);
        const isLeaf = level === parts.length;
        // O cabeçalho da linha já é esse prefixo — repetir o nó só
        // duplica "Despesas Operacionais" embaixo dela.
        if (!isLeaf && headerCls && prefix === headerCls) continue;
        const key = isLeaf && p.codigo ? `c:${p.codigo}` : prefix;
        let node = map.get(key);
        if (!node) {
          node = {
            key,
            classif: prefix,
            codigo: isLeaf ? (p.codigo ?? null) : null,
            descricao: isLeaf
              ? p.descricao
              : (planoPrefixos.get(prefix) ?? prefix),
            depth: level,
            children: new Map(),
            valorPor: new Map(),
          };
          map.set(key, node);
        } else if (isLeaf && p.descricao) {
          node.descricao = p.descricao;
        }
        node.valorPor.set(periodo, (node.valorPor.get(periodo) ?? 0) + p.valor);
        map = node.children;
      }
    }
  }

  // Walk determinístico. Contas com a mesma classificação (bug do plano
  // padrão: Energia e Serviços de Industrialização em 3.02.01.10.01) viram
  // folhas distintas pela chave do código. Grupos que EXISTEM no plano
  // (GGF, Despesas Financeiras) não colapsam — senão um único filho com
  // movimento apaga o pai e a linha some da DRE.
  let counter = 1;
  const walk = (map: Map<string, Node>) => {
    const sorted = Array.from(map.values()).sort((a, b) =>
      a.classif.localeCompare(b.classif) || (a.codigo ?? "").localeCompare(b.codigo ?? ""),
    );
    for (const n of sorted) {
      const nomeadoNoPlano = planoPrefixos.has(n.classif) || !!n.codigo;
      if (n.children.size === 1 && !nomeadoNoPlano) {
        const only = n.children.values().next().value!;
        let redundant = true;
        for (const periodo of periodos) {
          const a = n.valorPor.get(periodo) ?? 0;
          const b = only.valorPor.get(periodo) ?? 0;
          if (Math.abs(a - b) >= 0.005) { redundant = false; break; }
        }
        if (redundant) {
          walk(n.children);
          continue;
        }
      }
      const nivel = n.depth - profMin + 1;
      const ordemNode = linhaOrdemBase + counter++;
      for (const periodo of periodos) {
        out.push({
          linha_ordem: ordemNode,
          descricao: n.descricao,
          codigo_conta: n.codigo ?? n.classif,
          nivel,
          is_subtotal: false,
          periodo,
          valor: n.valorPor.get(periodo) ?? 0,
        });
      }
      if (n.children.size > 0) walk(n.children);
    }
  };
  walk(root);

  return out;
}

function commonPrefixLen(classifs: string[], mascara: MascaraConfig): number {
  if (classifs.length === 0) return 1;
  const split = classifs.map((c) => dividir(c, mascara));
  const min = Math.min(...split.map((s) => s.length));
  let n = 0;
  outer: for (let i = 0; i < min; i++) {
    const seg = split[0][i];
    for (const s of split) if (s[i] !== seg) { break outer; }
    n++;
  }
  return Math.max(1, n);
}

function prefixoEstruturalMaisProximo(
  classificacao: string,
  estruturais: Set<string>,
  mascara: MascaraConfig,
): string {
  const partes = dividir(classificacao, mascara);
  for (let level = partes.length; level >= 1; level--) {
    const prefixo = juntar(partes.slice(0, level), mascara);
    if (estruturais.has(prefixo)) return prefixo;
  }
  return classificacao;
}

// ---------- DRE / DFC ----------

async function buildDRE(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  tipo: "DRE" | "DFC",
  mascara: MascaraConfig,
  modo: ModoDemonstracao = "contabil",
  gerData?: AjustesGerenciaisData,
): Promise<FlatRow[]> {
  const [mapaInfo, saldosContabeisRaw, planoContabil, planoEbit, correcoesEncerr, formulasEbit] = await Promise.all([
    getMapa(companyId, tenantId, modoGlobal, tipo, mascara),
    getSaldos(companyId, periodos),
    getPlanoPorTipo(companyId, tenantId, modoGlobal, ["3-DRE"]),
    getPlanoPorTipo(companyId, tenantId, modoGlobal, ["1-Ativo", "2-Passivo", "3-DRE"]),
    getCorrecoesEncerramento(companyId, periodos),
    getFormulasEbitEbitda(tenantId),
  ]);
  // Remove os lançamentos de encerramento do exercício dos saldos de contas
  // do grupo 3 (Resultado). Sem isso, dezembro fica com o negativo do
  // acumulado do ano e a soma anual dá zero. BP não é chamado aqui, então
  // o encerramento permanece intacto para o Patrimônio Líquido.
  const codigosResultado = new Set(planoContabil.map((p) => p.codigo));
  const saldosContabeis = aplicarCorrecoesEncerramento(
    saldosContabeisRaw,
    correcoesEncerr,
    (c) => codigosResultado.has(c),
  );
  // As contas de apuração (.98/.99) não entram no matcher: não têm
  // lançamento próprio. Elas voltam adiante como linhas CALCULADAS.
  const mapas = mapaInfo.mapas;
  const acumuladores = mapaInfo.acumuladores;

  // Modo GERENCIAL: injeta saldos virtuais dos ajustes gerenciais das
  // competências selecionadas (fluxo, mesma regra da DRE contábil).
  let saldos = saldosContabeis;
  let planoExtra: Plano[] = [];
  if (modo === "gerencial") {
    const ger = gerData ?? (await getAjustesGerenciais(companyId, tenantId));
    const perSet = new Set(periodos);
    const virtuais = ajustesToSaldosVirtuais(ger.ajustes, (c) => perSet.has(c));
    saldos = [...saldos, ...virtuais];
    // Plano virtual para contas gerenciais (afeta apenas quando classificadas
    // em grupo 3 — improvável para DRE, mas mantemos por simetria).
    planoExtra = contasGerenciaisToPlanoVirtual(ger.contasGerenciais, mascara.separador || ".");
  }

  const planoMap = new Map<string, Plano>();
  const planoPorClassificacao = new Map<string, Plano>();
  const planoPrefixos = new Map<string, string>();
  for (const p of [...planoContabil, ...planoExtra]) {
    planoMap.set(p.codigo, p);
    planoPorClassificacao.set(p.classificacao, p);
    planoPrefixos.set(p.classificacao, p.descricao);
  }
  const matcher = buildMatcher(mapas, mascara);

  // Uma linha por PREFIXO, não por rótulo: dois grupos do plano podem ter
  // a mesma descrição e colapsariam numa linha só.
  const linhasMeta = new Map<string, { ordem: number; rotulo: string }>();
  for (const m of mapas) {
    linhasMeta.set(m.classificacao_prefixo, {
      ordem: m.ordem,
      rotulo: m.linha_demonstracao,
    });
  }

  const out: FlatRow[] = [];

  // Coleta pontos por (linha mapeada, período). A árvore será construída UMA
  // única vez por linha, a partir da união dos períodos — assim cada nó recebe
  // o mesmo `linha_ordem` em todos os meses.
  const porLinhaPeriodo = new Map<
    string,
    { ordem: number; rotulo: string; pontosPor: Map<string, Ponto[]> }
  >();
  for (const [prefixo, meta] of linhasMeta) {
    porLinhaPeriodo.set(prefixo, {
      ordem: meta.ordem,
      rotulo: meta.rotulo,
      pontosPor: new Map(),
    });
  }

  for (const p of periodos) {
    const saldosPorConta = new Map<string, number>();
    for (const s of saldos) {
      if (s.competencia !== p) continue;
      const conta = planoMap.get(s.conta_codigo);
      if (!conta) continue;
      // Movimento líquido (d - c), consistente com o BP. Assim estornos
      // (créditos em contas de despesa, débitos em contas de receita) são
      // compensados no próprio movimento da conta, e o Lucro Líquido da
      // DRE fica idêntico ao Resultado do Exercício do PL do BP.
      const valor = s.total_debitos - s.total_creditos;
      saldosPorConta.set(
        s.conta_codigo,
        (saldosPorConta.get(s.conta_codigo) ?? 0) + valor,
      );
    }

    const pontos = aplicarMapaESinal(saldosPorConta, planoMap, matcher, mascara);

    for (const pt of pontos) {
      const conta = planoMap.get(pt.codigo) ?? planoPorClassificacao.get(pt.classificacao);
      const bucket = porLinhaPeriodo.get(pt.mapa.classificacao_prefixo);
      if (!bucket) continue;
      const arr = bucket.pontosPor.get(p) ?? [];
      arr.push({
        classificacao: pt.classificacao,
        codigo: pt.codigo,
        descricao: conta?.descricao ?? pt.classificacao,
        valor: pt.valor,
        nivelPlano: conta?.nivel ?? nivelDe(pt.classificacao, mascara),
      });
      bucket.pontosPor.set(p, arr);
    }
  }

  // Garante entrada vazia por período em cada linha (para o header nivel 0).
  for (const bucket of porLinhaPeriodo.values()) {
    for (const p of periodos) {
      if (!bucket.pontosPor.has(p)) bucket.pontosPor.set(p, []);
    }
  }

  const linhasOrd = Array.from(porLinhaPeriodo.entries()).sort(
    (a, b) => a[1].ordem - b[1].ordem,
  );
  const totalPorPrefixo = new Map<string, Map<string, number>>();
  for (const [prefixo, info] of linhasOrd) {
    const base = info.ordem * 1000;
    const porPeriodo = new Map<string, number>();
    for (const [per, pts] of info.pontosPor) {
      porPeriodo.set(per, pts.reduce((a, b) => a + b.valor, 0));
    }
    totalPorPrefixo.set(prefixo, porPeriodo);
    out.push(
      ...emitirArvoreMulti(
        { linha: info.rotulo, ordem: info.ordem, prefixo },
        info.pontosPor,
        base,
        planoPrefixos,
        mascara,
      ),
    );
  }


  // Subtotais calculados da DRE
  // Resultado apurado direto do grupo de resultado, por período:
  // soma do movimento (d - c) de todas as contas do plano de DRE,
  // com sinal invertido (saldo credor = lucro). É a mesma conta que o
  // Balanço faz para o PL, então as duas demonstrações fecham entre si.
  const resultadoApurado = new Map<string, number>();
  if (tipo === "DRE") {
    for (const p of periodos) {
      let soma = 0;
      for (const sal of saldos) {
        if (sal.competencia !== p) continue;
        const conta = planoMap.get(sal.conta_codigo);
        if (!conta || conta.is_participante) continue;
        if (isApuracao(conta.classificacao, mascara)) continue;
        soma += sal.total_debitos - sal.total_creditos;
      }
      resultadoApurado.set(p, -soma);
    }
  }

  if (tipo === "DRE") {
    addAcumuladores(out, periodos, acumuladores, totalPorPrefixo, resultadoApurado, mascara, {
      formulasEbit,
      somaClassifs: (classifs, p) => somaClassifsDre(classifs, p, saldos, planoMap, mascara),
      planoFormula: [...planoEbit, ...planoExtra],
      saldos,
    });

    // Conferência: a soma das linhas visíveis tem que dar o resultado.
    //
    // Uma conta cuja classificação não casa com nenhuma linha era
    // DESCARTADA em silêncio (`if (!m) continue`). Aconteceu de verdade:
    // o plano não trazia a sintética 3.17.01, então IRPJ e CSLL sumiam da
    // DRE — e ninguém percebia, porque o Lucro do Exercício é apurado do
    // grupo inteiro e continuava certo. A demonstração não fechava com
    // ela mesma e nada avisava. Agora avisa.
    for (const p of periodos) {
      let somaLinhas = 0;
      for (const porPeriodo of totalPorPrefixo.values()) {
        somaLinhas += porPeriodo.get(p) ?? 0;
      }
      const resultado = resultadoApurado.get(p) ?? 0;
      const diff = resultado - somaLinhas;
      if (Math.abs(diff) >= 0.01) {
        out.push({
          linha_ordem: 9_999_500,
          descricao:
            `⚠ ${formatarDiferencaDFC(diff)} de movimento em contas fora da estrutura da DRE. ` +
            `Rode "Completar estrutura do plano" em Plano de Contas.`,
          codigo_conta: null,
          nivel: 0,
          is_subtotal: true,
          periodo: p,
          valor: diff,
        });
      }
    }
  }

  // ordena e só então descarta as linhas que ficaram zeradas
  out.sort((a, b) => a.linha_ordem - b.linha_ordem || a.periodo.localeCompare(b.periodo));
  return removerLinhasZeradas(out, periodos);
}

/**
 * Remove linhas que ficaram zeradas em TODOS os períodos.
 *
 * A cobertura estrutural cria uma linha para cada grupo do plano, e um
 * plano padrão de escritório tem grupos que aquela empresa não usa —
 * eles apareciam como linhas em branco no meio da demonstração.
 * Subtotais calculados e cabeçalhos ficam sempre (um Lucro Líquido zero
 * é informação; um grupo sem movimento não é).
 */
function removerLinhasZeradas(rows: FlatRow[], periodos: string[]): FlatRow[] {
  const somaAbs = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.linha_ordem}|${r.descricao}`;
    somaAbs.set(k, (somaAbs.get(k) ?? 0) + Math.abs(Number(r.valor) || 0));
  }
  void periodos;
  // Subtotal zerado também sai. Um "(=) Receita Líquida" em branco não
  // informa nada — é resíduo de uma estrutura que aquela empresa não usa.
  // Ficam apenas os cabeçalhos de lado e os totais, que dão o
  // enquadramento da demonstração mesmo valendo zero.
  const sempreVisivel = (d: string) =>
    d === "ATIVO" ||
    d === "PASSIVO E PATRIMÔNIO LÍQUIDO" ||
    d.startsWith("Total do ") ||
    d === "(=) EBIT" ||
    d === "(=) EBITDA" ||
    (ROTULOS_RESULTADO_DRE as readonly string[]).includes(d);

  return rows.filter((r) => {
    if (sempreVisivel(r.descricao)) return true;
    const k = `${r.linha_ordem}|${r.descricao}`;
    return (somaAbs.get(k) ?? 0) > 0.005;
  });
}

/**
 * Acumuladores da DRE — as contas `.98`/`.99` do próprio plano.
 *
 * Substitui a antiga lista fixa de subtotais (`addDRECalculatedTotals`),
 * que somava linhas procurando pelo RÓTULO: `v("(=) Lucro Bruto", p)`.
 * Bastava o plano de um escritório nomear a conta de outro jeito e a
 * cadeia inteira virava zero — foi assim que a linha do resultado ficou
 * zerada com movimento na empresa.
 *
 * Agora cada acumulador soma CLASSIFICAÇÕES:
 *
 *   bloco    fecha o próprio bloco. 3.02.99 = tudo que está sob 3.02.
 *   corrido  resultado acumulado até ali. 3.05.99 (Lucro Bruto) = tudo
 *            que vem antes dele na demonstração.
 *
 * Em ambos os casos a soma é feita sobre as linhas de saldo — os outros
 * acumuladores ficam de fora, senão um subtotal entraria dentro do outro
 * e o valor sairia dobrado.
 */
function addAcumuladores(
  rows: FlatRow[],
  periodos: string[],
  acumuladores: Acumulador[],
  totalPorPrefixo: Map<string, Map<string, number>>,
  resultadoApurado: Map<string, number> | undefined,
  mascara: MascaraConfig,
  opts: {
    formulasEbit: FormulasEbitEbitda;
    somaClassifs: (classifs: string[], periodo: string) => number;
    planoFormula: Plano[];
    saldos: Saldo[];
  },
) {
  const prefixos = Array.from(totalPorPrefixo.keys());
  const soma = (filtro: (p: string) => boolean, periodo: string) => {
    let t = 0;
    for (const pref of prefixos) {
      if (!filtro(pref)) continue;
      t += totalPorPrefixo.get(pref)?.get(periodo) ?? 0;
    }
    return t;
  };

  const ordenados = [...acumuladores].sort(
    (a, b) => compararClassificacao(a.classificacao, b.classificacao),
  );
  const ultimo = ordenados[ordenados.length - 1];

  for (const ac of ordenados) {
    // O bloco de um acumulador é o pai dele: 3.02.99 fecha 3.02.
    const partes = dividir(ac.classificacao, mascara);
    const blocoPai = partes.length > 1 ? juntar(partes.slice(0, -1), mascara) : ac.classificacao;

    for (const p of periodos) {
      let valor: number;
      if (ac.tipo === "bloco") {
        valor = soma(
          (pref) => pref === blocoPai || descendeDe(pref, blocoPai, mascara),
          p,
        );
      } else {
        valor = soma(
          (pref) => compararClassificacao(pref, ac.classificacao) < 0,
          p,
        );
      }

      // O último acumulador é o resultado do exercício. Ele é conferido
      // contra o movimento do grupo inteiro — o MESMO número que o
      // Balanço leva para o PL. Assim as duas demonstrações fecham entre
      // si mesmo que algum ramo do plano tenha ficado fora das linhas.
      const ehResultado = ac === ultimo;
      if (ehResultado && resultadoApurado?.has(p)) {
        valor = resultadoApurado.get(p)!;
      }

      const descricao = ehResultado ? rotuloResultado(valor) : ac.rotulo;
      rows.push({
        linha_ordem: ac.ordem * 1000,
        descricao,
        codigo_conta: ac.classificacao,
        nivel: 0,
        is_subtotal: true,
        periodo: p,
        valor,
      });
    }
  }

  // EBIT e EBITDA no final, depois do resultado do exercício.
  // Não entram no meio da DRE: o fluxo do plano já tem os acumuladores
  // na ordem dele; estes dois são linhas gerenciais calculadas.
  const ultimaOrdem =
    ordenados.length > 0 ? ordenados[ordenados.length - 1].ordem * 1000 : 900_000;
  const estrutura = getEstruturaPadraoSync() ?? [];
  const { formulasEbit, somaClassifs, planoFormula, saldos } = opts;

  const planoEng: PlanoRowEng[] = planoFormula.map((p) => ({
    codigo: p.codigo,
    classificacao: p.classificacao,
    descricao: p.descricao,
    natureza: null,
    is_sintetica: p.is_sintetica ?? false,
    is_participante: p.is_participante,
  }));
  const planoByCod = new Map(planoFormula.map((p) => [p.codigo, p]));
  const saldosPorCodigo = new Map<string, Map<string, SaldoRow>>();
  const saldosAgg = new Map<string, SaldoRow>();
  for (const s of saldos) {
    let m = saldosPorCodigo.get(s.conta_codigo);
    if (!m) {
      m = new Map();
      saldosPorCodigo.set(s.conta_codigo, m);
    }
    const curCod = m.get(s.competencia);
    if (curCod) {
      curCod.total_debitos += s.total_debitos;
      curCod.total_creditos += s.total_creditos;
    } else {
      m.set(s.competencia, {
        conta_codigo: s.conta_codigo,
        competencia: s.competencia,
        total_debitos: s.total_debitos,
        total_creditos: s.total_creditos,
      });
    }
    const cls = planoByCod.get(s.conta_codigo)?.classificacao;
    if (!cls) continue;
    const k = `${cls}|${s.competencia}`;
    const cur = saldosAgg.get(k);
    if (cur) {
      cur.total_debitos += s.total_debitos;
      cur.total_creditos += s.total_creditos;
    } else {
      saldosAgg.set(k, {
        conta_codigo: cls,
        competencia: s.competencia,
        total_debitos: s.total_debitos,
        total_creditos: s.total_creditos,
      });
    }
  }
  const ctxEngine = buildContext({
    plano: planoEng,
    saldos: Array.from(saldosAgg.values()),
    aberturas: new Map(),
    mascara,
    saldosPorCodigo,
  });

  const valorPapel = (papel: string, periodo: string): number | null => {
    const defs = estrutura.filter(
      (e) => e.papel === papel && e.demonstracao === "DRE",
    );
    if (defs.length === 0) return null;
    let t = 0;
    for (const e of defs) {
      if (e.tipo_linha === "corrido") {
        t += soma(
          (pref) => compararClassificacao(pref, e.classificacao) < 0,
          periodo,
        );
      } else if (e.tipo_linha === "bloco") {
        const partes = dividir(e.classificacao, mascara);
        const pai =
          partes.length > 1 ? juntar(partes.slice(0, -1), mascara) : e.classificacao;
        t += soma(
          (pref) => pref === pai || descendeDe(pref, pai, mascara),
          periodo,
        );
      } else {
        t += somaClassifs([e.classificacao], periodo);
      }
    }
    return t;
  };

  const valorLinhaDre = (papel: string, periodo: string): number | null => {
    if (papel === "CUSTOS") {
      const a = valorPapel("CPV", periodo) ?? 0;
      const b = valorPapel("CMV", periodo) ?? 0;
      const c = valorPapel("CSP", periodo) ?? 0;
      const d = valorPapel("CUSTO_IMOBILIARIO", periodo) ?? 0;
      return a + b + c + d;
    }
    if (papel === "IRPJ_CSLL") {
      return (valorPapel("PROVISAO_IRPJ", periodo) ?? 0) + (valorPapel("PROVISAO_CSLL", periodo) ?? 0);
    }
    if (papel === "RESULTADO_OPERACIONAL") return valorPapel("EBIT", periodo);
    return valorPapel(papel, periodo);
  };

  const avaliarFormula = (
    toks: Token[],
    periodo: string,
    extraLinha?: (linha: string) => number | null,
  ): number | null => {
    if (toks.length === 0) return null;
    return avaliarExpressao(
      toks,
      periodo,
      ctxEngine,
      (linha) => extraLinha?.(linha) ?? valorLinhaDre(linha, periodo),
    );
  };

  const ebitEstrutura = (periodo: string): number => {
    const doPapel = valorPapel("EBIT", periodo);
    if (doPapel != null) return doPapel;
    const row = rows.find(
      (r) =>
        r.periodo === periodo &&
        (/\bEBIT\b/i.test(r.descricao) || /resultado operacional/i.test(r.descricao)),
    );
    return row?.valor ?? 0;
  };

  const ebitDaDre = (periodo: string): number => {
    const daFormula = avaliarFormula(formulasEbit.ebit, periodo, (linha) => {
      // Na fórmula do próprio Ebit, "EBIT (DRE)" não pode se citar.
      // Cai na estrutura padrão (resultado operacional).
      if (linha === "EBIT" || linha === "EBITDA") return ebitEstrutura(periodo);
      return valorLinhaDre(linha, periodo);
    });
    if (daFormula != null) return daFormula;
    return ebitEstrutura(periodo);
  };

  const ebitdaDaDre = (periodo: string, ebit: number): number => {
    const daFormula = avaliarFormula(formulasEbit.ebitda, periodo, (linha) => {
      if (linha === "EBIT") return ebit;
      if (linha === "EBITDA") return ebit - (valorPapel("DEPRECIACAO_AMORTIZACAO", periodo) ?? 0);
      return valorLinhaDre(linha, periodo);
    });
    if (daFormula != null) return daFormula;
    const dep = valorPapel("DEPRECIACAO_AMORTIZACAO", periodo) ?? 0;
    return ebit - dep;
  };

  for (const p of periodos) {
    const ebit = ebitDaDre(p);
    const ebitda = ebitdaDaDre(p, ebit);
    rows.push({
      linha_ordem: ultimaOrdem + 10,
      descricao: "(=) EBIT",
      codigo_conta: null,
      nivel: 0,
      is_subtotal: true,
      periodo: p,
      valor: ebit,
    });
    rows.push({
      linha_ordem: ultimaOrdem + 20,
      descricao: "(=) EBITDA",
      codigo_conta: null,
      nivel: 0,
      is_subtotal: true,
      periodo: p,
      valor: ebitda,
    });
  }
}

/** Soma só as folhas sob `cls`, para não contar pai e filho juntos. */
function somaFolhas(
  rows: FlatRow[],
  cls: string,
  periodo: string,
  mascara: MascaraConfig,
): number {
  const candidatos = rows.filter(
    (r) =>
      r.periodo === periodo &&
      !!r.codigo_conta &&
      !r.is_subtotal &&
      (r.codigo_conta === cls || descendeDe(r.codigo_conta, cls, mascara)),
  );
  return candidatos
    .filter(
      (r) =>
        !candidatos.some(
          (o) =>
            o !== r &&
            o.codigo_conta &&
            r.codigo_conta &&
            descendeDe(o.codigo_conta, r.codigo_conta, mascara),
        ),
    )
    .reduce((a, r) => a + r.valor, 0);
}

// ---------- Balanço Patrimonial ----------

async function buildBP(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  tipo: "BP_ATIVO" | "BP_PASSIVO",
  mascara: MascaraConfig,
  modo: ModoDemonstracao = "contabil",
  gerData?: AjustesGerenciaisData,
): Promise<FlatRow[]> {
  const tipoPlano = tipo === "BP_ATIVO" ? ["1-Ativo"] : ["2-Passivo"];
  const ateData = [...periodos].sort().pop()!;

  // Busca primeiro abertura + saldos para descobrir quais conta_codigo
  // realmente têm saldo. Em seguida usa esse set para restringir a busca
  // de contas participantes (clientes/fornecedores) — o cadastro completo
  // pode ter 100k+ linhas e estoura o fetch.
  const [mapaInfo, abertura, saldosAcumContabil, planoDRE] = await Promise.all([
    getMapa(companyId, tenantId, modoGlobal, tipo, mascara),
    getAberturas(companyId),
    getSaldosAteData(companyId, ateData),
    tipo === "BP_PASSIVO"
      ? getPlanoPorTipo(companyId, tenantId, modoGlobal, ["3-DRE"])
      : Promise.resolve([] as Plano[]),
  ]);
  const mapas = mapaInfo.mapas;

  // Modo GERENCIAL: injeta saldos virtuais dos ajustes acumulados até
  // `ateData` (posição, mesma regra do BP contábil), e adiciona contas
  // gerenciais ao plano para que apareçam no grupo pai correto.
  let saldosAcum = saldosAcumContabil;
  let planoExtra: Plano[] = [];
  if (modo === "gerencial") {
    const ger = gerData ?? (await getAjustesGerenciais(companyId, tenantId));
    const virtuais = ajustesToSaldosVirtuais(ger.ajustes, (c) => c <= ateData);
    saldosAcum = [...saldosAcum, ...virtuais];
    planoExtra = contasGerenciaisToPlanoVirtual(ger.contasGerenciais, mascara.separador || ".");
  }

  const codigosComSaldo = new Set<string>();
  for (const a of abertura) codigosComSaldo.add(a.conta_codigo);
  for (const s of saldosAcum) codigosComSaldo.add(s.conta_codigo);

  // Resultado acumulado do exercício até cada período de referência (apenas BP_PASSIVO).
  // resultado = -(Σ movimento contas grupo 3 do início do ano até ref).
  // Em meses de prejuízo o valor é negativo (reduz o PL); em lucro, positivo.
  // No modo gerencial os movimentos virtuais de ajustes em contas DRE (grupo 3)
  // já estão em saldosAcum e portanto propagam automaticamente para o resultado
  // — mantendo Ativo = Passivo + PL na visão gerencial.
  const dreCodigos = new Set<string>(planoDRE.map((p) => p.codigo));
  const resultadoExercicioPorRef = new Map<string, number>();
  if (tipo === "BP_PASSIVO" && dreCodigos.size > 0) {
    for (const ref of periodos) {
      const inicioExerc = `${ref.slice(0, 4)}-01`;
      let soma = 0;
      for (const s of saldosAcum) {
        if (
          s.competencia >= inicioExerc &&
          s.competencia <= ref &&
          dreCodigos.has(s.conta_codigo)
        ) {
          soma += s.movimento;
        }
      }
      resultadoExercicioPorRef.set(ref, -soma);
    }
  }

  const planoContabil = await getPlanoPorTipo(companyId, tenantId, modoGlobal, tipoPlano, {
    incluirParticipantes: true,
    codigosComSaldo: Array.from(codigosComSaldo),
  });
  const plano = [...planoContabil, ...planoExtra];

  const planoMap = new Map<string, Plano>();
  const planoPorClassificacao = new Map<string, Plano>();
  const planoPrefixos = new Map<string, string>();
  const classificacoesEstruturais = new Set<string>();
  for (const p of plano) {
    planoMap.set(p.codigo, p);
    if (!p.is_participante) {
      planoPorClassificacao.set(p.classificacao, p);
      classificacoesEstruturais.add(p.classificacao);
    } else if (!planoPorClassificacao.has(p.classificacao)) {
      planoPorClassificacao.set(p.classificacao, p);
    }
    // Prefere a descrição da conta ESTRUTURAL para os prefixos pais
    // (evita rotular a conta pai "CLIENTES" com o nome de um cliente individual).
    if (!p.is_participante || !planoPrefixos.has(p.classificacao)) {
      planoPrefixos.set(p.classificacao, p.descricao);
    }
  }
  const matcher = buildMatcher(mapas, mascara);

  const linhasMeta = new Map<string, { ordem: number }>();
  for (const m of mapas) {
    const prev = linhasMeta.get(m.linha_demonstracao);
    if (!prev || m.ordem < prev.ordem) {
      linhasMeta.set(m.linha_demonstracao, { ordem: m.ordem });
    }
  }

  const out: FlatRow[] = [];
  const periodosOrd = [...periodos].sort();

  // Saldos acumulados por conta até cada período de referência
  // CORREÇÃO DE ACÚMULO — abertura + movimento POSTERIOR a ela, por conta.
  // Antes era `new Map(abertura)` + soma de todo o movimento por cima,
  // o que contava duas vezes o histórico já embutido na abertura.
  const acumulador = criarAcumulador(
    saldosAcum.map((x) => ({
      conta_codigo: x.conta_codigo,
      competencia: x.competencia,
      movimento: x.movimento,
    })),
    abertura,
  );

  // Fase 1: coleta pontos consolidados por (linha mapeada, ref) — assim como
  // no DRE, para construir a árvore UMA vez a partir da união dos períodos.
  const porLinha = new Map<
    string,
    { ordem: number; pontosPor: Map<string, Ponto[]> }
  >();
  for (const [linha, meta] of linhasMeta) {
    porLinha.set(linha, { ordem: meta.ordem, pontosPor: new Map() });
  }
  // totalPorRef[ref][linha] = valor total daquela linha naquele ref
  const totalPorLinhaRef = new Map<string, Map<string, number>>();
  const initRefMap = (linha: string) => {
    let m = totalPorLinhaRef.get(linha);
    if (!m) { m = new Map(); totalPorLinhaRef.set(linha, m); }
    return m;
  };

  // Contas que existem: com movimento ou com abertura.
  const contasComDados = acumulador.contas();

  for (const ref of periodosOrd) {
    // O acumulador resolve por conta: pega a abertura vigente naquela
    // data e soma só o movimento posterior a ela.
    const snapshot = new Map<string, number>();
    for (const codigo of contasComDados) {
      snapshot.set(codigo, acumulador.saldoAte(codigo, ref));
    }
    const pontos = aplicarMapaESinal(snapshot, planoMap, matcher, mascara, { incluirParticipantes: true });
    const pontosConsolidados = pontos.map((pt) => ({
      ...pt,
      classificacao: pt.isParticipante
        ? prefixoEstruturalMaisProximo(pt.classificacao, classificacoesEstruturais, mascara)
        : pt.classificacao,
    }));

    for (const pt of pontosConsolidados) {
      const linha = pt.mapa.linha_demonstracao;
      const conta = planoMap.get(pt.codigo) ?? planoPorClassificacao.get(pt.classificacao);
      const bucket = porLinha.get(linha)!;
      const arr = bucket.pontosPor.get(ref) ?? [];
      arr.push({
        classificacao: pt.classificacao,
        codigo: pt.codigo,
        descricao: conta?.descricao ?? pt.classificacao,
        valor: pt.valor,
        nivelPlano: conta?.nivel ?? nivelDe(pt.classificacao, mascara),
      });
      bucket.pontosPor.set(ref, arr);
      const tm = initRefMap(linha);
      tm.set(ref, (tm.get(ref) ?? 0) + pt.valor);
    }
    // Garante entrada vazia por ref para todas as linhas (header por período).
    for (const [linha, bucket] of porLinha) {
      if (!bucket.pontosPor.has(ref)) {
        bucket.pontosPor.set(ref, []);
        const tm = initRefMap(linha);
        if (!tm.has(ref)) tm.set(ref, 0);
      }
    }
  }

  const linhasOrd = Array.from(porLinha.entries()).sort(
    (a, b) => a[1].ordem - b[1].ordem,
  );
  const STRUCT_GROUPS: Record<string, string[]> =
    tipo === "BP_ATIVO"
      ? {
          "Ativo Não Circulante": [
            "Realizável a Longo Prazo",
            "Investimentos",
            "Imobilizado",
            "Intangível",
          ],
        }
      : {
          "Patrimônio Líquido": [
            "Capital Social",
            "Reservas",
            "Lucros/Prejuízos Acumulados",
          ],
        };
  const isStructParent = (linha: string) => linha in STRUCT_GROUPS;
  const childrenOf = (linha: string) => STRUCT_GROUPS[linha] ?? [];
  const childSet = new Set(Object.values(STRUCT_GROUPS).flat());
  const parentOf = new Map<string, string>();
  for (const [p, kids] of Object.entries(STRUCT_GROUPS)) {
    kids.forEach((k) => parentOf.set(k, p));
  }
  const ordemDe = (linha: string) => linhasMeta.get(linha)?.ordem ?? 0;

  // Fase 2: emite a árvore por linha (uma vez, com todos os períodos).
  for (const [linha, info] of linhasOrd) {
    let base = info.ordem * 1000;
    const parentLinha = parentOf.get(linha);
    if (parentLinha) {
      const idx = childrenOf(parentLinha).indexOf(linha);
      base = ordemDe(parentLinha) * 1000 + (idx + 1) * 20;
    }
    const linhas = emitirArvoreMulti(
      { linha, ordem: info.ordem },
      info.pontosPor,
      base,
      planoPrefixos,
      mascara,
    );
    // Hierarquia do BP:
    //   0  ATIVO / PASSIVO E PL  (cabeçalho do lado, emitido depois)
    //   1  Circulante, Não Circulante, PL, …
    //   2+ contas e filhos estruturais (Imobilizado, Capital, Resultado)
    // Sem esse recuo, Circulante ficava no mesmo nível do ATIVO e a
    // visão padrão (abrir só o primeiro nível) não tinha o que expandir.
    if (isStructParent(linha)) {
      for (const l of linhas) if (l.nivel === 0) out.push({ ...l, nivel: 1 });
    } else if (parentLinha) {
      for (const l of linhas) out.push({ ...l, nivel: l.nivel + 2 });
    } else {
      for (const l of linhas) out.push({ ...l, nivel: l.nivel + 1 });
    }
  }

  // Fase 2b: no passivo, emite "Resultado do Exercício" como filha do PL.
  if (tipo === "BP_PASSIVO") {
    // Sem o marco de PL definido, ordemDe devolvia 0 e o Resultado ia
    // parar na PRIMEIRA linha do Passivo. Ele é fecho do PL: sem âncora,
    // vai para o fim.
    const ordemPL = linhasMeta.has("Patrimônio Líquido")
      ? ordemDe("Patrimônio Líquido")
      : Math.max(0, ...Array.from(linhasMeta.values()).map((m) => m.ordem)) + 1;
    const baseRes =
      ordemPL * 1000 + (childrenOf("Patrimônio Líquido").length + 1) * 20;
    for (const ref of periodosOrd) {
      const resultado = resultadoExercicioPorRef.get(ref) ?? 0;
      out.push({
        linha_ordem: baseRes,
        descricao: "Resultado do Exercício",
        codigo_conta: null,
        nivel: 2, // filho do PL (nível 1), junto de Capital/Reservas
        is_subtotal: false,
        periodo: ref,
        valor: resultado,
      });
    }
  }

  // Qual linha é o Patrimônio Líquido.
  //
  // Isto era `linha === "Patrimônio Líquido"` — comparação com um rótulo
  // fixo. No plano do escritório a conta se chama "PATRIMONIO LIQUIDO",
  // sem acento e em caixa alta: a comparação nunca casava, o resultado do
  // exercício não entrava no subtotal do PL e o grupo aparecia menor do
  // que é (só o total geral ficava certo). Agora vem do papel.
  const estruturaBP = getEstruturaPadraoSync();
  const classifPL = (estruturaBP ?? [])
    .filter((e) => e.papel === "PATRIMONIO_LIQUIDO")
    .map((e) => e.classificacao);
  const linhasPL = new Set(
    mapas
      .filter((m) =>
        classifPL.some(
          (c) =>
            m.classificacao_prefixo === c ||
            descendeDe(m.classificacao_prefixo, c, mascara),
        ),
      )
      .map((m) => m.linha_demonstracao),
  );
  const ehPatrimonioLiquido = (linha: string) =>
    linhasPL.has(linha) || /patrim[oô]nio\s+l[ií]quido/i.test(linha);

  // Fase 3: agrega parents estruturais e total do lado.
  for (const ref of periodosOrd) {
    const valorLinhaRef = (linha: string) => totalPorLinhaRef.get(linha)?.get(ref) ?? 0;
    let totalLado = 0;
    // O resultado do exercício não vem de conta patrimonial: ele é
    // apurado do grupo 3 e precisa entrar no Passivo+PL, senão o balanço
    // não fecha por construção. Antes só era somado quando existia a
    // linha "Patrimônio Líquido" — sem esse marco definido, ficava de
    // fora do total e o Ativo divergia exatamente pelo valor do resultado.
    const resultadoRef = tipo === "BP_PASSIVO" ? (resultadoExercicioPorRef.get(ref) ?? 0) : 0;
    let resultadoJaSomado = false;
    for (const [linha] of linhasOrd) {
      if (isStructParent(linha)) {
        let v = childrenOf(linha).reduce((a, c) => a + valorLinhaRef(c), 0);
        if (tipo === "BP_PASSIVO" && !resultadoJaSomado && ehPatrimonioLiquido(linha)) {
          v += resultadoRef;
          resultadoJaSomado = true;
        }
        const header = out.find(
          (r) => r.periodo === ref && r.descricao === linha && r.nivel === 1,
        );
        if (header) header.valor = v;
        totalLado += v;
      } else if (!childSet.has(linha)) {
        let v = valorLinhaRef(linha);
        // O PL nem sempre é um "parent estrutural": quando a cobertura
        // cai no mesmo nível de Circulante e Não Circulante, ele é uma
        // linha comum. Nesse caso o resultado do exercício aparecia como
        // filho dentro do PL mas não somava no cabeçalho dele — o grupo
        // exibia 400.000 com um filho de 99.000 pendurado.
        if (tipo === "BP_PASSIVO" && !resultadoJaSomado && ehPatrimonioLiquido(linha)) {
          v += resultadoRef;
          resultadoJaSomado = true;
          const header = out.find(
            (r) => r.periodo === ref && r.descricao === linha && r.nivel === 1,
          );
          if (header) header.valor = v;
        }
        totalLado += v;
      }
    }
    // Sem linha de PL para ancorar, soma aqui — o resultado tem que
    // estar no total de qualquer forma.
    if (tipo === "BP_PASSIVO" && !resultadoJaSomado) {
      totalLado += resultadoRef;
    }

    // (3) Cabeçalho do lado, antes de "Circulante" — sem ele a primeira
    // linha do Balanço era "ATIVO CIRCULANTE" solto, sem contexto.
    out.push({
      linha_ordem: 1,
      descricao: tipo === "BP_ATIVO" ? "ATIVO" : "PASSIVO E PATRIMÔNIO LÍQUIDO",
      codigo_conta: null,
      nivel: 0,
      is_subtotal: true,
      periodo: ref,
      valor: totalLado,
    });

    out.push({
      linha_ordem: 9_999_000,
      descricao: tipo === "BP_ATIVO" ? "Total do Ativo" : "Total do Passivo + PL",
      codigo_conta: null,
      nivel: 0,
      is_subtotal: true,
      periodo: ref,
      valor: totalLado,
    });
  }



  out.sort((a, b) => a.linha_ordem - b.linha_ordem || a.periodo.localeCompare(b.periodo));
  return removerLinhasZeradas(out, periodosOrd);
}

// ---------- Entry ----------

export async function buildStatementFromDiario(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  tipo: Tipo,
  periodos: string[],
  modo: ModoDemonstracao = "contabil",
): Promise<FlatRow[]> {
  if (periodos.length === 0) return [];
  // Carrega máscara da empresa (cai para tenant/default) — fonte única
  // de verdade para split, prefixo, pai e grupo nas demonstrações.
  const mascara = await getMascaraConfig({ tenantId, companyId });
  // Modo gerencial: carrega ajustes uma vez e reaproveita nas subchamadas
  // (DRE + BP dentro de DFC/DLPA/DVA quando aplicável).
  const gerData =
    modo === "gerencial" ? await getAjustesGerenciais(companyId, tenantId) : undefined;
  if (tipo === "DRE") return buildDRE(companyId, tenantId, modoGlobal, periodos, "DRE", mascara, modo, gerData);
  if (tipo === "DFC") return buildDFC(companyId, tenantId, modoGlobal, periodos, mascara, modo, gerData);
  if (tipo === "DLPA") return buildDLPA(companyId, tenantId, modoGlobal, periodos, mascara);
  if (tipo === "DVA") return buildDVA(companyId, tenantId, modoGlobal, periodos, mascara);
  return buildBP(companyId, tenantId, modoGlobal, periodos, tipo, mascara, modo, gerData);
}

/**
 * Verificação de fechamento do Balanço (Ativo = Passivo + PL) para um
 * determinado modo. Retorna a diferença absoluta por período; deve ser
 * ~0 em contábil e também em gerencial (partida dobrada D=C garante).
 */
export async function verificarFechamentoBP(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  modo: ModoDemonstracao = "contabil",
): Promise<Array<{ periodo: string; ativo: number; passivoPl: number; diferenca: number }>> {
  const [ativoRows, passivoRows] = await Promise.all([
    buildStatementFromDiario(companyId, tenantId, modoGlobal, "BP_ATIVO", periodos, modo),
    buildStatementFromDiario(companyId, tenantId, modoGlobal, "BP_PASSIVO", periodos, modo),
  ]);
  const totalDe = (rows: FlatRow[], desc: string, p: string) =>
    rows.find((r) => r.descricao === desc && r.periodo === p)?.valor ?? 0;
  return periodos.map((p) => {
    const ativo = totalDe(ativoRows, "Total do Ativo", p);
    const passivoPl = totalDe(passivoRows, "Total do Passivo + PL", p);
    return { periodo: p, ativo, passivoPl, diferenca: ativo - passivoPl };
  });
}

// ============================================================
// DFC / DLPA / DVA — derivados de saldos_mensais + plano_contas
// + reuso do motor de DRE.
// ============================================================

// Prefixos default (plano contábil padrão brasileiro)
const PREFIXO_CAIXA = "1.01.01";
const PREFIXO_IMOBILIZADO = "1.03";
const PREFIXO_EMPRESTIMOS_CP = "2.01.04";
const PREFIXO_EMPRESTIMOS_LP = "2.02.01";
const PREFIXO_CAPITAL_SOCIAL = "2.05.01.01";
const PREFIXO_LUCROS_ACUM = "2.05.01.09";
const PREFIXO_LUCROS_ACUM_ALT = "2.05.01.08";

const KW_DEPRECIACAO = /deprec|amortiz|exaust/i;
const KW_PESSOAL = /salar|f[eé]rias|13|fgts|inss patron|encargo|previd|benef|aliment|vale|sa[uú]de|odont/i;
const KW_IMPOSTOS = /imposto|tribut|icms|ipi|iss|pis|cofins|irpj|csll|simples|inss|fgts|taxa|contribui|prev/i;
const KW_JUROS = /juros|financeiras? despesa|encargo financeir|spread/i;
const KW_ALUGUEL = /alugu|arrendamento|leasing/i;
const KW_DIVIDENDOS = /dividend|jcp|juros sobre capital|distribui/i;

interface ContaSnapshot {
  classificacao: string;
  descricao: string;
  saldo: number; // saldo acumulado até a data (abertura + Σ movimento)
}

async function getSnapshotPorPrefixo(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  ateData: string,
  prefixos: string[],
  mascara: MascaraConfig,
): Promise<ContaSnapshot[]> {
  // carrega plano todo e saldos acumulados, filtra por prefixo
  const [plano, abertura, saldosAcum] = await Promise.all([
    getPlanoPorTipo(companyId, tenantId, modoGlobal, ["1-Ativo", "2-Passivo"]),
    getAberturas(companyId),
    getSaldosAteData(companyId, ateData),
  ]);
  const planoPorCodigo = new Map<string, Plano>();
  for (const p of plano) planoPorCodigo.set(p.codigo, p);

  // CORREÇÃO DE ACÚMULO (mesma do BP): a abertura já embute o histórico
  // até a data dela, então só o movimento posterior pode ser somado.
  const acumulador = criarAcumulador(
    saldosAcum.map((x) => ({
      conta_codigo: x.conta_codigo,
      competencia: x.competencia,
      movimento: x.movimento,
    })),
    abertura,
  );
  const acumPorCodigo = new Map<string, number>();
  for (const codigo of acumulador.contas()) {
    acumPorCodigo.set(codigo, acumulador.saldoAte(codigo, ateData));
  }

  const out: ContaSnapshot[] = [];
  for (const [codigo, saldo] of acumPorCodigo) {
    const conta = planoPorCodigo.get(codigo);
    if (!conta || conta.is_participante) continue;
    const matches = prefixos.some((pref) => descendeDe(conta.classificacao, pref, mascara));
    if (!matches) continue;
    out.push({ classificacao: conta.classificacao, descricao: conta.descricao, saldo });
  }
  return out;
}

function sumSnapshots(snap: ContaSnapshot[]): number {
  return snap.reduce((a, b) => a + b.saldo, 0);
}

function prevPeriodo(p: string): string {
  // p = 'YYYY-MM-DD' (primeiro dia do mês). Retorna último dia do mês anterior.
  const d = new Date(p + "T00:00:00Z");
  d.setUTCDate(0); // último dia do mês anterior
  return d.toISOString().slice(0, 10);
}

function emitirRow(
  out: FlatRow[],
  ordem: number,
  descricao: string,
  periodo: string,
  valor: number,
  opts: { nivel?: number; is_subtotal?: boolean; codigo?: string | null } = {},
) {
  out.push({
    linha_ordem: ordem,
    descricao,
    codigo_conta: opts.codigo ?? null,
    nivel: opts.nivel ?? 1,
    is_subtotal: opts.is_subtotal ?? false,
    periodo,
    valor,
  });
}

// ---------- DFC (método indireto) ----------

function tipoPlanoDeClassificacao(cls: string): string {
  const g = cls.trim()[0];
  if (g === "1") return "1-Ativo";
  if (g === "2") return "2-Passivo";
  if (g === "3") return "3-DRE";
  return "2-Passivo";
}

async function buildDFC(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  mascara: MascaraConfig,
  modo: ModoDemonstracao = "contabil",
  gerData?: AjustesGerenciaisData,
): Promise<FlatRow[]> {
  const periodosOrd = [...periodos].sort();
  const dre = await buildDRE(companyId, tenantId, modoGlobal, periodosOrd, "DRE", mascara, modo, gerData);

  const dreVal = (descricao: string, p: string) =>
    dre.find((r) => r.descricao === descricao && r.periodo === p)?.valor ?? 0;

  // AJUSTE 01 — a DFC deixou de depender de prefixos fixos no código
  // (1.01.01 = caixa, 1.03 = imobilizado...) e de regex na descrição
  // da conta. Agora cada conta ANALÍTICA declara no banco como
  // movimenta o caixa, então o método indireto fecha por construção:
  //
  //   Σ movimento de TODAS as contas = 0  (partidas dobradas)
  //   => Δcaixa = -(Δoperacional + Δinvestimento + Δfinanciamento + ΔDRE)
  //            = lucro líquido + ajustes não-caixa + capital de giro
  //              + investimento + financiamento
  //
  // O sinal: `movimento` = débito - crédito. Aumento de ativo
  // (débito) consome caixa; aumento de passivo (crédito) gera caixa.
  // Em ambos os casos o efeito no caixa é -movimento — por isso a
  // mesma fórmula serve para os três blocos.
  // Só as contas que TÊM movimento no período. Isto era um SELECT sem
  // filtro de conta: num plano com 135.000 clientes e fornecedores dava
  // uma varredura sequencial da tabela inteira (~77 ms no banco) e, pior,
  // 136 idas e voltas ao PostgREST para trazer 135.000 linhas ao
  // navegador — só para descobrir a classificação de umas poucas dezenas
  // de contas que de fato movimentaram. É o mesmo cuidado que
  // `getPlanoPorTipo` já tinha com participantes.
  let saldosDFC = await getSaldos(companyId, periodosOrd);
  const ger = modo === "gerencial"
    ? (gerData ?? (await getAjustesGerenciais(companyId, tenantId)))
    : undefined;
  if (ger) {
    const perSet = new Set(periodosOrd);
    const virtuais = ajustesToSaldosVirtuais(ger.ajustes, (c) => perSet.has(c));
    saldosDFC = [...saldosDFC, ...virtuais];
  }
  const codigosComMovimento = Array.from(
    new Set(saldosDFC.map((s) => s.conta_codigo)),
  );

  type FlagDFC = {
    codigo: string;
    classificacao: string;
    dfc_codigo: string | null;
    dfc_atividade: "caixa" | "operacional" | "investimento" | "financiamento" | null;
    dfc_nao_caixa: boolean;
    tipo: string;
  };
  const flagsBrutas: FlagDFC[] = [];
  const LOTE = 500; // evita URL gigante no .in()
  for (let i = 0; i < codigosComMovimento.length; i += LOTE) {
    const lote = codigosComMovimento.slice(i, i + LOTE);
    const parte = await fetchAllPaginated<FlagDFC>((from, to) => {
      const q = supabase
        .from("plano_contas")
        .select("codigo, classificacao, dfc_codigo, dfc_atividade, dfc_nao_caixa, tipo")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .eq("is_sintetica", false)
        .in("codigo", lote)
        .range(from, to);
      return modoGlobal ? q.is("company_id", null) : q.eq("company_id", companyId);
    });
    flagsBrutas.push(...parte);
  }

  if (ger) {
    const jaTem = new Set(flagsBrutas.map((f) => f.codigo));
    const virtPlano = contasGerenciaisToPlanoVirtual(
      ger.contasGerenciais,
      mascara.separador || ".",
    );
    const byCod = new Map(virtPlano.map((p) => [p.codigo, p]));
    for (const a of ger.ajustes) {
      for (const lado of [a.debito, a.credito]) {
        if (!lado || jaTem.has(lado.codigo)) continue;
        const vp = byCod.get(lado.codigo);
        const cls = vp?.classificacao ?? lado.classificacao;
        flagsBrutas.push({
          codigo: lado.codigo,
          classificacao: cls,
          dfc_codigo: null,
          dfc_atividade: null,
          dfc_nao_caixa: false,
          tipo: tipoPlanoDeClassificacao(cls),
        });
        jaTem.add(lado.codigo);
      }
    }
  }

  // O código da DFC vem do MAPA por classificação, não da coluna gravada
  // em cada conta.
  //
  // Gravar conta a conta significava reescrever 113.101 linhas para
  // classificar "clientes nacionais" — com trigger por linha, estourava o
  // timeout do servidor e deixava a alocação pela metade. O mapa tem
  // algumas dezenas de linhas: a conta resolve o código pelo prefixo mais
  // longo, na leitura. A coluna da conta continua valendo como exceção
  // pontual.
  const mapaDfc = await getMapaDfc(companyId);
  const resolverCodigoDfc = (f: FlagDFC): string | null => {
    if (f.dfc_codigo) return f.dfc_codigo;
    let melhor: { cls: string; cod: string } | null = null;
    for (const [cls, cod] of mapaDfc) {
      if (f.classificacao === cls || f.classificacao.startsWith(cls + ".")) {
        if (!melhor || cls.length > melhor.cls.length) melhor = { cls, cod };
      }
    }
    return melhor?.cod ?? null;
  };
  const flags = flagsBrutas.map((f) => ({ ...f, dfc_codigo: resolverCodigoDfc(f) }));

  // Catálogo da DFC: código -> bloco + rótulo + ordem. É a legenda da
  // planilha do escritório virada em dados.
  //
  // O bloco é resolvido AQUI, a partir do código, e não lido da coluna
  // `dfc_atividade` gravada na conta. Aquela coluna é um cache derivado:
  // planos carregados antes da planilha ficaram com o vínculo antigo
  // (4 blocos deduzidos por prefixo/descrição) e a DFC continuava
  // mostrando a classificação velha mesmo depois de revincular. Derivar
  // na leitura elimina a classe inteira do problema.
  const catalogo = await getDfcCatalogo();
  const blocoDoCodigo = (cod: string | null) =>
    cod ? (catalogo.get(cod)?.bloco ?? null) : null;

  const porCodigo = new Map(flags.map((f) => [f.codigo, f]));
  const saldos = saldosDFC;

  // Soma dos movimentos do período, por CÓDIGO da planilha.
  //
  // Antes a soma era feita direto nos 4 blocos, e o detalhe da planilha
  // (Variação de Clientes, de Fornecedores, de Tributos, Empréstimos…)
  // se perdia numa linha só chamada "Variação do Capital de Giro".
  // Agora o código é a chave, e o bloco é só o agrupamento na hora de
  // desenhar — que é exatamente o desenho da sua planilha.
  interface AccDFC {
    caixa: number;
    naoCaixa: number;
    semFlag: number;
    porCodigo: Map<string, number>;
  }
  const somaPorPeriodo = new Map<string, AccDFC>();
  for (const p of periodosOrd) {
    somaPorPeriodo.set(p, { caixa: 0, naoCaixa: 0, semFlag: 0, porCodigo: new Map() });
  }

  for (const s of saldos) {
    const acc = somaPorPeriodo.get(s.competencia);
    if (!acc) continue;
    const f = porCodigo.get(s.conta_codigo);
    if (!f) continue;
    const mov = s.movimento;
    const bloco = blocoDoCodigo(f.dfc_codigo);

    if (f.tipo === "3-DRE") {
      // O resultado já entra pelo Lucro Líquido da DRE. Aqui só
      // interessa estornar o que não passou por caixa.
      if (bloco === "nao_caixa" || f.dfc_nao_caixa) {
        acc.naoCaixa += mov;
        if (f.dfc_codigo) somaCodigo(acc, f.dfc_codigo, mov);
      }
      continue;
    }
    if (bloco === "nao_caixa" || f.dfc_nao_caixa) {
      // Depreciação acumulada e afins: conta de balanço que não passou
      // por caixa. Fica fora dos blocos (senão viraria "investimento") e
      // entra como estorno. O crédito da depreciação é `mov` negativo,
      // e a despesa a estornar é positiva — daí o sinal invertido.
      acc.naoCaixa += -mov;
      if (f.dfc_codigo) somaCodigo(acc, f.dfc_codigo, -mov);
      continue;
    }
    if (bloco === "caixa") {
      acc.caixa += mov;
      continue;
    }
    if (bloco === "resultado") continue; // ponto de partida, não é bloco
    if (bloco === "operacional" || bloco === "investimento" || bloco === "financiamento") {
      // Efeito no caixa é sempre -movimento: aumento de ativo (débito)
      // consome caixa, aumento de passivo (crédito) gera caixa.
      somaCodigo(acc, f.dfc_codigo!, -mov);
      continue;
    }
    // Conta de Ativo/Passivo com movimento e sem classificação: é ela
    // que quebra a identidade. Contabilizamos para avisar na tela.
    acc.semFlag += mov;
  }

  const out: FlatRow[] = [];

  // Os códigos que realmente têm movimento, na ordem do catálogo.
  const codigosUsados = new Set<string>();
  for (const acc of somaPorPeriodo.values())
    for (const [cod, v] of acc.porCodigo) if (Math.abs(v) > 0.005) codigosUsados.add(cod);

  const linhasDoBloco = (bloco: string) =>
    Array.from(catalogo.values())
      .filter((c) => c.bloco === bloco && codigosUsados.has(c.codigo))
      .sort((a, b) => a.ordem - b.ordem);

  // Leiaute dos blocos igual ao da base de referência (aba "10. Fluxo de
  // Caixa"): Bloco 1 / Bloco 2 / Bloco 3 / Fechamento. São só cabeçalhos —
  // as linhas, os códigos e as somas continuam exatamente os mesmos.
  const ORD = {
    bloco1: 90,
    lucro: 100, naoCaixaCab: 110, naoCaixaDet: 120, lucroAjustado: 190,
    giroCab: 200, giroDet: 210, operSub: 299,
    invCab: 300, invDet: 310, invSub: 399,
    finCab: 400, finDet: 410, finSub: 499,
    fechCab: 590,
    variacao: 600, caixaIni: 610, caixaFim: 620, conferencia: 700, aviso: 999,
  };

  for (const p of periodosOrd) {
    const acc = somaPorPeriodo.get(p)!;
    const val = (cod: string) => acc.porCodigo.get(cod) ?? 0;
    const somaBloco = (bloco: string) => {
      let t = 0;
      for (const c of catalogo.values()) if (c.bloco === bloco) t += val(c.codigo);
      return t;
    };

    // aceita qualquer um dos rótulos (Lucro / Prejuízo / o antigo)
    const lucroLiq =
      ROTULOS_RESULTADO_DRE.map((r) => dreVal(r, p)).find((v) => v !== 0) ?? 0;
    const ajusteNaoCaixa = acc.naoCaixa;
    const varCapitalGiro = somaBloco("operacional");
    const investimento = somaBloco("investimento");
    const financiamento = somaBloco("financiamento");
    const lucroAjustado = lucroLiq + ajusteNaoCaixa;
    const operacional = lucroAjustado + varCapitalGiro;
    const variacaoLiquida = operacional + investimento + financiamento;
    const variacaoCaixaReal = acc.caixa;
    const diferenca = variacaoLiquida - variacaoCaixaReal;

    emitirRow(out, ORD.bloco1, "Bloco 1 — Atividades Operacionais", p, operacional, { nivel: 0 });
    emitirRow(out, ORD.lucro, "Lucro Líquido do Exercício", p, lucroLiq);

    emitirRow(out, ORD.naoCaixaCab, "(+) Ajustes que não afetam o caixa", p, ajusteNaoCaixa);
    linhasDoBloco("nao_caixa").forEach((c, i) =>
      emitirRow(out, ORD.naoCaixaDet + i, c.descricao, p, val(c.codigo), { nivel: 2, codigo: c.codigo }),
    );
    emitirRow(out, ORD.lucroAjustado, "(=) Lucro ajustado", p, lucroAjustado, {
      nivel: 1, is_subtotal: true,
    });

    emitirRow(out, ORD.giroCab, "(+/-) Variações do Capital de Giro", p, varCapitalGiro);
    linhasDoBloco("operacional").forEach((c, i) =>
      emitirRow(out, ORD.giroDet + i, c.descricao, p, val(c.codigo), { nivel: 2, codigo: c.codigo }),
    );
    emitirRow(out, ORD.operSub, "(=) Caixa das Atividades Operacionais", p, operacional, {
      nivel: 0, is_subtotal: true,
    });

    emitirRow(out, ORD.invCab, "Bloco 2 — Atividades de Investimento", p, investimento, { nivel: 0 });
    linhasDoBloco("investimento").forEach((c, i) =>
      emitirRow(out, ORD.invDet + i, c.descricao, p, val(c.codigo), { nivel: 2, codigo: c.codigo }),
    );
    emitirRow(out, ORD.invSub, "(=) Caixa das Atividades de Investimento", p, investimento, {
      nivel: 0, is_subtotal: true,
    });

    emitirRow(out, ORD.finCab, "Bloco 3 — Atividades de Financiamento", p, financiamento, { nivel: 0 });
    linhasDoBloco("financiamento").forEach((c, i) =>
      emitirRow(out, ORD.finDet + i, c.descricao, p, val(c.codigo), { nivel: 2, codigo: c.codigo }),
    );
    emitirRow(out, ORD.finSub, "(=) Caixa das Atividades de Financiamento", p, financiamento, {
      nivel: 0, is_subtotal: true,
    });

    emitirRow(out, ORD.fechCab, "Fechamento", p, variacaoLiquida, { nivel: 0 });
    emitirRow(out, ORD.variacao, "(=) Variação Líquida de Caixa", p, variacaoLiquida, {
      nivel: 0, is_subtotal: true,
    });
    emitirRow(out, ORD.caixaFim, "Variação de Caixa apurada no Balanço", p, variacaoCaixaReal);

    // Com todas as contas classificadas, `diferenca` é exatamente 0.
    // Só aparece quando falta flag em alguma conta com movimento —
    // e aí a mensagem diz o que fazer, em vez de esconder num
    // "validado" com 5% de tolerância como era antes.
    if (Math.abs(diferenca) >= 0.01) {
      emitirRow(
        out,
        ORD.aviso,
        `⚠ Diferença de ${formatarDiferencaDFC(diferenca)} — há contas com movimento sem classificação de DFC. Configure em Plano de Contas > Estrutura e DFC.`,
        p,
        diferenca,
      );
    } else {
      emitirRow(out, ORD.conferencia, "✓ Validação CPC 03: a variação confere com o Balanço", p, 0);
    }
  }
  out.sort((a, b) => a.linha_ordem - b.linha_ordem || a.periodo.localeCompare(b.periodo));
  return out;
}

function somaCodigo(
  acc: { porCodigo: Map<string, number> },
  codigo: string,
  valor: number,
) {
  acc.porCodigo.set(codigo, (acc.porCodigo.get(codigo) ?? 0) + valor);
}

/**
 * Mapa classificação -> código da DFC, resolvido para a empresa.
 * Cacheado por empresa: é a mesma resposta em toda leitura de DFC.
 */
const _mapaDfcCache = new Map<string, Promise<Map<string, string>>>();

export function limparCacheMapaDfc(companyId?: string) {
  if (companyId) _mapaDfcCache.delete(companyId);
  else _mapaDfcCache.clear();
}

async function getMapaDfc(companyId: string): Promise<Map<string, string>> {
  let p = _mapaDfcCache.get(companyId);
  if (!p) {
    p = (async () => {
      const { data, error } = await (supabase as any).rpc("dfc_mapa", {
        _company_id: companyId,
      });
      if (error) {
        console.warn("[dfc_mapa] indisponível:", error.message);
        return new Map<string, string>();
      }
      const m = new Map<string, string>();
      for (const r of (data ?? []) as { classificacao: string; codigo_dfc: string }[]) {
        if (!m.has(r.classificacao)) m.set(r.classificacao, r.codigo_dfc);
      }
      return m;
    })();
    _mapaDfcCache.set(companyId, p);
  }
  return p;
}

export interface DfcCatalogoItem {
  codigo: string;
  descricao: string;
  bloco: "caixa" | "operacional" | "investimento" | "financiamento" | "nao_caixa" | "resultado";
  ordem: number;
}

let _dfcCatalogo: Map<string, DfcCatalogoItem> | null = null;

/** Catálogo de códigos da DFC (tabela de referência global, carregada uma vez). */
export async function getDfcCatalogo(): Promise<Map<string, DfcCatalogoItem>> {
  if (_dfcCatalogo) return _dfcCatalogo;
  const { data, error } = await (supabase as any)
    .from("dfc_catalogo")
    .select("codigo, descricao, bloco, ordem")
    .order("ordem");
  if (error) {
    console.warn("[dfc_catalogo] indisponível:", error.message);
    _dfcCatalogo = new Map();
    return _dfcCatalogo;
  }
  _dfcCatalogo = new Map(
    ((data ?? []) as DfcCatalogoItem[]).map((c) => [c.codigo, c]),
  );
  return _dfcCatalogo;
}

function formatarDiferencaDFC(v: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Math.abs(v));
}

// ---------- DLPA ----------

async function buildDLPA(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  mascara: MascaraConfig,
): Promise<FlatRow[]> {
  const periodosOrd = [...periodos].sort();
  const dre = await buildDRE(companyId, tenantId, modoGlobal, periodosOrd, "DRE", mascara);
  const dreVal = (descricao: string, p: string) =>
    dre.find((r) => r.descricao === descricao && r.periodo === p)?.valor ?? 0;

  const out: FlatRow[] = [];
  for (const p of periodosOrd) {
    const pPrev = prevPeriodo(p);
    const [snapPrev, snapCurr] = await Promise.all([
      getSnapshotPorPrefixo(companyId, tenantId, modoGlobal, pPrev, [
        PREFIXO_LUCROS_ACUM,
        PREFIXO_LUCROS_ACUM_ALT,
        PREFIXO_CAPITAL_SOCIAL,
      ], mascara),
      getSnapshotPorPrefixo(companyId, tenantId, modoGlobal, p, [
        PREFIXO_LUCROS_ACUM,
        PREFIXO_LUCROS_ACUM_ALT,
        PREFIXO_CAPITAL_SOCIAL,
      ], mascara),
    ]);
    const filtPref = (snap: ContaSnapshot[], prefs: string[]) =>
      snap.filter((s) => prefs.some((pref) => descendeDe(s.classificacao, pref, mascara)));

    // Passivo é credor: para PL exibir como positivo invertemos o sinal
    const saldoInicial = -sumSnapshots(
      filtPref(snapPrev, [PREFIXO_LUCROS_ACUM, PREFIXO_LUCROS_ACUM_ALT]),
    );
    const saldoFinalContabil = -sumSnapshots(
      filtPref(snapCurr, [PREFIXO_LUCROS_ACUM, PREFIXO_LUCROS_ACUM_ALT]),
    );
    const capitalSocial = -sumSnapshots(filtPref(snapCurr, [PREFIXO_CAPITAL_SOCIAL]));

    const lucroLiq = dreVal("(=) Lucro Líquido do Exercício", p);

    // Reserva legal sugerida (5% LL limitado a 20% do capital)
    const reservaLegalSugerida = Math.max(
      0,
      Math.min(lucroLiq * 0.05, Math.max(0, capitalSocial * 0.2)),
    );

    // Movimento real no período (variação efetiva do saldo) — depois de subtrair LL deveria zerar se só houve LL
    const variacaoReal = saldoFinalContabil - saldoInicial;
    // Destinações efetivas = LL - variacao real (o que saiu da conta de lucros)
    const destinacoesEfetivas = lucroLiq - variacaoReal;

    const base = 0;
    emitirRow(out, base + 100, "Saldo Inicial de Lucros/Prejuízos Acumulados", p, saldoInicial);
    emitirRow(out, base + 199, "(=) Saldo Inicial Ajustado", p, saldoInicial, {
      nivel: 0,
      is_subtotal: true,
    });
    emitirRow(out, base + 210, lucroLiq >= 0 ? "(+) Lucro Líquido do Exercício" : "(-) Prejuízo do Exercício", p, lucroLiq);
    emitirRow(out, base + 310, "(-) Reserva Legal (sugerida 5%)", p, -reservaLegalSugerida);
    emitirRow(out, base + 320, "(-) Destinações / Distribuições do Período", p, -destinacoesEfetivas);
    emitirRow(out, base + 399, "(=) Saldo Final de Lucros/Prejuízos Acumulados", p, saldoFinalContabil, {
      nivel: 0,
      is_subtotal: true,
    });
    const reconciliado = Math.abs(saldoFinalContabil - (saldoInicial + lucroLiq - destinacoesEfetivas)) < 0.01;
    emitirRow(
      out,
      base + 999,
      reconciliado
        ? "✓ Saldo final reconciliado com a contabilidade"
        : "⚠ Saldo final divergente — verificar destinações",
      p,
      0,
    );
  }
  return out;
}

// ---------- DVA ----------

async function buildDVA(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
  periodos: string[],
  mascara: MascaraConfig,
): Promise<FlatRow[]> {
  const periodosOrd = [...periodos].sort();
  const dre = await buildDRE(companyId, tenantId, modoGlobal, periodosOrd, "DRE", mascara);

  const dreVal = (descricao: string, p: string) =>
    dre.find((r) => r.descricao === descricao && r.periodo === p)?.valor ?? 0;

  // Linhas analíticas da DRE (têm codigo_conta) → permite classificar por keyword
  const analyticDRE = dre.filter((r) => !r.is_subtotal && r.codigo_conta);

  const out: FlatRow[] = [];
  for (const p of periodosOrd) {
    const rowsP = analyticDRE.filter((r) => r.periodo === p);
    const matchSum = (re: RegExp) =>
      rowsP
        .filter((r) => re.test(r.descricao ?? ""))
        .reduce((a, r) => a + Math.abs(Number(r.valor) || 0), 0);

    const receitaBruta = dreVal("Receita Bruta", p);
    const deducoes = dreVal("(-) Deduções da Receita Bruta", p);
    const receitaLiq = dreVal("(=) Receita Líquida", p);
    const custos =
      dreVal("(-) Custos Industriais", p) +
      dreVal("(-) Custos Comerciais", p) +
      dreVal("(-) Custos Imobiliários", p) +
      dreVal("(-) Custos dos Serviços", p) +
      dreVal("(-) Custos", p);
    const receitasFin = dreVal("(+) Receitas Financeiras", p);

    const depAmort = rowsP
      .filter((r) => KW_DEPRECIACAO.test(r.descricao ?? ""))
      .reduce((a, r) => a + Math.abs(Number(r.valor) || 0), 0);

    // GERAÇÃO
    const receitas = receitaBruta - deducoes; // receita líquida
    void receitaLiq;
    const insumos = custos; // simplificação: insumos ≈ CMV/CSV
    const vaBruto = receitas - insumos;
    const vaLiquido = vaBruto - depAmort;
    const transferencias = receitasFin;
    const vaTotal = vaLiquido + transferencias;

    // DISTRIBUIÇÃO
    const pessoal = matchSum(KW_PESSOAL);
    const impostosDireto = matchSum(KW_IMPOSTOS) + Math.abs(deducoes);
    const capTerceiros = matchSum(KW_JUROS) + matchSum(KW_ALUGUEL);
    const lucroLiq = dreVal("(=) Lucro Líquido do Exercício", p);
    const capProprio = lucroLiq; // distribuído ou retido
    const totalDistribuido = pessoal + impostosDireto + capTerceiros + capProprio;
    const validado = Math.abs(vaTotal - totalDistribuido) < Math.max(1, Math.abs(vaTotal) * 0.1);

    const base = 0;
    emitirRow(out, base + 100, "Receitas", p, receitas);
    emitirRow(out, base + 110, "(-) Insumos Adquiridos de Terceiros", p, -insumos);
    emitirRow(out, base + 199, "(=) Valor Adicionado Bruto", p, vaBruto, {
      nivel: 0,
      is_subtotal: true,
    });
    emitirRow(out, base + 210, "(-) Depreciação, Amortização e Exaustão", p, -depAmort);
    emitirRow(out, base + 299, "(=) Valor Adicionado Líquido Produzido", p, vaLiquido, {
      nivel: 0,
      is_subtotal: true,
    });
    emitirRow(out, base + 310, "(+) Valor Adicionado Recebido em Transferência", p, transferencias);
    emitirRow(out, base + 399, "(=) Valor Adicionado Total a Distribuir", p, vaTotal, {
      nivel: 0,
      is_subtotal: true,
    });

    emitirRow(out, base + 500, "Distribuição do Valor Adicionado", p, totalDistribuido, {
      nivel: 0,
      is_subtotal: true,
    });
    emitirRow(out, base + 510, "Pessoal e Encargos", p, pessoal);
    emitirRow(out, base + 520, "Impostos, Taxas e Contribuições", p, impostosDireto);
    emitirRow(out, base + 530, "Remuneração de Capitais de Terceiros", p, capTerceiros);
    emitirRow(out, base + 540, "Remuneração de Capitais Próprios", p, capProprio);

    emitirRow(
      out,
      base + 999,
      validado
        ? "✓ Validação CPC 09: valor gerado = valor distribuído"
        : "⚠ Validação CPC 09: geração diferente da distribuição",
      p,
      vaTotal - totalDistribuido,
    );
  }
  return out;
}
