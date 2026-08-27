import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { verificarFechamentoBP } from "@/lib/diario/build-statements";
import { getModoGlobal } from "@/lib/plano/escopo";
import { formatBRL } from "@/lib/format";

interface Props {
  tenantId: string;
  companyId: string;
}

/**
 * "O balanço fecha?" — Ativo × Passivo+PL.
 *
 * Este selo somava `saldos_abertura` + `saldos_mensais` por conta própria,
 * fora do motor. Isso produzia uma diferença falsa em três situações:
 *
 *  1. `grupoDe()` era aplicado ao `conta_codigo` dos saldos, mas ele espera
 *     uma CLASSIFICAÇÃO. No plano do escritório o código é `151995` e a
 *     classificação é `1.01.02.01.01.01` — não são a mesma coisa, e o
 *     grupo saía do primeiro caractere do código, ou seja, de nada.
 *  2. Empresa com plano de terceiro: os saldos vêm com o código de ORIGEM
 *     e o de-para não era aplicado, então metade não casava com o plano.
 *  3. Somava TODOS os períodos, enquanto a tela mostra o período filtrado —
 *     o selo e a demonstração respondiam perguntas diferentes.
 *
 * Agora usa `verificarFechamentoBP`, que é o mesmo motor que desenha o
 * Balanço. Se a tela fecha, o selo fecha; se divergirem, é defeito de
 * verdade e não do selo.
 *
 * Confere TODOS os períodos com movimento numa chamada só, e aponta o
 * primeiro mês que não fecha — que é a informação útil quando não fecha.
 */
export interface Fechamento {
  ativo: number;
  passivoPl: number;
  periodo: string;
  equilibrado: boolean;
  quebra: { periodo: string; ativo: number; passivoPl: number; diferenca: number } | null;
  meses: number;
}

/** Exportado para poder ser conferido pela bateria de testes. */
export async function conferirFechamento(
  tenantId: string,
  companyId: string,
): Promise<Fechamento | null> {
  const { data: comps, error } = await supabase
    .from("saldos_mensais")
    .select("competencia")
    .eq("company_id", companyId)
    .order("competencia");
  if (error) throw error;

  const periodos = Array.from(
    new Set((comps ?? []).map((r: any) => String(r.competencia))),
  ).sort();
  if (periodos.length === 0) return null;

  const { modoGlobal } = await getModoGlobal(companyId);
  const linhas = await verificarFechamentoBP(
    companyId, tenantId, modoGlobal, periodos, "contabil",
  );

  const ultimo = linhas[linhas.length - 1];
  const primeiroQuebrado = linhas.find((l) => Math.abs(l.diferenca) >= 0.01);
  return {
    ativo: ultimo?.ativo ?? 0,
    passivoPl: ultimo?.passivoPl ?? 0,
    periodo: ultimo?.periodo ?? "",
    equilibrado: !primeiroQuebrado,
    quebra: primeiroQuebrado ?? null,
    meses: linhas.length,
  };
}

export function BalancoFechaBadge({ tenantId, companyId }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["balanco-fecha", companyId],
    queryFn: () => conferirFechamento(tenantId, companyId),
  });

  if (isLoading) {
    return (
      <Card className="p-3 mb-4 text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Calculando balanço…
      </Card>
    );
  }
  if (error) {
    return (
      <Card className="p-3 mb-4 text-xs text-muted-foreground">
        Não foi possível conferir o fechamento: {(error as Error).message}
      </Card>
    );
  }
  if (!data) return null;

  const mesDe = (p: string) => p.slice(0, 7).split("-").reverse().join("/");

  return (
    <Card className="p-3 mb-4 flex flex-wrap items-center gap-3 text-sm">
      {data.equilibrado ? (
        <Badge variant="outline" className="text-emerald-600 border-emerald-600/40 gap-1">
          <CheckCircle2 className="h-3 w-3" /> Balanço fecha nos {data.meses} meses
        </Badge>
      ) : (
        <Badge variant="outline" className="text-amber-600 border-amber-600/40 gap-1">
          <AlertTriangle className="h-3 w-3" /> Não fecha em {mesDe(data.quebra!.periodo)} — dif.{" "}
          {formatBRL(data.quebra!.diferenca)}
        </Badge>
      )}
      <span className="text-xs text-muted-foreground">
        Em {mesDe(data.periodo)}: Ativo{" "}
        <strong className="text-foreground">{formatBRL(data.ativo)}</strong> · Passivo+PL{" "}
        <strong className="text-foreground">{formatBRL(data.passivoPl)}</strong>
      </span>
    </Card>
  );
}
