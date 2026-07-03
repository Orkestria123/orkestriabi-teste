// Dialog para duplicar indicadores de outra empresa.
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { IndicadorEmpresa } from "@/lib/indicadores/engine";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  companyId: string;
  planoClassificacoes: Set<string>;
  onDone: () => void;
}

export function DuplicarIndicadoresDialog({
  open, onOpenChange, tenantId, companyId, planoClassificacoes, onDone,
}: Props) {
  const [empresaSrc, setEmpresaSrc] = useState<string>("");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) { setEmpresaSrc(""); setSelecionados(new Set()); }
  }, [open]);

  const { data: empresas } = useQuery({
    queryKey: ["dup-empresas", tenantId, companyId],
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

  const { data: indicadoresSrc, isLoading } = useQuery({
    queryKey: ["dup-indics", empresaSrc],
    enabled: !!empresaSrc,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("indicadores_empresa" as any)
        .select("*")
        .eq("company_id", empresaSrc)
        .order("categoria")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as IndicadorEmpresa[];
    },
  });

  const todos = useMemo(() => indicadoresSrc ?? [], [indicadoresSrc]);
  const toggleTodos = (v: boolean) => {
    if (v) setSelecionados(new Set(todos.map((t) => t.id)));
    else setSelecionados(new Set());
  };
  const toggleOne = (id: string) => {
    const nx = new Set(selecionados);
    if (nx.has(id)) nx.delete(id); else nx.add(id);
    setSelecionados(nx);
  };

  const duplicar = async () => {
    if (selecionados.size === 0) { toast.error("Selecione ao menos um indicador."); return; }
    setSaving(true);
    try {
      const escolhidos = todos.filter((t) => selecionados.has(t.id));
      const inserts = escolhidos.map((ind) => {
        // Verifica se alguma conta da fórmula não existe no plano atual.
        let revisar = false;
        for (const tk of ind.formula?.expressao ?? []) {
          if (tk.tipo === "termo" && (tk.origem ?? "conta") === "conta") {
            for (const c of tk.contas ?? []) {
              if (!planoClassificacoes.has(c)) { revisar = true; break; }
            }
          }
          if (revisar) break;
        }
        return {
          tenant_id: tenantId,
          company_id: companyId,
          nome: ind.nome,
          categoria: ind.categoria,
          descricao: ind.descricao,
          modo_analise: ind.modo_analise,
          formula: ind.formula,
          faixas: ind.faixas,
          visibilidade: "invisivel",
          is_padrao: false,
          revisar_contas: revisar,
        };
      });
      const { error } = await supabase.from("indicadores_empresa" as any).insert(inserts);
      if (error) throw error;
      const revisandos = inserts.filter((i) => i.revisar_contas).length;
      toast.success(`${inserts.length} indicador(es) duplicados${revisandos > 0 ? ` — ${revisandos} para revisar contas` : ""}`);
      onDone();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Duplicar Indicadores de Outra Empresa</DialogTitle>
        </DialogHeader>

        <div>
          <Label className="text-xs">Empresa de origem</Label>
          <select
            value={empresaSrc}
            onChange={(e) => { setEmpresaSrc(e.target.value); setSelecionados(new Set()); }}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Selecione…</option>
            {(empresas ?? []).map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>

        {empresaSrc && (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="p-2 border-b border-border flex items-center justify-between bg-muted/40">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox
                  checked={selecionados.size === todos.length && todos.length > 0}
                  onCheckedChange={(v) => toggleTodos(!!v)}
                />
                Selecionar todos
              </label>
              <span className="text-[11px] text-muted-foreground">
                {selecionados.size} / {todos.length} selecionados
              </span>
            </div>
            <div className="max-h-[380px] overflow-y-auto">
              {isLoading && (
                <div className="p-4 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
                </div>
              )}
              {!isLoading && todos.length === 0 && (
                <div className="p-4 text-xs text-muted-foreground">Nenhum indicador nesta empresa.</div>
              )}
              {todos.map((ind) => (
                <label key={ind.id} className="flex items-start gap-2 p-2 border-b border-border last:border-b-0 hover:bg-accent cursor-pointer">
                  <Checkbox
                    checked={selecionados.has(ind.id)}
                    onCheckedChange={() => toggleOne(ind.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{ind.nome}</span>
                      <Badge variant="outline" className="text-[9px]">{ind.categoria}</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{ind.modo_analise}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={duplicar} disabled={saving || selecionados.size === 0}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Duplicar {selecionados.size > 0 ? `(${selecionados.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
