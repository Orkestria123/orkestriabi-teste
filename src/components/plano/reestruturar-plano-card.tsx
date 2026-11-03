// Reestruturação lógica do Plano Padrão: mover um grupo (com tudo que está
// abaixo) para nova classificação e refazer a hierarquia (pai/nível).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, GitBranch, Loader2, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { tituloConta } from "@/lib/format";
import { limparCacheEstrutura } from "@/lib/plano/estrutura";

type Movimento = {
  contas: number; sinteticas: number; pai_destino: string | null;
  conflitos: { classificacao: string; descricao: string; codigo: string }[];
  lista: { antiga: string; nova: string; descricao: string; sintetica: boolean; empresa: boolean }[];
  dfc_atualizados: number; regras_atualizadas: number; saldos_atualizados: number;
};
type Revisao = {
  pai_divergente: number; nivel_divergente: number;
  exemplos: { classificacao: string; descricao: string; pai_atual: string | null; pai_novo: string | null }[];
  sem_grupo: { classificacao: string; codigo: string; descricao: string }[];
};

export function ReestruturarPlanoCard({ tenantId, podeEditar }: { tenantId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [de, setDe] = useState("");
  const [para, setPara] = useState("");
  const [prev, setPrev] = useState<Movimento | null>(null);
  const [rev, setRev] = useState<Revisao | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const invalidar = async () => {
    limparCacheEstrutura();
    await qc.invalidateQueries();
  };

  const simular = async () => {
    setBusy("sim");
    try {
      const { data, error } = await (supabase as any).rpc("mover_grupo_plano", {
        _tenant_id: tenantId, _de: de, _para: para, _aplicar: false,
      });
      if (error) throw error;
      setPrev(data as Movimento);
    } catch (e: any) { toast.error(e.message); setPrev(null); }
    finally { setBusy(null); }
  };

  const aplicar = async () => {
    if (!prev) return;
    if (!confirm(`Mover ${prev.contas} conta(s) de ${de} para ${para}? Lançamentos e valores não mudam.`)) return;
    setBusy("apl");
    try {
      const { data, error } = await (supabase as any).rpc("mover_grupo_plano", {
        _tenant_id: tenantId, _de: de, _para: para, _aplicar: true,
      });
      if (error) throw error;
      const r = data as Movimento;
      toast.success(`${r.contas} conta(s) movidas. DFC: ${r.dfc_atualizados}, regras: ${r.regras_atualizadas}.`);
      setPrev(null); setDe(""); setPara("");
      await invalidar();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const revisar = async (aplicarRev: boolean) => {
    setBusy(aplicarRev ? "rev-apl" : "rev");
    try {
      const { data, error } = await (supabase as any).rpc("revisar_hierarquia_plano", {
        _tenant_id: tenantId, _aplicar: aplicarRev,
      });
      if (error) throw error;
      setRev(data as Revisao);
      if (aplicarRev) { toast.success("Hierarquia do plano atualizada."); await invalidar(); }
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <GitBranch className="h-4 w-4 text-primary" /> Mover conta ou grupo
        </div>
        <p className="text-xs text-muted-foreground">
          Leva a conta e tudo que está abaixo dela para a nova classificação. Vínculos de DFC,
          regras de de-para e saldos de abertura acompanham. Lançamentos não mudam.
        </p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs">Classificação atual</Label>
            <Input value={de} placeholder="3.01.02.09.90" onChange={(e) => { setDe(e.target.value); setPrev(null); }} />
          </div>
          <ArrowRight className="h-4 w-4 mb-2.5 text-muted-foreground" />
          <div className="flex-1">
            <Label className="text-xs">Nova classificação</Label>
            <Input value={para} placeholder="3.01.01.90" onChange={(e) => { setPara(e.target.value); setPrev(null); }} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={!podeEditar || !de || !para || busy !== null} onClick={simular}>
            {busy === "sim" && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />} Ver o que muda
          </Button>
          <Button size="sm" disabled={!podeEditar || !prev || prev.conflitos.length > 0 || busy !== null} onClick={aplicar}>
            {busy === "apl" && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />} Aplicar
          </Button>
        </div>
        {prev && (
          <div className="space-y-2 text-xs">
            <div>
              <strong>{prev.contas}</strong> conta(s), {prev.sinteticas} grupo(s).
              Novo grupo acima: <strong>{prev.pai_destino ? tituloConta(prev.pai_destino) : "nenhum — confira"}</strong>
            </div>
            {prev.conflitos.length > 0 && (
              <div className="text-destructive">
                Já existem contas no destino: {prev.conflitos.slice(0, 5).map((c) => `${c.classificacao} ${tituloConta(c.descricao)}`).join("; ")}
              </div>
            )}
            <div className="max-h-56 overflow-auto rounded border">
              <table className="w-full">
                <tbody>
                  {prev.lista.map((l) => (
                    <tr key={l.antiga + l.descricao} className="border-t first:border-0">
                      <td className="px-2 py-1 font-mono text-muted-foreground">{l.antiga}</td>
                      <td className="px-2 py-1 font-mono">{l.nova}</td>
                      <td className={`px-2 py-1 ${l.sintetica ? "font-medium" : ""}`}>
                        {tituloConta(l.descricao)}{l.empresa ? " · empresa" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ListChecks className="h-4 w-4 text-primary" /> Conferir hierarquia do plano
        </div>
        <p className="text-xs text-muted-foreground">
          Depois de mudanças na classificação, refaz o grupo acima (conta pai) e o nível de cada
          conta a partir da classificação. Mostra contas que ficaram sem grupo.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => revisar(false)}>
            {busy === "rev" && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />} Conferir
          </Button>
          <Button size="sm" disabled={!podeEditar || !rev || (rev.pai_divergente + rev.nivel_divergente === 0) || busy !== null}
            onClick={() => revisar(true)}>
            {busy === "rev-apl" && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />} Corrigir
          </Button>
        </div>
        {rev && (
          <div className="space-y-2 text-xs">
            <div>
              Grupo acima divergente: <strong>{rev.pai_divergente}</strong> · Nível divergente: <strong>{rev.nivel_divergente}</strong> ·
              Sem grupo: <strong>{rev.sem_grupo.length}</strong>
            </div>
            {rev.exemplos.length > 0 && (
              <ul className="max-h-40 overflow-auto space-y-0.5">
                {rev.exemplos.map((e) => (
                  <li key={e.classificacao + e.descricao}>
                    <span className="font-mono">{e.classificacao}</span> {tituloConta(e.descricao)}:{" "}
                    <span className="text-muted-foreground">{e.pai_atual ?? "—"}</span> → <strong>{e.pai_novo ?? "—"}</strong>
                  </li>
                ))}
              </ul>
            )}
            {rev.sem_grupo.length > 0 && (
              <div className="text-destructive">
                Sem grupo acima: {rev.sem_grupo.slice(0, 10).map((s) => s.classificacao).join(", ")}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
