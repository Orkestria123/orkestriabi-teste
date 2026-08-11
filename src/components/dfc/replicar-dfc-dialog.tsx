// Replica a configuração da DFC (dfc_config + dfc_linha_contas) de outra empresa.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { DFC_LINHAS, BLOCO_LABEL, type DfcOperacao } from "@/lib/dfc/estrutura";

interface LinhaRow {
  metodo: string;
  linha: string;
  contas: string[] | null;
  operacao: DfcOperacao;
  ordem: number;
}

const GRUPOS = [
  { key: "indireto", label: "Método Indireto (operacional)" },
  { key: "direto", label: "Método Direto (operacional)" },
  { key: "ambos", label: "Investimento / Financiamento" },
] as const;

export function ReplicarDfcDialog({
  open,
  onOpenChange,
  tenantId,
  companyId,
  planoClassificacoes,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  companyId: string;
  planoClassificacoes: Set<string>;
  onDone: () => void;
}) {
  const [empresaSrc, setEmpresaSrc] = useState("");
  const [grupos, setGrupos] = useState<Set<string>>(new Set(["indireto", "direto", "ambos"]));
  const [copiarConfig, setCopiarConfig] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setEmpresaSrc("");
      setGrupos(new Set(["indireto", "direto", "ambos"]));
      setCopiarConfig(true);
    }
  }, [open]);

  const { data: empresas } = useQuery({
    queryKey: ["dfc-dup-empresas", tenantId, companyId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .neq("id", companyId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: origem, isLoading } = useQuery({
    queryKey: ["dfc-dup-origem", empresaSrc],
    enabled: !!empresaSrc,
    queryFn: async () => {
      const [linhas, cfg] = await Promise.all([
        supabase.from("dfc_linha_contas" as any).select("*").eq("company_id", empresaSrc),
        supabase
          .from("dfc_config" as any)
          .select("*")
          .eq("company_id", empresaSrc)
          .maybeSingle(),
      ]);
      if (linhas.error) throw linhas.error;
      if (cfg.error) throw cfg.error;
      return {
        linhas: (linhas.data ?? []) as unknown as LinhaRow[],
        config: (cfg.data ?? null) as any,
      };
    },
  });

  const linhasFiltradas = useMemo(
    () => (origem?.linhas ?? []).filter((l) => grupos.has(l.metodo)),
    [origem, grupos],
  );

  const faltantes = useMemo(() => {
    let n = 0;
    for (const l of linhasFiltradas) {
      if ((l.contas ?? []).some((c) => !planoClassificacoes.has(c))) n++;
    }
    return n;
  }, [linhasFiltradas, planoClassificacoes]);

  const toggleGrupo = (k: string) => {
    const nx = new Set(grupos);
    if (nx.has(k)) nx.delete(k);
    else nx.add(k);
    setGrupos(nx);
  };

  const replicar = async () => {
    if (linhasFiltradas.length === 0 && !copiarConfig) {
      toast.error("Nada selecionado para replicar.");
      return;
    }
    setSaving(true);
    try {
      if (linhasFiltradas.length > 0) {
        const rows = linhasFiltradas.map((l) => ({
          tenant_id: tenantId,
          company_id: companyId,
          metodo: l.metodo,
          linha: l.linha,
          contas: l.contas ?? [],
          operacao: l.operacao,
          ordem: l.ordem,
        }));
        const { error } = await supabase
          .from("dfc_linha_contas" as any)
          .upsert(rows as any, { onConflict: "company_id,metodo,linha" });
        if (error) throw error;
      }
      if (copiarConfig && origem?.config) {
        const { error } = await supabase.from("dfc_config" as any).upsert(
          {
            tenant_id: tenantId,
            company_id: companyId,
            metodo_padrao: origem.config.metodo_padrao ?? "indireto",
            conta_caixa: origem.config.conta_caixa ?? [],
          } as any,
          { onConflict: "company_id" },
        );
        if (error) throw error;
      }
      toast.success(
        `Configuração replicada (${linhasFiltradas.length} linha(s))` +
          (faltantes > 0 ? ` — ${faltantes} para revisar contas` : ""),
      );
      onDone();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Erro ao replicar", { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const labelLinha = (key: string) => DFC_LINHAS.find((d) => d.key === key)?.label ?? key;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Replicar configuração da DFC de outra empresa</DialogTitle>
        </DialogHeader>

        <div>
          <Label className="text-xs">Empresa de origem</Label>
          <select
            value={empresaSrc}
            onChange={(e) => setEmpresaSrc(e.target.value)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Selecione…</option>
            {(empresas ?? []).map((e: any) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>

        {empresaSrc && (
          <div className="space-y-3">
            {isLoading && (
              <div className="p-4 text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Carregando configuração…
              </div>
            )}

            {!isLoading && (
              <>
                <div className="space-y-2">
                  {GRUPOS.map((g) => {
                    const total = (origem?.linhas ?? []).filter((l) => l.metodo === g.key).length;
                    return (
                      <label
                        key={g.key}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <Checkbox
                          checked={grupos.has(g.key)}
                          onCheckedChange={() => toggleGrupo(g.key)}
                        />
                        {g.label}
                        <Badge variant="outline" className="text-[10px]">
                          {total} linha(s)
                        </Badge>
                      </label>
                    );
                  })}
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={copiarConfig}
                      onCheckedChange={(v) => setCopiarConfig(!!v)}
                    />
                    Método padrão e contas de Caixa/Disponível
                  </label>
                </div>

                {faltantes > 0 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                    <span>
                      {faltantes} linha(s) têm contas que não existem no plano desta empresa. Serão
                      replicadas mesmo assim e marcadas como <strong>Revisar contas</strong>.
                    </span>
                  </div>
                )}

                <div className="border border-border rounded-lg max-h-[300px] overflow-y-auto">
                  {linhasFiltradas.length === 0 && (
                    <div className="p-3 text-xs text-muted-foreground">
                      Nenhuma linha configurada na origem para os blocos selecionados.
                    </div>
                  )}
                  {linhasFiltradas.map((l) => {
                    const def = DFC_LINHAS.find((d) => d.key === l.linha);
                    const revisar = (l.contas ?? []).some((c) => !planoClassificacoes.has(c));
                    return (
                      <div
                        key={`${l.metodo}::${l.linha}`}
                        className="p-2 border-b border-border last:border-b-0 text-xs flex items-center gap-2"
                      >
                        <span className="flex-1 truncate">{labelLinha(l.linha)}</span>
                        {def && (
                          <span className="text-[10px] text-muted-foreground">
                            {BLOCO_LABEL[def.bloco]}
                          </span>
                        )}
                        <Badge variant="secondary" className="text-[10px]">
                          {(l.contas ?? []).length} conta(s)
                        </Badge>
                        {revisar && (
                          <Badge variant="outline" className="text-[10px] border-amber-500/60">
                            Revisar contas
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={replicar} disabled={saving || !empresaSrc}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Replicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
