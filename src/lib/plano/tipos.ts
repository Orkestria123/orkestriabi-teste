// Tipos de conta do sistema contábil → lado da demonstração.
//
// Herdado de `marcos.ts`, que foi removido junto com os marcos. Isto aqui
// não era marco: é a leitura do campo `tipo` do plano, e continua valendo.

export type DemonstracaoDoPlano = "DRE" | "BP_ATIVO" | "BP_PASSIVO";

export function demonstracaoDoTipoConta(tipo: string): DemonstracaoDoPlano | null {
  if (tipo === "3-DRE") return "DRE";
  if (tipo === "1-Ativo" || tipo === "4-Cli. Nac." || tipo === "6-Cli. Ex.") return "BP_ATIVO";
  if (tipo === "2-Passivo" || tipo === "5-For. Nac." || tipo === "7-For. Ex.") return "BP_PASSIVO";
  return null;
}
