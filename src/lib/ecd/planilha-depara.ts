// O de-para da ECD em planilha: exportar para conferir, importar de volta.
//
// A tela resolve conta a conta, e isso é bom para dez contas. Um ECD de
// empresa média traz milhares — e a conferência de verdade acontece no
// Excel, com o plano do ECD de um lado e o Plano Padrão do outro.
//
// Duas abas, com papéis distintos:
//
//   De-para        TODAS as contas do plano que veio no ECD, na ordem e
//                  na hierarquia do arquivo, com o destino atual — e em
//                  branco onde não há destino. É a aba que se edita e a
//                  única que a importação lê.
//   Plano padrão   o plano de destino SEM clientes/fornecedores. Serve
//                  para consultar o código certo sem sair da planilha.
//                  As contas de participante ficam de fora de propósito:
//                  são centenas de milhares e nenhuma delas é destino
//                  válido para uma conta estrutural do ECD.

import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { baixarArquivo, codepagePlanilha, textoDoArquivo } from "@/lib/importacao/encoding";
import { lerTudo, lerRpcKeyset, countNaPrimeira } from "@/lib/supabase-paginado";
import { getEscopoPlano } from "@/lib/plano/escopo";

// ---------------------------------------------------------------------------
// Cabeçalhos. A importação aceita estes nomes de volta.
// ---------------------------------------------------------------------------
export const COL = {
  conta: "Conta (ECD)",
  classificacao: "Classificação",
  descricao: "Descrição",
  caminho: "Caminho",
  nivel: "Nível",
  tipo: "Tipo",
  natureza: "Natureza",
  movimento: "Movimento",
  saldoFinal: "Saldo final",
  destino: "Conta destino",
  destinoNome: "Descrição destino",
  ignorar: "Ignorar",
  situacao: "Situação",
  origem: "Origem",
} as const;

export interface LinhaPlanilhaDepara {
  codigo: string;
  classificacao: string | null;
  descricao: string;
  caminho: string | null;
  nivel: number | null;
  tipo: string | null;
  natureza: string | null;
  movimento: number;
  saldoFinal: number;
  destino: string | null;
  destinoNome: string | null;
  ignorada: boolean;
  origem: string;
  sintetica: boolean;
}

export interface ContaPlano {
  codigo: string;
  classificacao: string;
  descricao: string;
  tipo: string | null;
  natureza: string | null;
  nivel: number | null;
  is_sintetica: boolean;
}

export interface DadosPlanilhaDepara {
  linhas: LinhaPlanilhaDepara[];
  plano: ContaPlano[];
}

/** O plano de destino da empresa, sem clientes/fornecedores. */
export async function carregarPlanoDestino(companyId: string): Promise<ContaPlano[]> {
  const escopo = await getEscopoPlano(companyId);
  if (!escopo.tenant_id) return [];
  const escopoEmpresa = escopo.usa_plano_padrao ? null : companyId;
  return await lerTudo<ContaPlano>(
    (de, ate) => {
      let q = supabase
        .from("plano_contas")
        .select("codigo, classificacao, descricao, tipo, natureza, nivel, is_sintetica", countNaPrimeira(de))
        .eq("tenant_id", escopo.tenant_id as string)
        .eq("ativo", true)
        .eq("is_participante", false)
        .order("classificacao")
        .range(de, ate);
      q = escopoEmpresa === null ? q.is("company_id", null) : q.eq("company_id", escopoEmpresa);
      return q as any;
    },
    "plano_contas",
  );
}

/**
 * Junta o que vai na planilha: contas do ECD (com movimento e saldo da
 * virada), o vínculo atual e o plano de destino.
 */
