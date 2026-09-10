// Alocações da DFC em planilha: exportar para conferir, importar de volta.
//
// A alocação é um vínculo por CLASSIFICAÇÃO — poucas dezenas de linhas
// que alcançam as 135.000 contas por prefixo. Isso é ótimo para
// configurar e ruim para CONFERIR: olhando a tela não dá para saber se
// cada conta caiu onde devia.
//
// A planilha sai por CLASSIFICAÇÃO, não conta a conta. O motivo é o
// volume: 113.097 contas dividem a classificação 1.01.02.01.01.01 e
// todas recebem, por construção, o mesmo código. Uma planilha conta a
// conta teria 135.000 linhas repetindo umas poucas centenas de decisões
// — ninguém confere isso. O peso de cada linha aparece nas colunas
// "Contas" e "Com movimento".

import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

export interface LinhaAlocacao {
  classificacao: string;
  descricao: string;
  contas: number;
  analiticas: number;
  com_movimento: number;
  codigo_dfc: string | null;
  descricao_dfc: string | null;
  bloco: string | null;
  classificacao_vinculo: string | null;
  origem: string;
  ambiguo: boolean;
}

export interface ExcecaoConta {
  codigo: string;
  classificacao: string;
  descricao: string;
  codigo_na_conta: string;
  codigo_efetivo: string | null;
  em_vigor: boolean;
}

export interface CodigoDfc {
  codigo: string;
  descricao: string;
  bloco: string;
  ordem: number;
}

/** Cabeçalhos da planilha. A importação aceita estes nomes de volta. */
const COL = {
  classificacao: "Classificação",
  descricao: "Conta",
  contas: "Contas",
  analiticas: "Analíticas",
  movimento: "Com movimento",
  codigoDfc: "Código DFC",
  descricaoDfc: "Descrição do código",
  bloco: "Bloco",
  vinculo: "Vínculo veio de",
  origem: "Origem",
  conflito: "Conflito",
} as const;

