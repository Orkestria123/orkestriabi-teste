/**
 * Parser do SPED Fiscal (EFD ICMS/IPI).
 * Foca nos registros essenciais para análise de fornecedores e notas fiscais:
 *  - 0000: cabeçalho (período, CNPJ)
 *  - 0150: cadastro de participantes (fornecedores/clientes)
 *  - C100: notas fiscais (modelo, série, valores)
 *  - C170: itens de nota (opcional; limitamos volume)
 */

export interface FiscalParticipant {
  cnpj_cpf: string;
  nome: string | null;
  uf: string | null;
  municipio: string | null;
  ie: string | null;
}

export interface FiscalInvoice {
  tipo: "E" | "S";
  participant_cnpj: string | null;
  modelo: string | null;
  serie: string | null;
  numero: string | null;
  chave_nfe: string | null;
  data_emissao: string | null; // yyyy-mm-dd
  data_entrada_saida: string | null;
  cancelada: boolean;
  valor_total: number;
  valor_produtos: number;
  valor_desconto: number;
  valor_frete: number;
  valor_icms: number;
  valor_icms_st: number;
  valor_ipi: number;
  valor_pis: number;
  valor_cofins: number;
  itens: FiscalInvoiceItem[];
}

export interface FiscalInvoiceItem {
  num_item: number | null;
  codigo_produto: string | null;
  descricao: string | null;
  quantidade: number | null;
  unidade: string | null;
  valor_total: number;
  valor_desconto: number;
  cfop: string | null;
  ncm: string | null;
}

export interface ParsedSpedFiscal {
  empresa: { cnpj: string | null; periodoInicio: string | null; periodoFim: string | null };
  participants: FiscalParticipant[];
  invoices: FiscalInvoice[];
}

const MAX_ITEMS_PER_INVOICE = 200;

function parseDate(s: string | undefined): string | null {
  if (!s || s.length !== 8) return null;
  const dd = s.slice(0, 2);
  const mm = s.slice(2, 4);
  const yyyy = s.slice(4, 8);
  return `${yyyy}-${mm}-${dd}`;
}

function parseNum(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
}

