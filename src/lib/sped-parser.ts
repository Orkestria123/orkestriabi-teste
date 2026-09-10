/**
 * Parser do SPED Contábil (ECD) — IN RFB 1.422/2013
 * Lê o arquivo .txt e extrai: identificação, plano de contas (I050),
 * saldos (I150/I155) e demonstrações (J005 + J100/J150/J200/J210/J215).
 *
 * Convenções aplicadas:
 *  - Sinal de exibição segue IND_VL / IND_DC (D = devedor, C = credor) +
 *    IND_VC ('1' = entre parênteses → negativo) conforme spec do tenant.
 *  - Para a DRE: receitas (C) positivas, despesas/custos (D) negativos.
 *  - Para o BP: ativos (D) positivos no Ativo; passivo+PL (C) positivos no Passivo.
 *    Quando J100 vem dentro de um J005 de BP, IND_GRP_BAL separa Ativo/Passivo.
 *  - Período do registro J100/J150 = DT_FIN do J005 corrente (anual).
 */

export interface ContaContabil {
  codigo_conta: string;
  nome_conta: string;
  nivel: number;
  tipo_conta: "A" | "S";
  natureza: "D" | "C" | "P";
  parent_codigo: string | null;
  /** I051 — código no plano de contas REFERENCIAL (RFB). */
  cod_referencial?: string | null;
  /** I052 — código de AGLUTINAÇÃO, o que o próprio ECD usa para montar
   *  as demonstrações do bloco J. Costuma ser o código estrutural do
   *  plano da empresa, e é o melhor candidato a "classificação". */
  cod_aglutinacao?: string | null;
}

export interface SaldoConta {
  codigo_conta: string;
  periodo: string;
  saldo_inicial: number;
  debitos: number;
  creditos: number;
  saldo_final: number;
}

/**
 * Uma partida do diário do ECD (I250, sob o I200 que a agrupa).
 *
 * O ECD traz o LANÇAMENTO, não só o saldo. Sem ler isto:
 *
 *  · o drill-down da DRE e da DFC não abre em período vindo de ECD — a
 *    consulta procura o movimento em `lancamentos_diario`, e o ECD só
 *    escrevia saldo mensal;
 *  · o encerramento do exercício é indetectável no detalhe: do saldo
 *    sozinho é impossível separá-lo do movimento genuíno de dezembro
 *    (as duas incógnitas satisfazem a mesma equação). Com o histórico da
 *    partida, é uma linha de texto.
 */
export interface LancamentoEcd {
  numero: string;
  data: string;
  codigo_conta: string;
  debito: number;
  credito: number;
  historico: string;
}

export interface LinhaDemonstracao {
  tipo_demonstracao: string;
  periodo: string;
  linha_ordem: number;
  descricao: string;
  codigo_conta: string | null;
  valor: number;
  nivel: number;
  is_subtotal: boolean;
}

export interface ValidationResult {
  nome: string;
  passou: boolean;
  severidade: "error" | "warning";
  detalhe?: string;
}

export interface SpedParseResult {
  empresa: {
    cnpj: string;
    razaoSocial: string;
    periodoInicio: string;
    periodoFim: string;
  };
  planoContas: ContaContabil[];
  saldos: SaldoConta[];
  lancamentos: LancamentoEcd[];
  demonstracoes: LinhaDemonstracao[];
  warnings: string[];
  validacoes: ValidationResult[];
}

/**
 * J005 ID_DEM → tipo da demonstração.
 *   1 = Balanço Patrimonial (J100 usa IND_GRP_BAL A/P para separar)
 *   2 = DMPL  3 = DRE  4 = DLPA  5 = DFC  6 = DVA
 */
const TIPO_DEMO_MAP: Record<string, string> = {
  "1": "BP", "01": "BP",
  "2": "DMPL", "02": "DMPL",
  "3": "DRE", "03": "DRE",
  "4": "DLPA", "04": "DLPA",
  "5": "DFC", "05": "DFC",
  "6": "DVA", "06": "DVA",
};

