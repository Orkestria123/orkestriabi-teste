// Orquestração de upload: persiste plano de contas e diário no Supabase.
// Inserts em batches (Supabase aceita ~1000 rows por chamada).
import { supabase } from "@/integrations/supabase/client";
import type { PlanoContaRow } from "./plano-parser";
import type { DiarioRow, DiarioParseResult } from "./diario-parser";

const BATCH = 1000;

async function chunkedInsert<T>(table: string, rows: T[], onProgress?: (n: number) => void) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(table as any).insert(slice as any);
    if (error) throw new Error(`Falha ao inserir em ${table}: ${error.message}`);
    onProgress?.(Math.min(i + slice.length, rows.length));
  }
}

export async function salvarPlanoContas(opts: {
  tenantId: string;
  companyId: string | null; // null = plano global do tenant
  rows: PlanoContaRow[];
  substituir: boolean;
  onProgress?: (loaded: number, total: number) => void;
}) {
  const { tenantId, companyId, rows, substituir, onProgress } = opts;

  if (substituir) {
    const q = supabase.from("plano_contas").delete().eq("tenant_id", tenantId);
    const { error } = companyId == null ? await q.is("company_id", null) : await q.eq("company_id", companyId);
    if (error) throw new Error(`Falha ao limpar plano anterior: ${error.message}`);
  }

  const payload = rows.map((r) => ({
    tenant_id: tenantId,
    company_id: companyId,
    codigo: r.codigo,
    classificacao: r.classificacao,
    descricao: r.descricao,
    tipo: r.tipo,
    natureza: r.natureza,
    nivel: r.nivel,
    is_participante: r.is_participante,
    is_sintetica: r.is_sintetica,
    conta_pai_classificacao: r.conta_pai_classificacao,
  }));
  await chunkedInsert("plano_contas", payload, (n) => onProgress?.(n, payload.length));
  return { inseridos: payload.length };
}

export async function salvarDiarioUpload(opts: {
  tenantId: string;
  companyId: string;
  uploadedBy: string | null;
  filename: string;
  parsed: DiarioParseResult;
  onProgress?: (loaded: number, total: number) => void;
}) {
  const { tenantId, companyId, uploadedBy, filename, parsed, onProgress } = opts;

  // 1) cria o registro do upload
  const { data: up, error: upErr } = await supabase
    .from("diario_uploads")
    .insert({
      tenant_id: tenantId,
      company_id: companyId,
      filename,
      competencia_inicio: parsed.competencia_inicio,
      competencia_fim: parsed.competencia_fim,
      total_lancamentos: parsed.total,
      total_debitos: parsed.total_debitos,
      total_creditos: parsed.total_creditos,
      partidas_fechadas: parsed.partidas_fechadas,
      status: "processing",
      uploaded_by: uploadedBy,
    })
    .select("id")
    .single();
  if (upErr || !up) throw new Error(`Falha ao registrar upload: ${upErr?.message}`);
  const uploadId = up.id;

  try {
    // 2) verifica contas desconhecidas (sem bloquear — só conta)
    const codigosArquivo = Array.from(new Set(parsed.rows.map((r) => r.conta_codigo)));
    const { data: existentes, error: pErr } = await supabase
      .from("plano_contas")
      .select("codigo")
      .eq("tenant_id", tenantId)
      .in("codigo", codigosArquivo);
    if (pErr) throw new Error(pErr.message);
    const planoSet = new Set((existentes ?? []).map((r: any) => r.codigo));
    const contasDesconhecidas = codigosArquivo.filter((c) => !planoSet.has(c)).length;

    // 3) insere lançamentos em batches
    const payload: any[] = parsed.rows.map((r: DiarioRow) => ({
      tenant_id: tenantId,
      company_id: companyId,
      upload_id: uploadId,
      conta_codigo: r.conta_codigo,
      conta_nome: r.conta_nome,
      subconta_codigo: r.subconta_codigo,
      data: r.data,
      competencia: r.competencia,
      historico: r.historico,
      debito: r.debito,
      credito: r.credito,
      grupo_lancamento: r.grupo_lancamento,
      lote: r.lote,
      numero_lancamento: r.numero_lancamento,
    }));
    await chunkedInsert("lancamentos_diario", payload, (n) => onProgress?.(n, payload.length));

    // 4) fechamento ATÔMICO: contar, agregar e marcar 'done' numa
    //    transação só, no servidor.
    //
    //    Antes eram duas chamadas separadas do navegador (agregar,
    //    depois marcar done). Se a aba fechasse entre as duas, os
    //    saldos ficavam agregados e o upload preso em 'processing' —
    //    ou pior, marcado 'done' com lançamentos faltando, porque
    //    ninguém conferia se todas as linhas tinham entrado.
    //
    //    `finalizar_upload_diario` compara o que foi gravado com o
    //    total esperado e se recusa a fechar carga incompleta.
    const { data: fim, error: fimErr } = await (supabase as any).rpc(
      "finalizar_upload_diario",
      { _upload_id: uploadId },
    );
    if (fimErr) throw new Error(`Falha ao finalizar: ${fimErr.message}`);
    if (fim && fim.ok === false) {
      throw new Error(
        `Carga incompleta: ${fim.gravados} de ${fim.esperados} lançamentos foram gravados. ` +
          `Exclua este upload e envie o arquivo novamente.`,
      );
    }

    return {
      uploadId,
      contasDesconhecidas: fim?.contas_desconhecidas ?? contasDesconhecidas,
      total: payload.length,
    };
  } catch (e: any) {
    await supabase
      .from("diario_uploads")
      .update({ status: "error", erro_detalhe: String(e?.message ?? e) })
      .eq("id", uploadId);
    throw e;
  }
}

/**
 * Uploads que ficaram pela metade: 'processing' de uma carga que morreu,
 * ou 'error'. Devolve quanto entrou de fato, para dar para decidir entre
 * refazer e excluir.
 */
export async function uploadsIncompletos(companyId: string) {
  const { data, error } = await (supabase as any).rpc("uploads_incompletos", {
    _company_id: companyId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as {
    id: string;
    filename: string;
    status: string;
    criado_em: string;
    lancamentos_gravados: number;
    lancamentos_esperados: number | null;
  }[];
}

/**
 * Retoma um upload que ficou em 'processing' — tenta fechar de novo.
 * Se a carga estiver incompleta, ele marca 'error' com a contagem, e
 * aí o caminho é excluir e reenviar.
 */
export async function retomarUpload(uploadId: string) {
  const { data, error } = await (supabase as any).rpc("finalizar_upload_diario", {
    _upload_id: uploadId,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; gravados: number; esperados?: number };
}

export async function removerUpload(uploadId: string) {
  // Reverte agregação e remove lançamentos
  const { error: rpcErr } = await supabase.rpc("reverter_upload_diario", { _upload_id: uploadId });
  if (rpcErr) throw new Error(rpcErr.message);
  const { error } = await supabase.from("diario_uploads").delete().eq("id", uploadId);
  if (error) throw new Error(error.message);
}
