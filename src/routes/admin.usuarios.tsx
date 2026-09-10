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
import { createClientUser, deleteUserAccount, vincularUsuarioEmpresa } from "@/lib/api/orkestria.functions";
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
    queryFn: async () => (await supabase.from("profiles").select("*, companies(name)")).data ?? [],
  });
  const [vinculando, setVinculando] = useState<string | null>(null);
  const [empresaAlvo, setEmpresaAlvo] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);

  const handleVincular = async (userIdAlvo: string, como: "client" | "tenant_admin") => {
    const company_id = empresaAlvo[userIdAlvo];
    if (!company_id) {
      toast.error("Escolha a empresa (Casa do Vidro, etc.).");
      return;
    }
    setVinculando(userIdAlvo);
    try {
      await vincularUsuarioEmpresa({ data: { user_id: userIdAlvo, company_id, como } });
      toast.success(como === "client" ? "Usuário ligado à empresa." : "Usuário virou admin deste escritório.");
      qc.invalidateQueries({ queryKey: ["tenant-users"] });
    } catch (e: any) { toast.error(e.message); }
    finally { setVinculando(null); }
  };
  const [form, setForm] = useState({ full_name: "", email: "", password: "", company_id: "" });
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createClientUser({ data: form });
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
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Novo Cliente</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo usuário cliente</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div><Label>Nome</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></div>
              <div><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
              <div><Label>Senha temporária</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></div>
              <div>
                <Label>Empresa</Label>
                <Select value={form.company_id} onValueChange={(v) => setForm({ ...form, company_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{(companies ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <DialogFooter><Button type="submit" disabled={loading}>{loading ? "Criando…" : "Criar"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      <p className="text-sm text-muted-foreground mb-3">
        Cliente tem que nascer em <strong>Novo Cliente</strong> com a empresa escolhida — não em “novo escritório”.
        Quem já ficou em escritório vazio: escolha a empresa na linha e clique Vincular.
      </p>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Nome</th>
              <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">E-mail</th>
              <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Empresa</th>
              <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Vincular</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u: any) => (
              <tr key={u.id} className="border-t">
                <td className="px-4 py-3 font-medium">{u.full_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                <td className="px-4 py-3">{u.companies?.name ?? "—"}</td>
                <td className="px-4 py-3">
                  {u.id !== userId && (
                    <div className="flex flex-wrap items-center gap-1">
                      <Select
                        value={empresaAlvo[u.id] ?? ""}
                        onValueChange={(v) => setEmpresaAlvo((prev) => ({ ...prev, [u.id]: v }))}
                      >
                        <SelectTrigger className="h-8 w-[180px] text-xs">
                          <SelectValue placeholder="Empresa" />
                        </SelectTrigger>
                        <SelectContent>
                          {(companies ?? []).map((c: any) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" className="h-8 text-xs"
                        disabled={vinculando === u.id}
                        onClick={() => handleVincular(u.id, "client")}>
                        Cliente
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 text-xs"
                        disabled={vinculando === u.id}
                        onClick={() => handleVincular(u.id, "tenant_admin")}>
                        Admin
                      </Button>
                    </div>
                  )}
                </td>
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
