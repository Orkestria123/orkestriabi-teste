// Encoding de arquivo brasileiro.
//
// Excel, SPED e CSV de ERP quase nunca vêm em UTF-8. `File.text()` e o
// decoder UTF-8 do navegador transformam ç/ã/é em U+FFFD (ou engolem o
// byte), e a DFC/ECD aparece sem acento. ISO-8859-1 ainda perde o que
// o Windows guarda em 0x80–0x9F (aspas, travessão). O fallback certo
// é windows-1252.
export type EncodingArquivo = "utf-8" | "utf-8-bom" | "windows-1252";

function latin1(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("windows-1252").decode(buf);
  } catch {
    return new TextDecoder("iso-8859-1").decode(buf);
  }
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
