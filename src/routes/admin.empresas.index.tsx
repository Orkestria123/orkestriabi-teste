import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
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
import { Plus, Search, BarChart3, ArrowRight, Trash2, Database } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { deleteCompany } from "@/lib/api/orkestria.functions";


export const Route = createFileRoute("/admin/empresas/")({ component: Page });

function Page() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("*, sped_files(count)")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", razao_social: "", cnpj: "", regime_tributario: "Lucro Real" });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return companies ?? [];
    return (companies ?? []).filter((c: any) =>
      [c.name, c.razao_social, c.cnpj].filter(Boolean).some((v: string) => v.toLowerCase().includes(s)),
    );
  }, [companies, search]);

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

  const openBI = (id: string) => navigate({ to: "/dashboard", search: { company: id } as any });

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Excluir a empresa "${name}"? Todos os arquivos e demonstrações serão removidos.`)) return;
    try {
      await deleteCompany({ data: { company_id: id } });
      toast.success("Empresa excluída");
      qc.invalidateQueries({ queryKey: ["companies"] });
    } catch (e: any) { toast.error(e.message); }
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
      <div className="mb-4 relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar empresa por nome, razão social ou CNPJ…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((c: any) => {
          const spedCount = c.sped_files?.[0]?.count ?? 0;
          return (
            <Card key={c.id} className="p-5 flex flex-col group hover:border-primary/40 transition-colors">
              <div className="flex-1">
                <div className="font-semibold">{c.name}</div>
                <div className="text-sm text-muted-foreground mt-0.5">{c.razao_social}</div>
                {c.cnpj && <div className="text-xs text-muted-foreground mt-2">CNPJ {c.cnpj}</div>}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{c.regime_tributario}</span>
                  <span className="text-xs text-muted-foreground">{spedCount} SPED</span>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => openBI(c.id)}
                  disabled={spedCount === 0 && (c.fonte_dados ?? "sped") === "sped"}
                >
                  <BarChart3 className="h-4 w-4 mr-1.5" />
                  Abrir BI
                  <ArrowRight className="h-3.5 w-3.5 ml-auto" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-9 w-9"
                  onClick={() => navigate({ to: "/admin/empresas/$id/dados", params: { id: c.id } })}
                  title="Dados contábeis (plano, mapeamento, diário)"
                >
                  <Database className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(c.id, c.name)}
                  title="Excluir empresa"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <Link
                to="/admin/empresas/$id/dados"
                params={{ id: c.id }}
                className="text-xs text-muted-foreground hover:text-primary text-center mt-2"
              >
                {(c.fonte_dados ?? "sped") === "diario"
                  ? "Gerenciar plano e diários →"
                  : "Configurar plano de contas e diário →"}
              </Link>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <Card className="p-10 text-center text-muted-foreground text-sm col-span-full">
            {search ? "Nenhuma empresa encontrada para esta busca." : "Nenhuma empresa cadastrada. Crie a primeira."}
          </Card>
        )}
      </div>
    </PortalShell>
  );
}
