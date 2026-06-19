import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMascaraConfig, grupoDe, sinalSaldoInicial } from "@/lib/mascara/interpretar";
import { formatBRL } from "@/lib/format";

interface Props {
  tenantId: string;
  companyId: string;
}

/**
 * Calcula Ativo vs Passivo+PL ao vivo, somando saldos_abertura + movimentos
 * agregados (saldos_mensais), e mostra se o balanço fecha.
 */
export function BalancoFechaBadge({ tenantId, companyId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["balanco-fecha", companyId],
    queryFn: async () => {
      const mascara = await getMascaraConfig({ tenantId, companyId });

      // Mapa classificacao → grupo a partir do plano (cobre contas analíticas
      // que aparecem nos saldos). Caímos para grupoDe(...) quando ausente.
      const planoQ = supabase
        .from("plano_contas")
        .select("classificacao")
        .eq("tenant_id", tenantId);
      const planoRes = await planoQ.eq("company_id", companyId);
      const classifs = new Set<string>(
        (planoRes.data ?? []).map((r: any) => r.classificacao).filter(Boolean),
      );

      const [aberturaRes, movRes] = await Promise.all([
        supabase
          .from("saldos_abertura")
          .select("classificacao, saldo, natureza")
          .eq("company_id", companyId),
        supabase
          .from("saldos_mensais")
          .select("conta_codigo, total_debitos, total_creditos")
          .eq("company_id", companyId),
      ]);

      let ativo = 0;
      let passivoPl = 0;

      for (const r of (aberturaRes.data ?? []) as any[]) {
        const c = r.classificacao as string;
        if (!c) continue;
        const g = grupoDe(c, mascara);
        const v = Number(r.saldo ?? 0);
        // saldo já vem padronizado (Ativo+, Passivo+). Usamos sinal direto.
        if (g === "ativo") ativo += v;
        else if (g === "passivo" || g === "pl") passivoPl += v;
      }

      // Movimentos do período: D-C; aplicar inversão para passivo/PL
      for (const r of (movRes.data ?? []) as any[]) {
        const c = r.conta_codigo as string;
        if (!c || !classifs.has(c)) {
          // a chave aqui é classificacao se foi salva como tal; senão pulamos
          // (movimentos podem ser por código — sem inferir grupo)
        }
        const g = grupoDe(c, mascara);
        const dc = Number(r.total_debitos ?? 0) - Number(r.total_creditos ?? 0);
        const padronizado = sinalSaldoInicial(g, dc);
        if (g === "ativo") ativo += padronizado;
        else if (g === "passivo" || g === "pl") passivoPl += padronizado;
      }

      const diferenca = ativo - passivoPl;
      const equilibrado = Math.abs(diferenca) < 0.01;
      return { ativo, passivoPl, diferenca, equilibrado };
    },
  });

  if (isLoading) {
    return (
      <Card className="p-3 mb-4 text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Calculando balanço…
      </Card>
    );
  }
  if (!data) return null;

  return (
    <Card className="p-3 mb-4 flex flex-wrap items-center gap-3 text-sm">
      {data.equilibrado ? (
        <Badge variant="outline" className="text-emerald-600 border-emerald-600/40 gap-1">
          <CheckCircle2 className="h-3 w-3" /> Balanço fecha (dif. {formatBRL(0)})
        </Badge>
      ) : (
        <Badge variant="outline" className="text-amber-600 border-amber-600/40 gap-1">
          <AlertTriangle className="h-3 w-3" /> Balanço NÃO fecha — dif. {formatBRL(data.diferenca)}
        </Badge>
      )}
      <span className="text-xs text-muted-foreground">
        Ativo <strong className="text-foreground">{formatBRL(data.ativo)}</strong> · Passivo+PL <strong className="text-foreground">{formatBRL(data.passivoPl)}</strong>
      </span>
    </Card>
  );
}
