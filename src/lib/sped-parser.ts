/**
 * Parser do SPED Contábil (ECD) — IN RFB 1.422/2013
 * Lê o arquivo .txt e extrai: identificação, plano de contas (I050),
 * saldos (I155) e demonstrações (J005/J100).
 */

export interface ContaContabil {
  codigo_conta: string;
  nome_conta: string;
  nivel: number;
  tipo_conta: "A" | "S";
  natureza: "D" | "C" | "P";
  parent_codigo: string | null;
}

export interface SaldoConta {
  codigo_conta: string;
  periodo: string; // ISO yyyy-mm-dd
  saldo_inicial: number;
  debitos: number;
  creditos: number;
  saldo_final: number;
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

export interface SpedParseResult {
  empresa: {
    cnpj: string;
    razaoSocial: string;
    periodoInicio: string;
    periodoFim: string;
  };
  planoContas: ContaContabil[];
  saldos: SaldoConta[];
  demonstracoes: LinhaDemonstracao[];
  warnings: string[];
}

const TIPO_DEMO_MAP: Record<string, string> = {
  "01": "BP_ATIVO",
  "02": "BP_PASSIVO",
  "03": "DRE",
  "04": "DLPA",
  "05": "DFC",
  "06": "DVA",
};

function parseNumber(s: string | undefined): number {
  if (!s) return 0;
  // SPED usa vírgula como separador decimal
  const cleaned = s.trim().replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseSpedDate(s: string | undefined): string {
  // formato ddmmaaaa
  if (!s || s.length !== 8) return new Date().toISOString().slice(0, 10);
  const day = s.slice(0, 2);
  const month = s.slice(2, 4);
  const year = s.slice(4, 8);
  return `${year}-${month}-${day}`;
}

export function parseSpedContabil(content: string): SpedParseResult {
  const warnings: string[] = [];
  const planoContas: ContaContabil[] = [];
  const saldos: SaldoConta[] = [];
  const demonstracoes: LinhaDemonstracao[] = [];

  let cnpj = "";
  let razaoSocial = "";
  let periodoInicio = "";
  let periodoFim = "";

  // contexto para I150/I155 (período do saldo)
  let currentDtIni = "";
  let currentDtFin = "";

  // contexto para J005/J100 (demonstração atual)
  let currentDemoTipo = "";
  let currentDemoPeriodo = "";
  let demoOrdem = 0;

  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    // Cada linha começa e termina com |, campos delimitados por |
    const fields = rawLine.split("|");
    // fields[0] = "" (antes do primeiro |), fields[1] = registro
    const reg = fields[1];
    if (!reg) continue;

    switch (reg) {
      case "0000": {
        // |0000|LECD|DT_INI|DT_FIN|NOME|CNPJ|UF|IE|COD_MUN|IM|IND_SIT_ESP|...
        periodoInicio = parseSpedDate(fields[3]);
        periodoFim = parseSpedDate(fields[4]);
        razaoSocial = fields[5] || "";
        cnpj = fields[6] || "";
        break;
      }
      case "I050": {
        // |I050|DT_ALT|COD_NAT|IND_CTA|NIVEL|COD_CTA|COD_CTA_SUP|CTA_DESCR|
        const natureza = (fields[3] || "").trim() as "D" | "C" | "P";
        const tipo = ((fields[4] || "").trim() as "A" | "S") || "A";
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
          });
        }
        break;
      }
      case "I150": {
        // |I150|DT_INI|DT_FIN|
        currentDtIni = parseSpedDate(fields[2]);
        currentDtFin = parseSpedDate(fields[3]);
        break;
      }
      case "I155": {
        // |I155|COD_CTA|COD_CCUS|VL_SLD_INI|IND_DC_INI|VL_DEB|VL_CRED|VL_SLD_FIN|IND_DC_FIN|...
        const codigo = (fields[2] || "").trim();
        const saldoInicial = parseNumber(fields[4]);
        const indDcIni = (fields[5] || "").trim();
        const debitos = parseNumber(fields[6]);
        const creditos = parseNumber(fields[7]);
        const saldoFinal = parseNumber(fields[8]);
        const indDcFin = (fields[9] || "").trim();
        // Aplicar sinal: saldo C tradicionalmente negativo na perspectiva devedora
        const si = indDcIni === "C" ? -saldoInicial : saldoInicial;
        const sf = indDcFin === "C" ? -saldoFinal : saldoFinal;
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
        currentDemoPeriodo = parseSpedDate(fields[3]); // usar DT_FIN como período
        demoOrdem = 0;
        break;
      }
      case "J100": {
        // |J100|COD_AGL|NIVEL_AGL|COD_NAT|IND_GRP_BAL|DESCR_COD_AGL|VL_CTA|IND_VL|VL_CTA_REF|IND_VL_REF|
        const codigoAgl = (fields[2] || "").trim() || null;
        const nivel = parseInt(fields[3] || "0", 10) || 0;
        const indGrp = (fields[5] || "").trim();
        const desc = (fields[6] || "").trim();
        const valor = parseNumber(fields[7]);
        const indVl = (fields[8] || "").trim();
        const signedValor = indVl === "N" ? -valor : valor;
        demoOrdem++;
        if (currentDemoTipo && desc) {
          demonstracoes.push({
            tipo_demonstracao: currentDemoTipo,
            periodo: currentDemoPeriodo,
            linha_ordem: demoOrdem,
            descricao: desc,
            codigo_conta: codigoAgl,
            valor: signedValor,
            nivel,
            is_subtotal: indGrp === "S" || indGrp === "T",
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

  return {
    empresa: { cnpj, razaoSocial, periodoInicio, periodoFim },
    planoContas,
    saldos,
    demonstracoes,
    warnings,
  };
}
