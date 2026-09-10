// Orquestração de upload: persiste plano de contas e diário no Supabase.
// Inserts e exclusões em lotes — na nuvem um DELETE/agregar único
// cai em "canceling statement due to statement timeout" (~8s).
import { supabase } from "@/integrations/supabase/client";
import type { PlanoContaRow } from "./plano-parser";
import type { DiarioRow, DiarioParseResult } from "./diario-parser";

const BATCH = 400;

async function chunkedInsert<T>(table: string, rows: T[], onProgress?: (n: number) => void) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(table as any).insert(slice as any);
    if (error) throw new Error(`Falha ao inserir em ${table}: ${error.message}`);
    onProgress?.(Math.min(i + slice.length, rows.length));
  }
}

async function rpc<T = any>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase as any).rpc(nome, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Na nuvem um DELETE único do plano estoura o statement_timeout (~8s). */
export async function apagarPlanoContasEmLotes(
  tenantId: string,
  companyId: string | null,
) {
  for (;;) {
    const n = await rpc<number>("apagar_lote_plano_contas", {
      _tenant_id: tenantId,
      _company_id: companyId,
      _limite: 1500,
    });
    if (!n) break;
  }
}

export async function apagarLancamentosEmLotes(uploadId: string) {
  for (;;) {
    const n = await rpc<number>("apagar_lote_lancamentos", {
      _upload_id: uploadId,
      _limite: 2000,
    });
    if (!n) break;
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
    try {
      await apagarPlanoContasEmLotes(tenantId, companyId);
    } catch (e: any) {
      throw new Error(`Falha ao limpar plano anterior: ${e.message}`);
    }
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
    const codigosArquivo = Array.from(new Set(parsed.rows.map((r) => r.conta_codigo)));
    const planoSet = new Set<string>();
    for (let i = 0; i < codigosArquivo.length; i += 200) {
      const fatia = codigosArquivo.slice(i, i + 200);
      const { data: existentes, error: pErr } = await supabase
        .from("plano_contas")
        .select("codigo")
        .eq("tenant_id", tenantId)
        .in("codigo", fatia);
      if (pErr) throw new Error(pErr.message);
      for (const r of existentes ?? []) planoSet.add((r as any).codigo);
    }
    const contasDesconhecidas = codigosArquivo.filter((c) => !planoSet.has(c)).length;

    const payload: any[] = parsed.rows.map((r: DiarioRow) => {
      const row: Record<string, unknown> = {
        tenant_id: tenantId,
        company_id: companyId,
        upload_id: uploadId,
        conta_codigo: r.conta_codigo,
        data: r.data,
        competencia: r.competencia,
        debito: r.debito,
        credito: r.credito,
      };
      if (r.conta_nome) row.conta_nome = r.conta_nome;
      if (r.subconta_codigo) row.subconta_codigo = r.subconta_codigo;
      if (r.historico) row.historico = r.historico;
      if (r.grupo_lancamento) row.grupo_lancamento = r.grupo_lancamento;
      if (r.lote) row.lote = r.lote;
      if (r.numero_lancamento) row.numero_lancamento = r.numero_lancamento;
      return row;
    });
    await chunkedInsert("lancamentos_diario", payload, (n) => onProgress?.(n, payload.length));

    const competencias = Array.from(new Set(parsed.rows.map((r) => r.competencia))).sort();
    for (const c of competencias) {
      try {
        await rpc("agregar_saldos_competencia", {
          _upload_id: uploadId,
          _competencia: c,
        });
      } catch (e: any) {
        throw new Error(`Falha ao agregar ${c}: ${e.message}`);
      }
    }

    const fim = await rpc<{ ok?: boolean; gravados?: number; esperados?: number; contas_desconhecidas?: number }>(
      "fechar_upload_diario",
      { _upload_id: uploadId },
    );
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
 * Retoma um upload que ficou em 'processing' — agrega o que falta e fecha.
 * Se a carga estiver incompleta, ele marca 'error' com a contagem, e
 * aí o caminho é excluir e reenviar.
 */
export async function retomarUpload(uploadId: string) {
  const comps = await rpc<string[]>("competencias_do_upload", { _upload_id: uploadId });
  for (const c of comps ?? []) {
    await rpc("agregar_saldos_competencia", {
      _upload_id: uploadId,
      _competencia: c,
    });
  }
  return rpc<{ ok: boolean; gravados: number; esperados?: number }>("fechar_upload_diario", {
    _upload_id: uploadId,
  });
}

export async function removerUpload(uploadId: string) {
  const { data: row, error: rErr } = await supabase
    .from("diario_uploads")
    .select("agregado, competencias_agregadas, filename")
    .eq("id", uploadId)
    .maybeSingle();
  if (rErr) throw new Error(rErr.message);

  const ecd = String((row as any)?.filename ?? "").startsWith("ECD:");
  let meses: string[] = (((row as any)?.competencias_agregadas ?? []) as string[]).filter(Boolean);
  if (!ecd && (row as any)?.agregado && meses.length === 0) {
    meses = (await rpc<string[]>("competencias_do_upload", { _upload_id: uploadId })) ?? [];
  }

  if (!ecd) {
    for (const c of meses) {
      await rpc("reverter_saldos_competencia", {
        _upload_id: uploadId,
        _competencia: c,
      });
    }
  }

  await apagarLancamentosEmLotes(uploadId);

  const { error } = await supabase.from("diario_uploads").delete().eq("id", uploadId);
  if (error) throw new Error(error.message);
}
