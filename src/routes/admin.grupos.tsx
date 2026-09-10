import { createFileRoute } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { registrarExclusao } from "@/lib/api/auditoria.functions";

export const Route = createFileRoute("/admin/grupos")({ component: Page });

interface Grupo {
  id: string;
  nome: string;
  empresas: number;
}

function Page() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [editando, setEditando] = useState<Grupo | null>(null);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);

  const { data: grupos, isLoading } = useQuery({
    queryKey: ["grupos"],
    queryFn: async (): Promise<Grupo[]> => {
      const [{ data: gs, error }, { data: comps }] = await Promise.all([
        supabase.from("grupos_economicos").select("id, nome").order("nome"),
        supabase.from("companies").select("id, grupo_id"),
      ]);
      if (error) throw error;
      return (gs ?? []).map((g: any) => ({
        ...g,
        empresas: (comps ?? []).filter((c: any) => c.grupo_id === g.id).length,
      }));
    },
  });

  const abrirNovo = () => { setNome(""); setEditando(null); setCriando(true); };
  const abrirEdicao = (g: Grupo) => { setNome(g.nome); setEditando(g); setCriando(false); };
  const fechar = () => { setEditando(null); setCriando(false); };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const valor = nome.trim();
    if (!valor) return;
    setSalvando(true);
    try {
      if (editando) {
        const { error } = await supabase
          .from("grupos_economicos").update({ nome: valor }).eq("id", editando.id);
        if (error) throw error;
        toast.success("Grupo atualizado");
      } else {
        if (!profile?.tenant_id) throw new Error("Escritório não definido para seu usuário.");
        const { error } = await supabase
          .from("grupos_economicos")
          .insert({ nome: valor, tenant_id: profile.tenant_id });
        if (error) throw error;
        toast.success("Grupo criado");
      }
      fechar();
      qc.invalidateQueries({ queryKey: ["grupos"] });
      qc.invalidateQueries({ queryKey: ["companies"] });
    } catch (e: any) {
      toast.error(
        e.message?.includes("duplicate") ? "Já existe um grupo com esse nome." : e.message,
      );
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async (g: Grupo) => {
    if (g.empresas > 0) {
      toast.error(
        `"${g.nome}" está vinculado a ${g.empresas} empresa(s). Troque o grupo delas antes de excluir.`,
      );
      return;
    }
    if (!confirm(`Excluir o grupo "${g.nome}"?`)) return;
    const { error } = await supabase.from("grupos_economicos").delete().eq("id", g.id);
    if (error) return toast.error(error.message);
    void registrarExclusao({
      data: { entidade: "grupo_economico", entidade_id: g.id, entidade_nome: g.nome },
    }).catch(() => {});
    toast.success("Grupo excluído");
    qc.invalidateQueries({ queryKey: ["grupos"] });
  };

  return (
    <PortalShell
      variant="admin"
      title="Grupos econômicos"
      actions={
        <Button size="sm" onClick={abrirNovo}><Plus className="h-4 w-4 mr-1" />Novo grupo</Button>
      }
    >
      <p className="text-sm text-muted-foreground mb-4">
        Grupos econômicos usados para reunir empresas do mesmo dono/grupo e compará-las.
      </p>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Nome</th>
              <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Empresas</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(grupos ?? []).map((g) => (
              <tr key={g.id} className="border-t">
                <td className="px-4 py-3 font-medium">{g.nome}</td>
                <td className="px-4 py-3">
                  <Badge variant={g.empresas ? "secondary" : "outline"}>{g.empresas}</Badge>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrirEdicao(g)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => excluir(g)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {!isLoading && (grupos ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                  Nenhum grupo cadastrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Dialog open={criando || !!editando} onOpenChange={(o) => { if (!o) fechar(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando ? "Editar grupo" : "Novo grupo"}</DialogTitle>
            <DialogDescription>Ex: Grupo Silva, Holding ABC.</DialogDescription>
          </DialogHeader>
          <form onSubmit={salvar} className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} required autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={fechar}>Cancelar</Button>
              <Button type="submit" disabled={salvando}>
                {salvando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PortalShell>
  );
}
