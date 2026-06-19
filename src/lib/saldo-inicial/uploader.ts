// Orquestração: persiste saldo inicial em saldos_abertura + registra upload.
import { supabase } from "@/integrations/supabase/client";
import type { SaldoInicialParseResult, SaldoInicialRow } from "./parse-balancete";

const BATCH = 1000;

export async function salvarSaldoInicial(opts: {
  tenantId: string;
  companyId: string;
  uploadedBy: string | null;
  filename: string;
  dataReferencia: string; // 'YYYY-MM-DD'
  parsed: SaldoInicialParseResult;
  substituirData: boolean; // limpa saldos_abertura desta data antes de inserir
  onProgress?: (loaded: number, total: number) => void;
}) {
  const {
    tenantId,
    companyId,
    uploadedBy,
    filename,
    dataReferencia,
    parsed,
    substituirData,
    onProgress,
  } = opts;

  // 1) registra upload
  const { data: up, error: upErr } = await supabase
    .from("saldo_inicial_uploads")
    .insert({
      tenant_id: tenantId,
      company_id: companyId,
      filename,
      data_referencia: dataReferencia,
      total_contas: parsed.total,
      total_ativo: parsed.total_ativo,
      total_passivo_pl: parsed.total_passivo_pl,
      diferenca: parsed.diferenca,
      equilibrado: parsed.equilibrado,
      encoding: parsed.encoding,
      status: "processing",
      uploaded_by: uploadedBy,
    } as any)
    .select("id")
    .single();
  if (upErr || !up) throw new Error(`Falha ao registrar upload: ${upErr?.message}`);
  const uploadId = (up as any).id as string;

  try {
    // 2) limpa saldos anteriores desta data, se solicitado
    if (substituirData) {
      const { error: delErr } = await supabase
        .from("saldos_abertura")
        .delete()
        .eq("company_id", companyId)
        .eq("data_referencia", dataReferencia);
      if (delErr) throw new Error(`Falha ao limpar saldos anteriores: ${delErr.message}`);
    }

    // 3) insere em batches via upsert (idempotente)
    const payload = parsed.rows.map((r: SaldoInicialRow) => ({
      tenant_id: tenantId,
      company_id: companyId,
      codigo: r.conta_codigo,
      conta_codigo: r.conta_codigo,
      classificacao: r.classificacao,
      data_referencia: dataReferencia,
      saldo: r.saldo,
      valor_origem: r.valor_origem,
      is_participante: r.is_participante,
      upload_id: uploadId,
    }));

    for (let i = 0; i < payload.length; i += BATCH) {
      const slice = payload.slice(i, i + BATCH);
      const { error } = await supabase
        .from("saldos_abertura" as any)
        .upsert(slice as any, {
          onConflict: "company_id,conta_codigo,data_referencia",
        });
      if (error) throw new Error(`Falha ao inserir saldos: ${error.message}`);
      onProgress?.(Math.min(i + slice.length, payload.length), payload.length);
    }

    // 4) finaliza
    await supabase
      .from("saldo_inicial_uploads")
      .update({ status: "done" } as any)
      .eq("id", uploadId);

    return { uploadId, total: payload.length };
  } catch (e: any) {
    await supabase
      .from("saldo_inicial_uploads")
      .update({ status: "error", erro_detalhe: String(e?.message ?? e) } as any)
      .eq("id", uploadId);
    throw e;
  }
}

export async function removerSaldoInicialUpload(uploadId: string, companyId: string) {
  // remove saldos vinculados a este upload
  const { error: err1 } = await supabase
    .from("saldos_abertura")
    .delete()
    .eq("company_id", companyId)
    .eq("upload_id" as any, uploadId);
  if (err1) throw new Error(err1.message);
  const { error: err2 } = await supabase
    .from("saldo_inicial_uploads")
    .delete()
    .eq("id", uploadId);
  if (err2) throw new Error(err2.message);
}
