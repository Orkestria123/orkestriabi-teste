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
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createTenant } from "@/lib/api/orkestria.functions";

export const Route = createFileRoute("/orkestria-admin/tenants")({ component: Page });

function Page() {
  const qc = useQueryClient();
  const { data: tenants } = useQuery({
    queryKey: ["tenants"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", slug: "", plan: "starter",
    admin_email: "", admin_name: "", admin_password: "",
    primary_color: "#6366F1",
  });
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createTenant({ data: { ...form, max_companies: 5, max_users: 10 } });
      toast.success("Tenant criado!");
      setOpen(false);
      setForm({ name: "", slug: "", plan: "starter", admin_email: "", admin_name: "", admin_password: "", primary_color: "#6366F1" });
      qc.invalidateQueries({ queryKey: ["tenants"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PortalShell
      variant="orkestria"
      title="Tenants"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />Novo Tenant</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Tenant</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
                <div><Label>Slug</Label><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} required /></div>
              </div>
              <div><Label>Cor primária</Label><Input type="color" value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} className="h-10 w-20 p-1" /></div>
              <div className="pt-2 border-t"><div className="text-xs font-medium text-muted-foreground mb-2 uppercase">Usuário admin do tenant</div></div>
              <div><Label>Nome do admin</Label><Input value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} required /></div>
              <div><Label>E-mail</Label><Input type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} required /></div>
              <div><Label>Senha</Label><Input type="password" value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} required minLength={8} /></div>
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
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Nome</th>
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Slug</th>
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Plano</th>
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Criado em</th>
            </tr>
          </thead>
          <tbody>
            {(tenants ?? []).map((t: any) => (
              <tr key={t.id} className="border-t hover:bg-accent/40">
                <td className="px-4 py-3 font-medium">{t.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{t.slug}</td>
                <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{t.plan}</span></td>
                <td className="px-4 py-3 text-muted-foreground">{new Date(t.created_at).toLocaleDateString("pt-BR")}</td>
              </tr>
            ))}
            {(!tenants || tenants.length === 0) && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">Nenhum tenant ainda. Crie o primeiro!</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </PortalShell>
  );
}