export async function carregarDadosPlanilha(
  importacaoId: string,
  companyId: string,
): Promise<DadosPlanilhaDepara> {
  const [contas, movimento, depara, plano] = await Promise.all([
    lerTudo<any>(
      (de, ate) => supabase
        .from("ecd_conta" as any)
        .select(
          "codigo, descricao, tipo, natureza, classificacao, caminho_nomes, profundidade, nivel",
          countNaPrimeira(de),
        )
        .eq("importacao_id", importacaoId)
        .order("codigo")
        .range(de, ate),
      "ecd_conta",
    ),
    lerRpcKeyset<{ codigo: string; mov: number; fim: number }>(
      "codigo",
      (depois) => (supabase as any).rpc("ecd_movimento_por_conta", {
        _importacao_id: importacaoId, _depois: depois, _limite: 1000,
      }),
      "ecd_movimento_por_conta",
    ),
    lerTudo<any>(
      (de, ate) => supabase
        .from("depara_contas" as any)
        .select("conta_codigo, conta_padrao_codigo, ignorada, observacao", countNaPrimeira(de))
        .eq("company_id", companyId)
        .order("conta_codigo")
        .range(de, ate),
      "depara_contas",
    ),
    carregarPlanoDestino(companyId),
  ]);

  const mov = new Map(movimento.map((m) => [m.codigo, m]));
  const vinc = new Map(depara.map((d: any) => [d.conta_codigo, d]));
  const nomePlano = new Map(plano.map((p) => [p.codigo, p.descricao]));

  // A ordem do ARQUIVO: o caminho de nomes reproduz a hierarquia do plano
  // do ECD, e é nela que a conferência acontece. Sem isso a planilha sai
  // em ordem de código, que num ECD de código sequencial é ordem
  // nenhuma.
  const linhas: LinhaPlanilhaDepara[] = contas
    .map((c: any) => {
      const d = vinc.get(c.codigo);
      const m = mov.get(c.codigo);
      const sintetica = (c.tipo ?? "A") === "S";
      return {
        codigo: c.codigo,
        classificacao: c.classificacao ?? null,
        descricao: c.descricao ?? "",
        caminho: c.caminho_nomes ?? null,
        nivel: c.nivel ?? c.profundidade ?? null,
        tipo: c.tipo ?? null,
        natureza: c.natureza ?? null,
        movimento: Number(m?.mov ?? 0) || 0,
        saldoFinal: Number(m?.fim ?? 0) || 0,
        destino: d?.conta_padrao_codigo ?? null,
        destinoNome: d?.conta_padrao_codigo ? nomePlano.get(d.conta_padrao_codigo) ?? null : null,
        ignorada: !!d?.ignorada,
        origem: d?.observacao ?? "",
        sintetica,
      };
    })
    .sort((a, b) => {
      const ca = `${a.caminho ?? ""}|${a.classificacao ?? ""}|${a.codigo}`;
      const cb = `${b.caminho ?? ""}|${b.classificacao ?? ""}|${b.codigo}`;
      return ca.localeCompare(cb, "pt-BR");
    });

  return { linhas, plano };
}

const situacaoDe = (l: LinhaPlanilhaDepara) =>
  l.sintetica ? "sintética (não vincula)"
  : l.ignorada ? "ignorada"
  : l.destino ? "alocada"
  : "pendente";

