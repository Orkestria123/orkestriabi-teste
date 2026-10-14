// Importa (ou atualiza) o Plano Padrão do escritório a partir do CSV do sistema contábil.
// Mesmo formato do plano da empresa: Código;Classificação;Descrição;Tipo;Natureza.
// Não apaga nada: contas novas entram, existentes (mesmo código) são atualizadas.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { parsePlanoContasCSV, type PlanoParseResult } from "@/lib/diario/plano-parser";
import { getMascaraConfig } from "@/lib/mascara/interpretar";

const LOTE = 500;

export function ImportarPlanoPadrao({ tenantId, podeEditar }: { tenantId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<PlanoParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const ler = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const mascara = await getMascaraConfig({ tenantId, companyId: null } as any);
      setParsed(await parsePlanoContasCSV(f, mascara));
    } catch (e: any) {
      toast.error(e.message ?? String(e));
      setParsed(null);
    } finally {
      setBusy(false);
    }
  };

  const importar = async () => {
    if (!parsed) return;
    setBusy(true);
    setProgress(0);
    let novas = 0;
    let atualizadas = 0;
    try {
      for (let i = 0; i < parsed.rows.length; i += LOTE) {
        const { data, error } = await supabase.rpc("atualizar_plano_padrao", {
          _tenant_id: tenantId,
          _company_id: null as any,
          _rows: parsed.rows.slice(i, i + LOTE) as any,
        });
        if (error) throw error;
        novas += (data as any)?.novas ?? 0;
        atualizadas += (data as any)?.atualizadas ?? 0;
        setProgress(Math.round((Math.min(i + LOTE, parsed.rows.length) / parsed.rows.length) * 100));
      }
      toast.success(`Plano importado: ${novas} conta(s) nova(s), ${atualizadas} atualizada(s).`);
      setParsed(null);
      qc.invalidateQueries({ queryKey: ["plano-padrao-resumo", tenantId] });
      qc.invalidateQueries({ queryKey: ["plano-padrao-contas", tenantId] });
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 max-w-2xl">
      <div className="text-sm font-medium mb-1 flex items-center gap-2">
        <Upload className="h-4 w-4 text-primary" /> Importar plano de contas
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Arquivo CSV exportado do sistema contábil, com as colunas Código; Classificação; Descrição;
        Tipo; Natureza. Contas novas são incluídas e as existentes (mesmo código) são atualizadas.
        Nenhuma conta é apagada e as alocações de DRE, Balanço e DFC já feitas são mantidas.
      </p>
      <Input type="file" accept=".csv,.txt" disabled={!podeEditar || busy}
        onChange={(e) => { void ler(e.target.files?.[0]); e.target.value = ""; }} />

      {parsed && (
        <div className="mt-4 space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <Resumo label="Contas no arquivo" valor={parsed.total} />
            <Resumo label="Estruturais" valor={parsed.estruturais} />
            <Resumo label="Participantes" valor={parsed.participantes} />
          </div>
          {parsed.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-600">{w}</p>
          ))}
          {busy && <Progress value={progress} />}
          <div className="flex gap-2">
            <Button onClick={importar} disabled={busy || parsed.total === 0}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Importar {parsed.total} contas
            </Button>
            <Button variant="outline" onClick={() => setParsed(null)} disabled={busy}>Cancelar</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Resumo({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{valor}</div>
    </div>
  );
}
