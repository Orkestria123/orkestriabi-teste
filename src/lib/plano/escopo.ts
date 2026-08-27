// Resolução do escopo do plano de contas de uma empresa.
//
// A partir do ajuste 02, quem manda é `companies.plano_tipo`:
//   'padrao'  -> a empresa LÊ o Plano Padrão do escritório (company_id IS NULL)
//   'proprio' -> a empresa usa o plano próprio + de-para
//
// Existe um fallback importante: empresa marcada como 'padrao' cujo
// escritório ainda não tem Plano Padrão continua lendo o plano próprio,
// para não quebrar quem configurou antes deste ajuste. Nesse caso
// `fallback_plano_proprio` vem true e a tela avisa.
import { supabase } from "@/integrations/supabase/client";

export interface EscopoPlano {
  autorizado: boolean;
  encontrado: boolean;
  tenant_id: string | null;
  /** true = ler plano com company_id IS NULL (Plano Padrão do escritório) */
  usa_plano_padrao: boolean;
  /** true = plano próprio lido através do de-para (códigos traduzidos) */
  usa_depara: boolean;
  plano_tipo: "padrao" | "proprio";
  plano_padrao_existe: boolean;
  fallback_plano_proprio: boolean;
  separador: string;
}

const PADRAO: EscopoPlano = {
  autorizado: false,
  encontrado: false,
  tenant_id: null,
  usa_plano_padrao: false,
  usa_depara: false,
  plano_tipo: "padrao",
  plano_padrao_existe: false,
  fallback_plano_proprio: false,
  separador: ".",
};

export async function getEscopoPlano(companyId: string): Promise<EscopoPlano> {
  const { data, error } = await supabase.rpc("escopo_plano_empresa", {
    _company_id: companyId,
  });
  if (error) throw error;
  return { ...PADRAO, ...((data ?? {}) as Partial<EscopoPlano>) };
}

/**
 * Compatibilidade com o motor: `modoGlobal` sempre significou
 * "ler o plano com company_id IS NULL". Agora esse valor vem da
 * resolução por empresa, não mais de tenants.plano_contas_modo.
 */
export async function getModoGlobal(
  companyId: string,
): Promise<{ tenantId: string | null; modoGlobal: boolean; escopo: EscopoPlano }> {
  const escopo = await getEscopoPlano(companyId);
  return {
    tenantId: escopo.tenant_id,
    modoGlobal: escopo.usa_plano_padrao,
    escopo,
  };
}
