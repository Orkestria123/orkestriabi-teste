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
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/admin/empresas")({ component: Page });

function Page() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", razao_social: "", cnpj: "", regime_tributario: "Lucro Real" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenant_id) {
      toast.error("Tenant não definido para seu usuário.");
      return;
    }
    const { error } = await supabase.from("companies").insert({ ...form, tenant_id: profile.tenant_id });
    if (error) return toast.error(error.message);
    toast.success("Empresa criada");
    setOpen(false);
    setForm({ name: "", razao_social: "", cnpj: "", regime_tributario: "Lucro Real" });
    qc.invalidateQueries({ queryKey: ["companies"] });
  };

  return (
    <PortalShell
      variant="admin"
      title="Empresas"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Nova Empresa</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova Empresa</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div><Label>Nome fantasia</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div><Label>Razão social</Label><Input value={form.razao_social} onChange={(e) => setForm({ ...form, razao_social: e.target.value })} /></div>
              <div><Label>CNPJ</Label><Input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} /></div>
              <div>
                <Label>Regime tributário</Label>
                <Select value={form.regime_tributario} onValueChange={(v) => setForm({ ...form, regime_tributario: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Lucro Real">Lucro Real</SelectItem>
                    <SelectItem value="Lucro Presumido">Lucro Presumido</SelectItem>
                    <SelectItem value="Simples Nacional">Simples Nacional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter><Button type="submit">Criar</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(companies ?? []).map((c: any) => (
          <Card key={c.id} className="p-5">
            <div className="font-semibold">{c.name}</div>
            <div className="text-sm text-muted-foreground mt-0.5">{c.razao_social}</div>
            {c.cnpj && <div className="text-xs text-muted-foreground mt-2">CNPJ {c.cnpj}</div>}
            <div className="mt-3 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary inline-block">{c.regime_tributario}</div>
          </Card>
        ))}
        {(!companies || companies.length === 0) && (
          <Card className="p-10 text-center text-muted-foreground text-sm col-span-full">
            Nenhuma empresa cadastrada. Crie a primeira.
          </Card>
        )}
      </div>
    </PortalShell>
  );
}
