// Lê planilha de "Contas específicas de empresa": colunas
// "Conta Sintética" (código ou classificação existente no Plano Padrão)
// e "Nome Atribuído". Browser-safe, sem acesso ao banco.
export type LinhaImportacao = { linha: number; sintetica: string; nome: string; erro?: string };

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

export function lerLinhasContas(
  rows: unknown[][],
  sinteticasValidas: Set<string>,
): LinhaImportacao[] {
  if (!rows.length) return [];
  const cab = rows[0].map(norm);
  let iS = cab.findIndex((c) => c.includes("sintet"));
  let iN = cab.findIndex((c) => c.includes("nome") || c.includes("descri"));
  let inicio = 1;
  if (iS < 0 || iN < 0) { iS = 0; iN = 1; inicio = 0; }
  const out: LinhaImportacao[] = [];
  for (let i = inicio; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const sintetica = String(r[iS] ?? "").trim();
    const nome = String(r[iN] ?? "").trim();
    if (!sintetica && !nome) continue;
    let erro: string | undefined;
    if (!sintetica) erro = "Sem conta sintética";
    else if (!nome) erro = "Sem nome";
    else if (!sinteticasValidas.has(sintetica)) erro = "Sintética não existe no Plano Padrão";
    out.push({ linha: i + 1, sintetica, nome, erro });
  }
  return out;
}
