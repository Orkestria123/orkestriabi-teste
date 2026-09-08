// Upload/troca das imagens de perfil (logo e foto) de empresas e escritórios.
// Ao trocar, o arquivo anterior é removido para não acumular lixo no storage.

import { supabase } from "@/integrations/supabase/client";

export const BUCKET_PERFIL = "perfil-imagens";

export type EscopoPerfil = "empresa" | "escritorio";
export type TipoImagem = "logo" | "foto";

export const LIMITES: Record<TipoImagem, number> = {
  logo: 2 * 1024 * 1024,
  foto: 5 * 1024 * 1024,
};

function extensao(file: File) {
  const porNome = file.name.split(".").pop()?.toLowerCase();
  if (porNome && /^[a-z0-9]{2,5}$/.test(porNome)) return porNome;
  const porTipo = file.type.split("/")[1];
  return porTipo && /^[a-z0-9]{2,5}$/.test(porTipo) ? porTipo : "png";
}

/** Converte uma imagem capturada do site (data URL) num File para upload. */
export function dataUrlParaArquivo(dataUrl: string, nomeBase: string): File {
  const [cabecalho, base64] = dataUrl.split(",");
  const tipo = /data:([^;]+)/.exec(cabecalho)?.[1] ?? "image/png";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = tipo.split("/")[1]?.replace("svg+xml", "svg") ?? "png";
  return new File([bytes], `${nomeBase}.${ext}`, { type: tipo });
}

export async function enviarImagemPerfil(opts: {
  tenantId: string;
  escopo: EscopoPerfil;
  id: string;
  tipo: TipoImagem;
  file: File;
  anterior?: string | null;
}): Promise<string> {
  const { tenantId, escopo, id, tipo, file, anterior } = opts;
  if (file.size > LIMITES[tipo]) {
    throw new Error(
      tipo === "logo" ? "A logo deve ter no máximo 2MB." : "A foto deve ter no máximo 5MB.",
    );
  }
  const path = `${tenantId}/${escopo}/${id}/${tipo}-${Date.now()}.${extensao(file)}`;
  const { error } = await supabase.storage
    .from(BUCKET_PERFIL)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw error;

  if (anterior && anterior !== path && !/^https?:\/\//.test(anterior)) {
    await supabase.storage.from(BUCKET_PERFIL).remove([anterior]);
  }
  return path;
}

export async function removerImagemPerfil(path: string | null | undefined) {
  if (!path || /^https?:\/\//.test(path)) return;
  await supabase.storage.from(BUCKET_PERFIL).remove([path]);
}

export async function urlDaImagemPerfil(path: string | null | undefined) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const { data } = await supabase.storage.from(BUCKET_PERFIL).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}
