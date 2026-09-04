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

export const Route = createFileRoute("/admin/segmentos")({ component: Page });

interface Segmento {
  id: string;
  nome: string;
  empresas: number;
}

function Page() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [editando, setEditando] = useState<Segmento | null>(null);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);

  const { data: segmentos, isLoading } = useQuery({
    queryKey: ["segmentos"],
    queryFn: async (): Promise<Segmento[]> => {
      const [{ data: segs, error }, { data: comps }] = await Promise.all([
        supabase.from("segmentos").select("id, nome").order("nome"),
        supabase.from("companies").select("id, segmento_id"),
      ]);
      if (error) throw error;
      return (segs ?? []).map((s: any) => ({
        ...s,
        empresas: (comps ?? []).filter((c: any) => c.segmento_id === s.id).length,
      }));
    },
  });

  const abrirNovo = () => { setNome(""); setEditando(null); setCriando(true); };
  const abrirEdicao = (s: Segmento) => { setNome(s.nome); setEditando(s); setCriando(false); };
  const fechar = () => { setEditando(null); setCriando(false); };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const valor = nome.trim();
    if (!valor) return;
    setSalvando(true);
    try {
      if (editando) {
        const { error } = await supabase.from("segmentos").update({ nome: valor }).eq("id", editando.id);
        if (error) throw error;
        toast.success("Segmento atualizado");
      } else {
        if (!profile?.tenant_id) throw new Error("Escritório não definido para seu usuário.");
        const { error } = await supabase
          .from("segmentos")
          .insert({ nome: valor, tenant_id: profile.tenant_id });
        if (error) throw error;
        toast.success("Segmento criado");
      }
      fechar();
      qc.invalidateQueries({ queryKey: ["segmentos"] });
      qc.invalidateQueries({ queryKey: ["companies"] });
    } catch (e: any) {
      toast.error(
        e.message?.includes("duplicate") ? "Já existe um segmento com esse nome." : e.message,
      );
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async (s: Segmento) => {
    if (s.empresas > 0) {
      toast.error(
        `"${s.nome}" está vinculado a ${s.empresas} empresa(s). Troque o segmento delas antes de excluir.`,
      );
      return;
    }
    if (!confirm(`Excluir o segmento "${s.nome}"?`)) return;
    const { error } = await supabase.from("segmentos").delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    void registrarExclusao({
      data: { entidade: "segmento", entidade_id: s.id, entidade_nome: s.nome },
    }).catch(() => {});
    toast.success("Segmento excluído");
    qc.invalidateQueries({ queryKey: ["segmentos"] });

  };

  return (
    <PortalShell
      variant="admin"
      title="Segmentos"
      actions={
        <Button size="sm" onClick={abrirNovo}><Plus className="h-4 w-4 mr-1" />Novo segmento</Button>
      }
    >
      <p className="text-sm text-muted-foreground mb-4">
        Segmentos de atuação usados na classificação das empresas do escritório.
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
            {(segmentos ?? []).map((s) => (
              <tr key={s.id} className="border-t">
                <td className="px-4 py-3 font-medium">{s.nome}</td>
                <td className="px-4 py-3">
                  <Badge variant={s.empresas ? "secondary" : "outline"}>{s.empresas}</Badge>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrirEdicao(s)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => excluir(s)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {!isLoading && (segmentos ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                  Nenhum segmento cadastrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Dialog open={criando || !!editando} onOpenChange={(o) => { if (!o) fechar(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando ? "Editar segmento" : "Novo segmento"}</DialogTitle>
            <DialogDescription>Ex: Transporte, Comércio, Indústria, Serviços.</DialogDescription>
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