export async function carregarAlocacoes(
  tenantId: string,
  companyId: string | null = null,
  somenteBalanco = true,
): Promise<LinhaAlocacao[]> {
  const { data, error } = await (supabase as any).rpc("dfc_exportar", {
    _tenant_id: tenantId,
    _company_id: companyId,
    _somente_balanco: somenteBalanco,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as LinhaAlocacao[];
}

export async function carregarExcecoes(
  tenantId: string,
  companyId: string | null = null,
): Promise<ExcecaoConta[]> {
  const { data, error } = await (supabase as any).rpc("dfc_exportar_contas", {
    _tenant_id: tenantId,
    _company_id: companyId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ExcecaoConta[];
}

export async function carregarCatalogoDfc(): Promise<CodigoDfc[]> {
  const { data, error } = await (supabase as any)
    .from("dfc_catalogo")
    .select("codigo, descricao, bloco, ordem")
    .order("ordem");
  if (error) throw new Error(error.message);
  return (data ?? []) as CodigoDfc[];
}

/**
 * Gera o arquivo. Três abas:
 *
 *   Alocação            é onde se confere e onde se corrige
 *   Exceções por conta  códigos gravados direto numa conta — normalmente
 *                       vazia; quando não está, é aqui que mora o motivo
 *                       de uma alteração "não pegar"
 *   Códigos DFC         o catálogo, para consultar sem decorar
 *
 * A importação lê a aba "Alocação" (ou a primeira que tiver as colunas),
 * então o arquivo exportado volta sem precisar de preparo.
 */
export function gerarPlanilhaDfc(
  linhas: LinhaAlocacao[],
  excecoes: ExcecaoConta[],
  catalogo: CodigoDfc[],
  nomeArquivo: string,
) {
  XLSX.writeFile(montarWorkbookDfc(linhas, excecoes, catalogo), `${nomeArquivo}.xlsx`);
}

/**
 * Monta o workbook sem escrever em disco — é o que o teste de ida e
 * volta usa. Separado de propósito: o que é testado tem que ser o mesmo
 * arquivo que o usuário baixa, não uma reimplementação parecida.
 */
export function montarWorkbookDfc(
  linhas: LinhaAlocacao[],
  excecoes: ExcecaoConta[],
  catalogo: CodigoDfc[],
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const aloc = [
    [COL.classificacao, COL.descricao, COL.contas, COL.analiticas, COL.movimento,
     COL.codigoDfc, COL.descricaoDfc, COL.bloco, COL.vinculo, COL.origem, COL.conflito],
    ...linhas.map((l) => [
      l.classificacao, l.descricao, l.contas, l.analiticas, l.com_movimento,
      l.codigo_dfc ?? "", l.descricao_dfc ?? "", l.bloco ?? "",
      l.classificacao_vinculo ?? "", l.origem,
      l.ambiguo ? "contas com códigos diferentes" : "",
    ]),
  ];
  const wsAloc = XLSX.utils.aoa_to_sheet(aloc);
  wsAloc["!cols"] = [
    { wch: 20 }, { wch: 42 }, { wch: 8 }, { wch: 10 }, { wch: 14 },
    { wch: 11 }, { wch: 34 }, { wch: 15 }, { wch: 20 }, { wch: 14 }, { wch: 28 },
  ];
  wsAloc["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsAloc, "Alocação");

  const wsExc = XLSX.utils.aoa_to_sheet([
    ["Código da conta", COL.classificacao, COL.descricao,
     "Código gravado na conta", "Código em uso", "Ainda vale?"],
    ...excecoes.map((e) => [
      e.codigo, e.classificacao, e.descricao,
      e.codigo_na_conta, e.codigo_efetivo ?? "", e.em_vigor ? "sim" : "não",
    ]),
  ]);
  wsExc["!cols"] = [{ wch: 16 }, { wch: 20 }, { wch: 42 }, { wch: 22 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsExc, "Exceções por conta");

  const wsCat = XLSX.utils.aoa_to_sheet([
    ["Código", "Descrição", "Bloco na DFC"],
    ...catalogo.map((c) => [c.codigo, c.descricao, c.bloco]),
  ]);
  wsCat["!cols"] = [{ wch: 10 }, { wch: 46 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsCat, "Códigos DFC");
  return wb;
}

export interface LinhaImportada {
  classificacao: string;
  codigo_dfc: string | null;
}

export interface ResultadoLeitura {
  linhas: LinhaImportada[];
  aba: string;
  ignoradas: number;
  avisos: string[];
}

const norm = (s: unknown) =>
  String(s ?? "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Aceita os cabeçalhos do próprio export e algumas variações comuns. */
const ALIAS_CLASSIF = ["classificacao", "classif", "conta contabil", "mascara"];
const ALIAS_CODIGO = ["codigo dfc", "codigo_dfc", "dfc", "codigo"];
const ALIAS_CODIGO_ESTRITO = ["codigo dfc", "codigo_dfc"];

/**
 * Lê o arquivo e devolve as linhas de vínculo.
 *
 * Procura a aba que TEM as duas colunas, em vez de exigir a primeira ou
 * um nome fixo: assim funciona tanto com o arquivo exportado quanto com
 * uma planilha montada à mão.
 */
export async function lerPlanilhaDfc(arquivo: File): Promise<ResultadoLeitura> {
  return lerWorkbookDfc(XLSX.read(await arquivo.arrayBuffer(), { type: "array" }));
}

/** Mesma leitura, a partir do workbook já aberto (usado no teste). */
export function lerWorkbookDfc(wb: XLSX.WorkBook): ResultadoLeitura {
  for (const nomeAba of wb.SheetNames) {
    // A aba de exceções também tem "Classificação" e um código — mas não
    // é configuração, é diagnóstico. Fica de fora da leitura.
    if (norm(nomeAba).startsWith("excecoes")) continue;

    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets[nomeAba], { defval: "" },
    );
    if (linhas.length === 0) continue;

    const cabecalhos = Object.keys(linhas[0]);
    const colCls = cabecalhos.find((c) => ALIAS_CLASSIF.includes(norm(c)));
    // "Código DFC" antes de "Código": senão pega o código da conta
    const colCod =
      cabecalhos.find((c) => ALIAS_CODIGO_ESTRITO.includes(norm(c))) ??
      cabecalhos.find((c) => ALIAS_CODIGO.includes(norm(c)));
    if (!colCls || !colCod) continue;

    const avisos: string[] = [];
    const out: LinhaImportada[] = [];
    let ignoradas = 0;
    for (const l of linhas) {
      const cls = String(l[colCls] ?? "").trim();
      const cod = String(l[colCod] ?? "").trim().toUpperCase();
      if (!cls) { ignoradas++; continue; }
      out.push({ classificacao: cls, codigo_dfc: cod || null });
    }

    // Duas linhas da mesma classificação com códigos diferentes é
    // ambiguidade — melhor avisar do que escolher uma em silêncio.
    const porCls = new Map<string, Set<string>>();
    for (const l of out) {
      const s = porCls.get(l.classificacao) ?? new Set<string>();
      s.add(l.codigo_dfc ?? "");
      porCls.set(l.classificacao, s);
    }
    for (const [cls, cods] of porCls) {
      if (cods.size > 1) {
        avisos.push(
          `${cls}: a planilha tem códigos diferentes para a mesma classificação ` +
          `(${[...cods].map((c) => c || "vazio").join(", ")}) — vai valer o primeiro.`,
        );
      }
    }

    return { linhas: out, aba: nomeAba, ignoradas, avisos };
  }

  throw new Error(
    'Nenhuma aba tem as colunas "Classificação" e "Código DFC". ' +
    "Exporte a planilha primeiro e edite o arquivo gerado.",
  );
}

export interface ResultadoImportacao {
  ok: boolean;
  linhas_lidas?: number;
  linhas_ignoradas?: number;
  classificacoes?: number;
  vinculos_criados?: number;
  vinculos_atualizados?: number;
  vinculos_removidos?: number;
  excecoes_removidas?: number;
  avisos?: string[];
  cobertura?: { analiticas_balanco: number; sem_codigo: number; vinculos: number };
  erros?: { linha: number; classificacao?: string; codigo?: string; erro: string }[];
  nota?: string;
}

export async function importarAlocacoes(
  tenantId: string,
  linhas: LinhaImportada[],
  companyId: string | null = null,
  substituir = false,
): Promise<ResultadoImportacao> {
  const { data, error } = await (supabase as any).rpc("dfc_importar_vinculos", {
    _tenant_id: tenantId,
    _linhas: linhas,
    _company_id: companyId,
    _substituir: substituir,
  });
  if (error) throw new Error(error.message);
  return data as ResultadoImportacao;
}
