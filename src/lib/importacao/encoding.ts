// Encoding de arquivo brasileiro.
//
// Excel, SPED e CSV de ERP quase nunca vêm em UTF-8. `File.text()` e o
// decoder UTF-8 do navegador transformam ç/ã/é em U+FFFD (ou engolem o
// byte), e a DFC/ECD aparece sem acento. ISO-8859-1 ainda perde o que
// o Windows guarda em 0x80–0x9F (aspas, travessão). O fallback certo
// é windows-1252.
export type EncodingArquivo = "utf-8" | "utf-8-bom" | "windows-1252";

function latin1(buf: ArrayBuffer): string {
  let t: string;
  try {
    t = new TextDecoder("windows-1252").decode(buf);
  } catch {
    t = new TextDecoder("iso-8859-1").decode(buf);
  }
  // Exportações DOS (CP850) lidas como Windows-1252 viram "CONSTRU€ÇO".
  return pareceCp850(t) ? corrigirCp850(t) : t;
}

const CP1252_ALTO =
  "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ" +
  Array.from({ length: 96 }, (_, i) => String.fromCharCode(0xa0 + i)).join("");
const CP850_ALTO =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00AD±‗¾¶§÷¸°¨·¹³²■\u00A0";
const MAPA_850 = new Map<string, string>();
for (let i = 0; i < 128; i++) MAPA_850.set(CP1252_ALTO[i], CP850_ALTO[i]);
MAPA_850.set("\uFFFD", "É");

const MARCAS_850 = /[€‚‡Æµåäˆƒ“¢£¡…\u0081\u008D\u008F\u0090\u009D\uFFFD]/g;
const ACENTOS_OK = /[çãõáéíóúâêôàÇÃÕÁÉÍÓÚÂÊÔ]/g;

/** Texto CP850 decodificado como Windows-1252? */
export function pareceCp850(t: string): boolean {
  const marcas = t.match(MARCAS_850)?.length ?? 0;
  if (marcas === 0) return false;
  const ok = t.match(ACENTOS_OK)?.length ?? 0;
  return marcas >= ok;
}

/** Converte "CONSTRU€ÇO" → "CONSTRUÇÃO" (bytes CP850 lidos como Windows-1252). */
export function corrigirCp850(t: string): string {
  let out = "";
  for (const ch of t) out += ch.charCodeAt(0) < 0x80 ? ch : (MAPA_850.get(ch) ?? ch);
  return out;
}

export async function textoDoArquivo(file: File): Promise<{ text: string; encoding: EncodingArquivo }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let slice: ArrayBuffer = buf;
  let bom = false;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    slice = buf.slice(3);
    bom = true;
  }
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(slice);
  if (utf8.includes("\uFFFD")) {
    return { text: latin1(slice), encoding: "windows-1252" };
  }
  const text = utf8.replace(/^\uFEFF/, "");
  return { text, encoding: bom ? "utf-8-bom" : "utf-8" };
}

/** SPED (ECD/EFD): o leiaute da RFB é Latin-1. Confere o registro 0000. */
export async function textoSped(file: File): Promise<string> {
  const { text, encoding } = await textoDoArquivo(file);
  if (pareceSped(text)) return text;
  if (encoding === "windows-1252") return text;
  const buf = await file.arrayBuffer();
  const alt = latin1(buf);
  if (pareceSped(alt)) return alt;
  return text;
}

/** Download no navegador sem `writeFile` (no Windows isso come acento no CSV/XLS). */
export function baixarArquivo(nomeArquivo: string, dados: BlobPart, mime: string) {
  const blob = new Blob([dados], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function pareceSped(s: string): boolean {
  return s.includes("|0000|") || s.includes("|I050|") || s.includes("|C100|");
}

/** Codepage do SheetJS: 65001 = UTF-8, 1252 = Windows Latin-1. */
export function codepagePlanilha(encoding: EncodingArquivo, nomeArquivo: string): number | undefined {
  const n = nomeArquivo.toLowerCase();
  if (n.endsWith(".xlsx")) return undefined;
  if (n.endsWith(".xls")) return 1252;
  if (encoding === "windows-1252") return 1252;
  return 65001;
}