function parseNumber(s: string | undefined): number {
  if (!s) return 0;
  const cleaned = s.trim().replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseSpedDate(s: string | undefined): string {
  if (!s || s.length !== 8) return "";
  return `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;
}

function prevYearPeriod(periodo: string): string {
  if (!periodo) return "";
  const [y, m, d] = periodo.split("-").map((x) => parseInt(x, 10));
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Aplica sinal de exibição a um valor lido do SPED.
 *  - ind: indicador de sinal (D/C ou N/P ou 0/1).
 *  - convencaoNegativa: lista de indicadores que tornam o valor negativo.
 *  - indVc: se '1', força negativo (entre parênteses no SPED).
 */
function aplicarSinal(
  valor: number,
  ind: string,
  convencaoNegativa: string[],
  indVc?: string,
): number {
  const abs = Math.abs(valor);
  let signed = convencaoNegativa.includes(ind) ? -abs : abs;
  if (indVc === "1") signed = -Math.abs(signed);
  return signed;
}

/**
 * O ÚLTIMO campo preenchido de um registro — e por que isto existe.
 *
 * O I051 e o I052 mudaram de largura entre versões do leiaute do ECD. O
 * campo que interessa (COD_CTA_REF no I051, COD_AGL no I052) é sempre o
 * ÚLTIMO; os que variam entram ANTES dele:
 *
 *     |I051|COD_ENT_REF|COD_CCUS|COD_CTA_REF|      (leiaute com centro de custo)
 *     |I051|COD_ENT_REF|COD_CTA_REF|               (leiaute sem)
 *
 * Ler por posição fixa — `fields[4]` — funciona num e devolve string
 * vazia no outro, EM SILÊNCIO. Foi exatamente o que aconteceu com o
 * arquivo do Georg:
 *
 *     |I051||1.01.01.01.01|
 *      ^     ^
 *      |     fields[3]: o código estrutural, aqui
 *      fields[4]: vazio — era o que eu lia
 *
 * O resultado foi pior do que um erro: 412 contas entraram sem código
 * referencial, o banco mostrou `cod_referencial` nulo em tudo, e eu
 * conclui do MEU PRÓPRIO SILÊNCIO que o arquivo não trazia I051.
 *
 * Lendo o último campo, os dois leiautes funcionam — e um COD_CTA_REF
 * legitimamente vazio continua vazio, sem pegar o centro de custo por
 * engano (ele fica antes, e o último campo é a string vazia).
 */
function ultimoCampo(rawLine: string, fields: string[]): string {
  // Uma linha SPED termina em "|", então o split produz um "" no fim que
  // não é campo nenhum. Arquivo sem o "|" final também existe: aí o
  // último elemento É o campo.
  const fim = rawLine.trimEnd().endsWith("|") ? fields.length - 1 : fields.length;
  if (fim <= 2) return "";

  const ultimo = (fields[fim - 1] || "").trim();
  if (ultimo) return ultimo;

  // O último campo veio vazio. Duas explicações, e elas se distinguem:
  //
  //   · o registro realmente não tem o código (COD_CTA_REF em branco,
  //     centro de custo preenchido) → devolver vazio é o certo;
  //   · o emissor escreveu um "|" a mais no fim.
  //
  // Só recuo quando o que encontro TEM CARA DE CÓDIGO DE PLANO — dígitos
  // separados por ponto. Um centro de custo ("CC001", "001") não passa,
  // e é por isso que a volta atrás não inventa vínculo.
  for (let i = fim - 2; i >= 2; i--) {
    const v = (fields[i] || "").trim();
    if (!v) continue;
    return /^\d+(\.\d+)+$/.test(v) ? v : "";
  }
  return "";
}

export function parseSpedContabil(content: string): SpedParseResult {
  const warnings: string[] = [];
  const planoContas: ContaContabil[] = [];
  const saldos: SaldoConta[] = [];
  const lancamentos: LancamentoEcd[] = [];
  const demonstracoes: LinhaDemonstracao[] = [];

  let cnpj = "";
  let razaoSocial = "";
  let periodoInicio = "";
  let periodoFim = "";

  // A conta I050 aberta no momento — I051/I052 penduram nela.
  let ultimaConta: ContaContabil | null = null;
  // O lançamento I200 aberto — as partidas I250 pendem dele.
  let lctoNumero = "";
  let lctoData = "";
  let currentDtIni = "";
  let currentDtFin = "";

  // Contexto da demonstração atual (J005)
  let currentDemoTipo = "";
  let currentDemoPeriodo = "";
  let demoOrdem = 0;

  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const fields = rawLine.split("|");
    const reg = fields[1];
    if (!reg) continue;

    switch (reg) {
      case "0000": {
        // |0000|LECD|DT_INI|DT_FIN|NOME|CNPJ|UF|...
        periodoInicio = parseSpedDate(fields[3]);
        periodoFim = parseSpedDate(fields[4]);
        razaoSocial = fields[5] || "";
        cnpj = (fields[6] || "").replace(/\D/g, "");
        break;
      }

      case "I050": {
        // |I050|DT_ALT|COD_NAT|IND_CTA|NIVEL|COD_CTA|COD_CTA_SUP|CTA_DESCR|
        const natureza = ((fields[3] || "").trim() || "D") as "D" | "C" | "P";
        const tipo = (((fields[4] || "").trim() as "A" | "S") || "A");
        const nivel = parseInt(fields[5] || "0", 10) || 0;
        const codigo = (fields[6] || "").trim();
        const parent = (fields[7] || "").trim() || null;
        const nome = (fields[8] || "").trim();
        if (codigo) {
          planoContas.push({
            codigo_conta: codigo,
            nome_conta: nome,
            nivel,
            tipo_conta: tipo,
            natureza,
            parent_codigo: parent,
            cod_referencial: null,
            cod_aglutinacao: null,
          });
          // I051/I052 vêm DEPOIS do I050 e pertencem a ele.
          ultimaConta = planoContas[planoContas.length - 1];
        }
        break;
      }

      case "I051": {
        // |I051|COD_ENT_REF|COD_CCUS|COD_CTA_REF|   ← leiaute com centro de custo
        // |I051|COD_ENT_REF|COD_CTA_REF|            ← leiaute sem
        //
        // O código da conta no plano REFERENCIAL. É sempre o ÚLTIMO
        // campo; ler por posição fixa perde um dos dois leiautes calado.
        const ref = ultimoCampo(rawLine, fields);
        if (ultimaConta && ref && !ultimaConta.cod_referencial) {
          ultimaConta.cod_referencial = ref;
        }
        break;
      }

      case "I052": {
        // |I052|COD_CCUS|COD_AGL|
        // O código de AGLUTINAÇÃO: é por ele que o próprio ECD monta as
        // demonstrações do bloco J. Quando existe, é o código estrutural
        // do plano da empresa — exatamente o que falta na tela quando o
        // I050 traz só o reduzido.
        //
        // Mesma armadilha do I051: COD_AGL é o último campo, e o centro
        // de custo antes dele pode estar ou não presente.
        const agl = ultimoCampo(rawLine, fields);
        if (ultimaConta && agl && !ultimaConta.cod_aglutinacao) {
          ultimaConta.cod_aglutinacao = agl;
        }
        break;
      }

      case "I200": {
        // |I200|NUM_LCTO|DT_LCTO|VL_LCTO|IND_LCTO|DT_LCTO_EXT|
        lctoNumero = (fields[2] || "").trim();
        lctoData = parseSpedDate(fields[3]);
        break;
      }

      case "I250": {
        // |I250|COD_CTA|COD_CCUS|VL_DC|IND_DC|NUM_ARQ|COD_PART|COD_HIST|HIST_COMPL|
        //
        // `IND_DC` decide o lado; o valor vem sempre positivo. Guardar
        // como duas colunas (débito/crédito) em vez de um valor com sinal
        // é o que o resto do sistema usa — e é o que permite conferir
        // partida dobrada.
        const cta = (fields[2] || "").trim();
        const valor = parseNumber(fields[4]);
        const dc = (fields[5] || "").trim().toUpperCase();
        const hist = (fields[9] || "").trim();
        if (cta && lctoData) {
          lancamentos.push({
            numero: lctoNumero,
            data: lctoData,
            codigo_conta: cta,
            debito: dc === "D" ? valor : 0,
            credito: dc === "C" ? valor : 0,
            historico: hist,
          });
        }
        break;
      }

      case "I150": {
        currentDtIni = parseSpedDate(fields[2]);
        currentDtFin = parseSpedDate(fields[3]);
        break;
      }

      case "I155": {
        // |I155|COD_CTA|COD_CCUS|VL_SLD_INI|IND_DC_INI|VL_DEB|VL_CRED|VL_SLD_FIN|IND_DC_FIN|...
        const codigo = (fields[2] || "").trim();
        const saldoInicialRaw = parseNumber(fields[4]);
        const indDcIni = (fields[5] || "").trim();
        const debitos = parseNumber(fields[6]);
        const creditos = parseNumber(fields[7]);
        const saldoFinalRaw = parseNumber(fields[8]);
        const indDcFin = (fields[9] || "").trim();
        // C = saldo credor → exibir negativo na perspectiva do plano (devedor)
        const si = aplicarSinal(saldoInicialRaw, indDcIni, ["C"]);
        const sf = aplicarSinal(saldoFinalRaw, indDcFin, ["C"]);
        if (codigo && currentDtIni) {
          saldos.push({
            codigo_conta: codigo,
            periodo: currentDtIni,
            saldo_inicial: si,
            debitos,
            creditos,
            saldo_final: sf,
          });
        }
        break;
      }

      case "J005": {
        // |J005|DT_INI|DT_FIN|ID_DEM|CAB_DEM|
        const idDem = (fields[4] || "").trim();
        currentDemoTipo = TIPO_DEMO_MAP[idDem] || `DEMO_${idDem}`;
        currentDemoPeriodo = parseSpedDate(fields[3]) || periodoFim;
        demoOrdem = 0;
        break;
      }

      case "J100": {
        // |J100|COD_AGL|IND_GRP_BAL_NAT|NIVEL|COD_AGL_SUP|IND_GRP_BAL|DESCR|VL_CTA|IND_VL|VL_CTA_INI|IND_VL_INI|
        const codigoAgl = (fields[2] || "").trim() || null;
        const indGrpTipo = (fields[3] || "").trim().toUpperCase(); // T/S/D/A
        const nivel = parseInt(fields[4] || "0", 10) || 0;
        const indGrpBal = (fields[6] || "").trim().toUpperCase(); // A=Ativo, P=Passivo+PL
        const desc = (fields[7] || "").trim();
        const valor = parseNumber(fields[8]);
        const indVl = (fields[9] || "").trim().toUpperCase();
        const valorAnt = parseNumber(fields[10]);
        const indVlAnt = (fields[11] || "").trim().toUpperCase();

        if (!desc || !currentDemoTipo) break;

        // Definir tipo final e regra de sinal
        let tipoBase = currentDemoTipo;
        let negSet: string[] = [];

        if (currentDemoTipo === "BP") {
          tipoBase = indGrpBal === "P" ? "BP_PASSIVO" : "BP_ATIVO";
          // Ativo: D positivo, C negativo (depreciações etc).
          // Passivo: C positivo, D negativo.
          negSet = indGrpBal === "P" ? ["D", "N"] : ["C", "N"];
        } else if (currentDemoTipo === "DRE") {
          // Receitas (C) positivas, despesas (D) negativas.
          negSet = ["D", "N"];
        } else if (currentDemoTipo === "DFC") {
          // Entradas (C) positivas, saídas (D) negativas.
          negSet = ["D", "N"];
        } else {
          // DVA, DLPA, DMPL — usa o sinal do indicador
          negSet = ["D", "N"];
        }

        const signed = aplicarSinal(valor, indVl, negSet);
        const signedAnt = aplicarSinal(valorAnt, indVlAnt, negSet);
        const periodoUse = currentDemoPeriodo || periodoFim;
        const isSubtotal = indGrpTipo === "T" || indGrpTipo === "S";

        demoOrdem++;
        demonstracoes.push({
          tipo_demonstracao: tipoBase,
          periodo: periodoUse,
          linha_ordem: demoOrdem,
          descricao: desc,
          codigo_conta: codigoAgl,
          valor: signed,
          nivel,
          is_subtotal: isSubtotal,
        });

        if (valorAnt !== 0 && periodoUse) {
          const prev = prevYearPeriod(periodoUse);
          if (prev) {
            demonstracoes.push({
              tipo_demonstracao: tipoBase,
              periodo: prev,
              linha_ordem: demoOrdem,
              descricao: desc,
              codigo_conta: codigoAgl,
              valor: signedAnt,
              nivel,
              is_subtotal: isSubtotal,
            });
          }
        }
        break;
      }

      case "J150": {
        // |J150|NUM_ORD|COD_AGL|IND_GRP_BAL|NIVEL|COD_AGL_SUP|DESCR|VL_CTA|IND_VL|VL_CTA_INI|IND_VL_INI|IND_RES_PER|
        const ord = parseInt(fields[2] || "0", 10) || ++demoOrdem;
        const codigoAgl = (fields[3] || "").trim() || null;
        const indGrpTipo = (fields[4] || "").trim().toUpperCase();
        const nivel = parseInt(fields[5] || "0", 10) || 0;
        const desc = (fields[7] || "").trim();
        const valor = parseNumber(fields[8]);
        const indVl = (fields[9] || "").trim().toUpperCase();
        const valorAnt = parseNumber(fields[10]);
        const indVlAnt = (fields[11] || "").trim().toUpperCase();
        const signed = aplicarSinal(valor, indVl, ["D", "N"]);
        const signedAnt = aplicarSinal(valorAnt, indVlAnt, ["D", "N"]);
        const periodoUse = currentDemoPeriodo || periodoFim;
        const isSubtotal = indGrpTipo === "T" || indGrpTipo === "S";

        if (!desc) break;
        demonstracoes.push({
          tipo_demonstracao: "DRE",
          periodo: periodoUse,
          linha_ordem: ord,
          descricao: desc,
          codigo_conta: codigoAgl,
          valor: signed,
          nivel,
          is_subtotal: isSubtotal,
        });
        if (valorAnt !== 0 && periodoUse) {
          const prev = prevYearPeriod(periodoUse);
          if (prev) {
            demonstracoes.push({
              tipo_demonstracao: "DRE",
              periodo: prev,
              linha_ordem: ord,
              descricao: desc,
              codigo_conta: codigoAgl,
              valor: signedAnt,
              nivel,
              is_subtotal: isSubtotal,
            });
          }
        }
        break;
      }

      case "J200":
      case "J210":
      case "J215": {
        // DLPA / DMPL simplificado: tenta extrair descrição e valor
        const codigoAgl = (fields[3] || "").trim() || null;
        const desc = (fields[4] || fields[5] || "").trim();
        const valor = parseNumber(fields[6] || fields[7]);
        if (desc) {
          demoOrdem++;
          demonstracoes.push({
            tipo_demonstracao: "DLPA",
            periodo: currentDemoPeriodo || periodoFim,
            linha_ordem: demoOrdem,
            descricao: desc,
            codigo_conta: codigoAgl,
            valor,
            nivel: 0,
            is_subtotal: false,
          });
        }
        break;
      }

      default:
        break;
    }
  }

  if (!cnpj) warnings.push("CNPJ não encontrado no registro 0000.");
  if (planoContas.length === 0) warnings.push("Nenhuma conta encontrada (I050).");
  if (demonstracoes.length === 0)
    warnings.push("Nenhuma demonstração encontrada nos blocos J100/J150.");

  // ============ Validações pós-processamento ============
  const validacoes: ValidationResult[] = [];

  // Equilíbrio do Balanço por período
  const periodosBP = new Set(
    demonstracoes
      .filter((d) => d.tipo_demonstracao.startsWith("BP_"))
      .map((d) => d.periodo),
  );
  for (const per of periodosBP) {
    const totalAtivo = demonstracoes
      .filter(
        (d) => d.tipo_demonstracao === "BP_ATIVO" && d.periodo === per && d.nivel <= 1,
      )
      .reduce((acc, d) => acc + d.valor, 0);
    const totalPassivo = demonstracoes
      .filter(
        (d) => d.tipo_demonstracao === "BP_PASSIVO" && d.periodo === per && d.nivel <= 1,
      )
      .reduce((acc, d) => acc + d.valor, 0);
    const diff = Math.abs(totalAtivo - totalPassivo);
    validacoes.push({
      nome: `Equilíbrio do Balanço (${per})`,
      passou: diff < 0.01,
      severidade: "error",
      detalhe: diff < 0.01
        ? undefined
        : `Diferença de R$ ${diff.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    });
  }

  // LL DRE = LL DLPA (heurística por nome)
  const ehLucroLiquido = (s: string) =>
    /lucro.+l[ií]quido|preju[ií]zo.+l[ií]quido|resultado.+l[ií]quido/i.test(s);
  const llDre = demonstracoes
    .filter((d) => d.tipo_demonstracao === "DRE" && ehLucroLiquido(d.descricao))
    .reduce((acc, d) => acc + d.valor, 0);
  const llDlpa = demonstracoes
    .filter((d) => d.tipo_demonstracao === "DLPA" && ehLucroLiquido(d.descricao))
    .reduce((acc, d) => acc + d.valor, 0);
  if (llDre !== 0 || llDlpa !== 0) {
    validacoes.push({
      nome: "LL coincide entre DRE e DLPA",
      passou: Math.abs(llDre - llDlpa) < 0.01,
      severidade: "warning",
      detalhe:
        Math.abs(llDre - llDlpa) < 0.01
          ? undefined
          : `DRE=${llDre.toFixed(2)} vs DLPA=${llDlpa.toFixed(2)}`,
    });
  }

  return {
    empresa: { cnpj, razaoSocial, periodoInicio, periodoFim },
    planoContas,
    saldos,
    lancamentos,
    demonstracoes,
    warnings,
    validacoes,
  };
}
