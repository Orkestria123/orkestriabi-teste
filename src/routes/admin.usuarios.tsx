import { createFileRoute } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClientUser, createTenantAdminUser, deleteUserAccount } from "@/lib/api/orkestria.functions";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/admin/usuarios")({ component: Page });

function Page() {
  const qc = useQueryClient();
  const { userId } = useAuth();
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Excluir o usuário "${name}"? Esta ação não pode ser desfeita.`)) return;
    setDeleting(id);
    try {
      await deleteUserAccount({ data: { user_id: id } });
      toast.success("Usuário excluído");
      qc.invalidateQueries({ queryKey: ["tenant-users"] });
    } catch (e: any) { toast.error(e.message); }
    finally { setDeleting(null); }
  };
  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await supabase.from("companies").select("id,name").order("name")).data ?? [],
  });
  const { data: users } = useQuery({
    queryKey: ["tenant-users"],
    queryFn: async () => {
      const [{ data: profs }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("*, companies(name)"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      const byId = new Map((roles ?? []).map((r: any) => [r.user_id, r.role]));
      return (profs ?? []).map((p: any) => ({ ...p, role: byId.get(p.id) ?? null }));
    },
  });
  const [open, setOpen] = useState(false);
  const [perfil, setPerfil] = useState<"client" | "tenant_admin">("client");
  const [form, setForm] = useState({ full_name: "", email: "", password: "", company_id: "" });
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (perfil === "client" && !form.company_id) {
      toast.error("Selecione a empresa");
      return;
    }
    setLoading(true);
    try {
      if (perfil === "tenant_admin") {
        const { company_id: _ignored, ...rest } = form;
        await createTenantAdminUser({ data: rest });
      } else {
        await createClientUser({ data: form });
      }
      toast.success("Usuário criado");
      setOpen(false);
      setForm({ full_name: "", email: "", password: "", company_id: "" });
      qc.invalidateQueries({ queryKey: ["tenant-users"] });
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };


  return (
    <PortalShell
      variant="admin"
      title="Usuários"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Novo Usuário</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label>Perfil</Label>
                <Select value={perfil} onValueChange={(v) => setPerfil(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="client">Cliente (acesso ao BI de uma empresa)</SelectItem>
                    <SelectItem value="tenant_admin">Admin do escritório</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Nome</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></div>
              <div><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
              <div><Label>Senha temporária</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></div>
              {perfil === "client" && (
                <div>
                  <Label>Empresa</Label>
                  <Select value={form.company_id} onValueChange={(v) => setForm({ ...form, company_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>{(companies ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}

              <DialogFooter><Button type="submit" disabled={loading}>{loading ? "Criando…" : "Criar"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Nome</th>
              <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">E-mail</th>
              <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Empresa</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u: any) => (
              <tr key={u.id} className="border-t">
                <td className="px-4 py-3 font-medium">{u.full_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                <td className="px-4 py-3">{u.companies?.name ?? "—"}</td>
                <td className="px-4 py-3 text-right">
                  {u.id !== userId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      disabled={deleting === u.id}
                      onClick={() => handleDelete(u.id, u.full_name ?? u.email)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </PortalShell>
  );
}
