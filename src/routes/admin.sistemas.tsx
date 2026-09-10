// Sistemas contábeis de origem (ERP de terceiro) e o layout do arquivo deles.
// O layout é do SISTEMA; o de-para conta a conta continua por empresa.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PortalShell } from "@/components/portal-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Save, Trash2, Table2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/admin/sistemas")({ component: Page });

/** Campos que o importador entende. O valor guardado é o nome da coluna no arquivo. */
const CAMPOS: { chave: string; rotulo: string }[] = [
  { chave: "classificacao", rotulo: "Classificação" },
  { chave: "codigo", rotulo: "Conta / Código" },
  { chave: "sub", rotulo: "Sub" },
  { chave: "descricao", rotulo: "Nome da conta" },
  { chave: "tipo", rotulo: "Tipo" },
  { chave: "nivel", rotulo: "Nível" },
  { chave: "conta_titulo", rotulo: "Cta. título" },
  { chave: "estabelecimento", rotulo: "Estab." },
  { chave: "valor", rotulo: "Valor" },
];

interface Sistema {
  id: string;
  nome: string;
  layout: Record<string, string> | null;
}

function Page() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const qc = useQueryClient();
  const [novo, setNovo] = useState("");
  const [editando, setEditando] = useState<Sistema | null>(null);
  const [salvando, setSalvando] = useState(false);

  const { data: sistemas = [], isLoading } = useQuery({
    queryKey: ["sistemas-contabeis", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sistemas_contabeis")
        .select("id, nome, layout")
        .eq("tenant_id", tenantId)
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Sistema[];
    },
  });

  const criar = async () => {
    if (!tenantId || !novo.trim()) return;
    const { error } = await (supabase as any)
      .from("sistemas_contabeis")
      .insert({ tenant_id: tenantId, nome: novo.trim(), layout: {} });
    if (error) { toast.error(error.message); return; }
    setNovo("");
    toast.success("Sistema criado.");
    qc.invalidateQueries({ queryKey: ["sistemas-contabeis", tenantId] });
  };

  const excluir = async (s: Sistema) => {
    if (!confirm(`Excluir o sistema "${s.nome}"? As empresas ligadas a ele ficam sem layout.`)) return;
    const { error } = await (supabase as any).from("sistemas_contabeis").delete().eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Sistema excluído.");
    qc.invalidateQueries({ queryKey: ["sistemas-contabeis", tenantId] });
  };

  const salvarLayout = async () => {
    if (!editando) return;
    setSalvando(true);
    try {
      const { error } = await (supabase as any)
        .from("sistemas_contabeis")
        .update({ nome: editando.nome, layout: editando.layout ?? {}, updated_at: new Date().toISOString() })
        .eq("id", editando.id);
      if (error) throw new Error(error.message);
      toast.success("Layout salvo.");
      setEditando(null);
      qc.invalidateQueries({ queryKey: ["sistemas-contabeis", tenantId] });
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <PortalShell variant="admin" title="Sistemas e layouts">
      <Card className="p-4 mb-4 border-primary/20 bg-primary/5">
        <div className="flex items-start gap-3 text-sm">
          <Table2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Como o arquivo do ERP vem</div>
            <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">
              Cada sistema de terceiro exporta o plano e o diário com nomes de coluna
              próprios. Aqui se diz qual coluna do arquivo é a Classificação, o Nome,
              o Valor e assim por diante. O de-para conta a conta continua dentro de
              cada empresa.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-4 mb-4">
        <div className="flex items-end gap-2 flex-wrap">
          <div className="grow min-w-[220px]">
            <Label className="text-xs">Novo sistema</Label>
            <Input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Ex.: Domínio, Alterdata, Sage" />
          </div>
          <Button size="sm" onClick={criar} disabled={!novo.trim()}>
            <Plus className="h-4 w-4 mr-1.5" /> Adicionar
          </Button>
        </div>
      </Card>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      )}

      <Card className="divide-y">
        {sistemas.map((s) => (
          <div key={s.id} className="px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">{s.nome}</div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditando(editando?.id === s.id ? null : { ...s, layout: { ...(s.layout ?? {}) } })}>
                  {editando?.id === s.id ? "Fechar" : "Editar layout"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => excluir(s)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>

            {editando?.id === s.id && (
              <div className="mt-3 space-y-3">
                <div className="max-w-sm">
                  <Label className="text-xs">Nome</Label>
                  <Input
                    value={editando.nome}
                    onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {CAMPOS.map((c) => (
                    <div key={c.chave}>
                      <Label className="text-xs">{c.rotulo}</Label>
                      <Input
                        value={(editando.layout ?? {})[c.chave] ?? ""}
                        placeholder="nome da coluna no arquivo"
                        onChange={(e) =>
                          setEditando({
                            ...editando,
                            layout: { ...(editando.layout ?? {}), [c.chave]: e.target.value },
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
                <Button size="sm" onClick={salvarLayout} disabled={salvando}>
                  {salvando ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                  Salvar layout
                </Button>
              </div>
            )}
          </div>
        ))}
        {!isLoading && sistemas.length === 0 && (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            Nenhum sistema cadastrado ainda.
          </div>
        )}
      </Card>
    </PortalShell>
  );
}