export function montarWorkbookDepara(dados: DadosPlanilhaDepara): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const aoa: (string | number)[][] = [[
    COL.conta, COL.classificacao, COL.descricao, COL.caminho, COL.nivel, COL.tipo,
    COL.natureza, COL.movimento, COL.saldoFinal, COL.destino, COL.destinoNome,
    COL.ignorar, COL.situacao, COL.origem,
  ]];
  for (const l of dados.linhas) {
    aoa.push([
      l.codigo, l.classificacao ?? "", l.descricao, l.caminho ?? "", l.nivel ?? "",
      l.tipo ?? "", l.natureza ?? "", l.movimento, l.saldoFinal,
      l.destino ?? "", l.destinoNome ?? "", l.ignorada ? "sim" : "",
      situacaoDe(l), l.origem,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 16 }, { wch: 20 }, { wch: 44 }, { wch: 46 }, { wch: 7 }, { wch: 7 },
    { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 40 },
    { wch: 9 }, { wch: 22 }, { wch: 34 },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, "De-para");

  const wsPlano = XLSX.utils.aoa_to_sheet([
    ["Código", "Classificação", "Descrição", "Tipo", "Natureza", "Nível", "Sintética"],
    ...dados.plano.map((p) => [
      p.codigo, p.classificacao, p.descricao, p.tipo ?? "", p.natureza ?? "",
      p.nivel ?? "", p.is_sintetica ? "sim" : "",
    ]),
  ]);
  wsPlano["!cols"] = [
    { wch: 14 }, { wch: 22 }, { wch: 48 }, { wch: 8 }, { wch: 10 }, { wch: 7 }, { wch: 10 },
  ];
  wsPlano["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsPlano, "Plano padrão");

  return wb;
}

export function gerarPlanilhaDepara(dados: DadosPlanilhaDepara, nomeArquivo: string) {
  const wb = montarWorkbookDepara(dados);
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true });
  baixarArquivo(
    `${nomeArquivo}.xlsx`,
    new Uint8Array(buf),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------
export interface LinhaLida {
  linha: number;
  codigo: string;
  destino: string | null;
  ignorar: boolean;
}

export interface LeituraDepara {
  aba: string;
  linhas: LinhaLida[];
  ignoradas: number;
  avisos: string[];
}

const norm = (s: unknown) =>
  String(s ?? "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const ALIAS_CONTA = ["conta (ecd)", "conta ecd", "conta", "codigo", "codigo da conta", "conta_codigo"];
const ALIAS_DESTINO = [
  "conta destino", "destino", "conta padrao", "conta padrao codigo",
  "conta_padrao_codigo", "codigo destino",
];
const ALIAS_IGNORAR = ["ignorar", "ignorada", "ignorar?"];

const ehSim = (v: unknown) => ["sim", "s", "x", "true", "1", "verdadeiro"].includes(norm(v));

export async function lerPlanilhaDepara(arquivo: File): Promise<LeituraDepara> {
  const nome = arquivo.name.toLowerCase();
  if (nome.endsWith(".csv") || nome.endsWith(".txt")) {
    const { text, encoding } = await textoDoArquivo(arquivo);
    return lerWorkbookDepara(XLSX.read(text, {
      type: "string",
      codepage: codepagePlanilha(encoding, arquivo.name),
      raw: false,
    }));
  }
  const opts: XLSX.ParsingOptions = { type: "array" };
  const cp = codepagePlanilha(nome.endsWith(".xls") ? "windows-1252" : "utf-8", arquivo.name);
  if (cp != null) opts.codepage = cp;
  return lerWorkbookDepara(XLSX.read(await arquivo.arrayBuffer(), opts));
}

/** A aba de plano não é lida: ela tem "Código" e "Descrição", nunca destino. */
export function lerWorkbookDepara(wb: XLSX.WorkBook): LeituraDepara {
  for (const nomeAba of wb.SheetNames) {
    if (norm(nomeAba).startsWith("plano")) continue;

    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets[nomeAba], { defval: "" },
    );
    if (linhas.length === 0) continue;

    const cab = Object.keys(linhas[0]);
    const colConta = cab.find((c) => ALIAS_CONTA.includes(norm(c)));
    const colDestino = cab.find((c) => ALIAS_DESTINO.includes(norm(c)));
    const colIgnorar = cab.find((c) => ALIAS_IGNORAR.includes(norm(c)));
    if (!colConta || !colDestino) continue;

    const out: LinhaLida[] = [];
    const vistos = new Map<string, number>();
    const avisos: string[] = [];
    let ignoradas = 0;
    linhas.forEach((l, i) => {
      const codigo = String(l[colConta] ?? "").trim();
      if (!codigo) { ignoradas++; return; }
      const destino = String(l[colDestino] ?? "").trim();
      const ignorar = colIgnorar ? ehSim(l[colIgnorar]) : false;
      const numero = i + 2; // 1 = cabeçalho
      const antes = vistos.get(codigo);
      if (antes != null) {
        avisos.push(`Conta ${codigo} aparece mais de uma vez (linhas ${antes} e ${numero}) — vale a última.`);
      }
      vistos.set(codigo, numero);
      out.push({ linha: numero, codigo, destino: destino || null, ignorar });
    });

    return { aba: nomeAba, linhas: out, ignoradas, avisos: avisos.slice(0, 5) };
  }

  throw new Error(
    'Nenhuma aba tem as colunas "Conta (ECD)" e "Conta destino". ' +
    "Baixe a planilha do de-para primeiro e edite o arquivo gerado.",
  );
}

// ---------------------------------------------------------------------------
// Validação e gravação
// ---------------------------------------------------------------------------
export interface ErroLinha {
  linha: number;
  codigo: string;
  erro: string;
}

export interface PreviaImportacao {
  criados: { conta_codigo: string; conta_padrao_codigo: string | null; ignorada: boolean; observacao: string }[];
  atualizados: PreviaImportacao["criados"];
  removidos: PreviaImportacao["criados"];
  inalterados: number;
  erros: ErroLinha[];
}

/**
 * Confere a planilha contra o ECD e o plano ANTES de gravar.
 *
 * Uma linha com problema não entra — e o problema aparece com o número
 * da linha do Excel, que é a única coisa que permite corrigir o arquivo
 * sem adivinhação.
 */
export function validarImportacao(
  lidas: LinhaLida[],
  dados: DadosPlanilhaDepara,
): PreviaImportacao {
  const porEcd = new Map(dados.linhas.map((l) => [l.codigo, l]));
  const porPlano = new Map(dados.plano.map((p) => [p.codigo, p]));

  const previa: PreviaImportacao = {
    criados: [], atualizados: [], removidos: [], inalterados: 0, erros: [],
  };

  for (const l of lidas) {
    const conta = porEcd.get(l.codigo);
    if (!conta) {
      previa.erros.push({ linha: l.linha, codigo: l.codigo, erro: "conta não existe neste ECD" });
      continue;
    }
    if (conta.sintetica) {
      if (l.destino || l.ignorar) {
        previa.erros.push({
          linha: l.linha, codigo: l.codigo,
          erro: "conta sintética do ECD — o vínculo é feito nas contas analíticas",
        });
      }
      continue;
    }
    if (l.destino) {
      const destino = porPlano.get(l.destino);
      if (!destino) {
        previa.erros.push({
          linha: l.linha, codigo: l.codigo,
          erro: `destino ${l.destino} não existe no plano (ou é conta de cliente/fornecedor)`,
        });
        continue;
      }
      if (destino.is_sintetica) {
        previa.erros.push({
          linha: l.linha, codigo: l.codigo,
          erro: `destino ${l.destino} é conta sintética — escolha uma analítica`,
        });
        continue;
      }
    }

    const item = {
      conta_codigo: l.codigo,
      conta_padrao_codigo: l.ignorar ? null : l.destino,
      ignorada: l.ignorar,
      observacao: l.ignorar ? "ECD: ignorada (planilha)" : "ECD: definido pela planilha",
    };

    const igual =
      conta.ignorada === item.ignorada &&
      (conta.destino ?? null) === (item.conta_padrao_codigo ?? null);
    if (igual) { previa.inalterados++; continue; }

    if (!item.ignorada && !item.conta_padrao_codigo) {
      // Célula esvaziada: o vínculo sai e a conta volta para pendente.
      if (conta.destino || conta.ignorada) previa.removidos.push(item);
      else previa.inalterados++;
      continue;
    }
    if (conta.destino || conta.ignorada) previa.atualizados.push(item);
    else previa.criados.push(item);
  }

  return previa;
}

const LOTE = 400;

export async function gravarImportacao(
  companyId: string,
  previa: PreviaImportacao,
): Promise<{ gravadas: number; limpas: number }> {
  const itens = [...previa.criados, ...previa.atualizados, ...previa.removidos];
  let gravadas = 0;
  let limpas = 0;
  for (let i = 0; i < itens.length; i += LOTE) {
    const { data, error } = await (supabase as any).rpc("aplicar_depara_em_lote", {
      _company_id: companyId,
      _itens: itens.slice(i, i + LOTE),
    });
    if (error) throw new Error(error.message);
    gravadas += Number(data?.gravadas ?? 0);
    limpas += Number(data?.limpas ?? 0);
  }
  return { gravadas, limpas };
}