function digits(s: string | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

export function isSpedFiscal(content: string): boolean {
  // Cabeçalho do EFD ICMS/IPI: |0000|<COD_VER>|0|... onde código de finalidade aparece com "LECF"? não.
  // EFD ICMS/IPI usa registro 0005, 0100 etc. SPED Contábil (ECD) usa I000/J005.
  // Detecção robusta: ausência do registro J005/I001 ECD + presença de registros do Bloco C (C100).
  const head = content.slice(0, 4000);
  if (/^\|0000\|/.test(head) && /\|0150\|/.test(content) === false && /\|C100\|/.test(content) === false) {
    return false;
  }
  // Possui C100 e não possui J005 (J005 é ECD)
  const hasC100 = /\n\|C100\|/.test(content) || /^\|C100\|/m.test(content);
  const hasJ005 = /\|J005\|/.test(content);
  const hasI001 = /\|I001\|/.test(content) && /\|I050\|/.test(content);
  return hasC100 && !hasJ005 && !hasI001;
}

export function parseSpedFiscal(content: string): ParsedSpedFiscal {
  const lines = content.split(/\r?\n/);
  const out: ParsedSpedFiscal = {
    empresa: { cnpj: null, periodoInicio: null, periodoFim: null },
    participants: [],
    invoices: [],
  };

  const participantsMap = new Map<string, FiscalParticipant>();
  let currentInvoice: FiscalInvoice | null = null;

  for (const raw of lines) {
    if (!raw || raw[0] !== "|") continue;
    const f = raw.split("|");
    // f[0]="" f[1]=REG ...
    const reg = f[1];

    switch (reg) {
      case "0000": {
        // |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|UF|IE|COD_MUN|IM|SUFRAMA|IND_PERFIL|IND_ATIV|
        out.empresa.cnpj = digits(f[7]) || null;
        out.empresa.periodoInicio = parseDate(f[4]);
        out.empresa.periodoFim = parseDate(f[5]);
        break;
      }
      case "0150": {
        // |0150|COD_PART|NOME|COD_PAIS|CNPJ|CPF|IE|COD_MUN|SUFRAMA|END|NUM|COMPL|BAIRRO|
        const cnpj = digits(f[5]) || digits(f[6]);
        if (!cnpj) break;
        if (!participantsMap.has(cnpj)) {
          participantsMap.set(cnpj, {
            cnpj_cpf: cnpj,
            nome: (f[3] ?? "").trim() || null,
            uf: null,
            municipio: f[9] ?? null, // COD_MUN (IBGE) — sem decode aqui
            ie: (f[7] ?? "").trim() || null,
          });
        }
        break;
      }
      case "C100": {
        // |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|IND_PGTO|VL_DESC|VL_ABAT_NT|VL_MERC|IND_FRT|VL_FRT|VL_SEG|VL_OUT_DA|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_IPI|VL_PIS|VL_COFINS|VL_PIS_ST|VL_COFINS_ST|
        const indOper = f[2]; // 0=Entrada, 1=Saída
        const codPart = (f[4] ?? "").trim();
        const codSit = f[6]; // 02/03/04 = cancelada/denegada
        const partCnpj = (() => {
          // 0150 usa COD_PART como código interno; o cnpj real precisa ser resolvido por COD_PART.
          // Tentamos casar com 0150 mais tarde via map do código interno → cnpj.
          return codPart || null;
        })();
        currentInvoice = {
          tipo: indOper === "0" ? "E" : "S",
          participant_cnpj: partCnpj,
          modelo: (f[5] ?? "").trim() || null,
          serie: (f[7] ?? "").trim() || null,
          numero: (f[8] ?? "").trim() || null,
          chave_nfe: (f[9] ?? "").trim() || null,
          data_emissao: parseDate(f[10]),
          data_entrada_saida: parseDate(f[11]),
          cancelada: ["02", "03", "04", "05"].includes((codSit ?? "").padStart(2, "0")),
          valor_total: parseNum(f[12]),
          valor_desconto: parseNum(f[14]),
          valor_produtos: parseNum(f[16]),
          valor_frete: parseNum(f[18]),
          valor_icms: parseNum(f[22]),
          valor_icms_st: parseNum(f[24]),
          valor_ipi: parseNum(f[25]),
          valor_pis: parseNum(f[26]),
          valor_cofins: parseNum(f[27]),
          itens: [],
        };
        out.invoices.push(currentInvoice);
        break;
      }
      case "C170": {
        // |C170|NUM_ITEM|COD_ITEM|DESCR_COMPL|QTD|UNID|VL_ITEM|VL_DESC|IND_MOV|CST_ICMS|CFOP|...
        if (!currentInvoice) break;
        if (currentInvoice.itens.length >= MAX_ITEMS_PER_INVOICE) break;
        currentInvoice.itens.push({
          num_item: f[2] ? Number(f[2]) || null : null,
          codigo_produto: (f[3] ?? "").trim() || null,
          descricao: (f[4] ?? "").trim() || null,
          quantidade: f[5] ? parseNum(f[5]) : null,
          unidade: (f[6] ?? "").trim() || null,
          valor_total: parseNum(f[7]),
          valor_desconto: parseNum(f[8]),
          cfop: (f[11] ?? "").trim() || null,
          ncm: null,
        });
        break;
      }
      case "C190":
      case "C195":
      case "C500":
      case "D100":
        // outros tipos de documento — encerra acúmulo da nota corrente
        break;
      default:
        break;
    }
  }

  // 0150 mapeia COD_PART → cnpj. Refazemos uma passada para extrair COD_PART → CNPJ
  const codPartToCnpj = new Map<string, string>();
  for (const raw of lines) {
    if (!raw.startsWith("|0150|")) continue;
    const f = raw.split("|");
    const codPart = (f[2] ?? "").trim();
    const cnpj = digits(f[5]) || digits(f[6]);
    if (codPart && cnpj) codPartToCnpj.set(codPart, cnpj);
  }

  // Reconcilia participant_cnpj das notas (substitui COD_PART pelo CNPJ real)
  for (const inv of out.invoices) {
    if (inv.participant_cnpj && codPartToCnpj.has(inv.participant_cnpj)) {
      inv.participant_cnpj = codPartToCnpj.get(inv.participant_cnpj) ?? inv.participant_cnpj;
    } else if (inv.participant_cnpj && /^\d{11,14}$/.test(inv.participant_cnpj)) {
      // já é um CNPJ/CPF numérico
    } else {
      inv.participant_cnpj = null;
    }
  }

  out.participants = Array.from(participantsMap.values());
  return out;
}
