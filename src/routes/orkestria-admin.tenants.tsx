import { createFileRoute } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Pencil, Upload, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createTenant, deleteTenant } from "@/lib/api/orkestria.functions";


export const Route = createFileRoute("/orkestria-admin/tenants")({ component: Page });

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  primary_color: string;
  logo_url: string | null;
  created_at: string;
}

function Page() {
  const qc = useQueryClient();
  const { data: tenants } = useQuery({
    queryKey: ["tenants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TenantRow[];
    },
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", slug: "", plan: "starter",
    admin_email: "", admin_name: "", admin_password: "",
    primary_color: "#6366F1",
  });
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<TenantRow | null>(null);

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
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Marca</th>
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Nome</th>
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Slug</th>
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Plano</th>
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Cor</th>
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Criado em</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(tenants ?? []).map((t) => (
              <TenantRowItem key={t.id} t={t} onEdit={() => setEditing(t)} onDeleted={() => qc.invalidateQueries({ queryKey: ["tenants"] })} />
            ))}

            {(!tenants || tenants.length === 0) && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Nenhum tenant ainda. Crie o primeiro!</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <BrandingDialog
        tenant={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["tenants"] });
          setEditing(null);
        }}
      />
    </PortalShell>
  );
}

function TenantRowItem({ t, onEdit, onDeleted }: { t: TenantRow; onEdit: () => void; onDeleted: () => void }) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!t.logo_url) { setLogoUrl(null); return; }
      if (/^https?:\/\//.test(t.logo_url)) { setLogoUrl(t.logo_url); return; }
      const { data } = await supabase.storage
        .from("tenant-logos")
        .createSignedUrl(t.logo_url, 60 * 60);
      if (!cancelled) setLogoUrl(data?.signedUrl ?? null);
    })();
    return () => { cancelled = true; };
  }, [t.logo_url]);

  const handleDelete = async () => {
    if (!confirm(`Excluir o tenant "${t.name}"? Todos os usuários, empresas, arquivos e dados serão removidos. Esta ação é irreversível.`)) return;
    setDeleting(true);
    try {
      await deleteTenant({ data: { tenant_id: t.id } });
      toast.success("Tenant excluído");
      onDeleted();
    } catch (e: any) { toast.error(e.message); }
    finally { setDeleting(false); }
  };

  return (
    <tr className="border-t hover:bg-accent/40">
      <td className="px-4 py-3">
        <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center overflow-hidden border">
          {logoUrl
            ? <img src={logoUrl} alt={t.name} className="h-full w-full object-contain" />
            : <span className="text-xs text-muted-foreground">{t.name.slice(0, 2).toUpperCase()}</span>}
        </div>
      </td>
      <td className="px-4 py-3 font-medium">{t.name}</td>
      <td className="px-4 py-3 text-muted-foreground">{t.slug}</td>
      <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{t.plan}</span></td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded border" style={{ backgroundColor: t.primary_color }} />
          <span className="text-xs text-muted-foreground font-mono">{t.primary_color}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{new Date(t.created_at).toLocaleDateString("pt-BR")}</td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Branding
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" disabled={deleting} onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}


function BrandingDialog({
  tenant, onClose, onSaved,
}: {
  tenant: TenantRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [color, setColor] = useState("#6366F1");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setColor(tenant.primary_color || "#6366F1");
    setFile(null);
    setPreview(null);
    if (tenant.logo_url) {
      if (/^https?:\/\//.test(tenant.logo_url)) setPreview(tenant.logo_url);
      else {
        supabase.storage.from("tenant-logos")
          .createSignedUrl(tenant.logo_url, 60 * 60)
          .then(({ data }) => setPreview(data?.signedUrl ?? null));
      }
    }
  }, [tenant]);

  const handleFile = (f: File | null) => {
    setFile(f);
    if (f) setPreview(URL.createObjectURL(f));
  };

  const save = async () => {
    if (!tenant) return;
    setSaving(true);
    try {
      let logoPath: string | undefined;
      if (file) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "png";
        const path = `${tenant.id}/logo-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("tenant-logos")
          .upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) throw upErr;
        logoPath = path;
      }
      const update = { primary_color: color, ...(logoPath ? { logo_url: logoPath } : {}) };
      const { error } = await supabase.from("tenants").update(update).eq("id", tenant.id);
      if (error) throw error;
      toast.success("Branding atualizado");
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!tenant} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Branding — {tenant?.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Logo</Label>
            <div className="mt-2 flex items-center gap-4">
              <div className="h-20 w-20 rounded-lg border bg-muted/30 flex items-center justify-center overflow-hidden">
                {preview
                  ? <img src={preview} alt="Logo" className="h-full w-full object-contain" />
                  : <Upload className="h-6 w-6 text-muted-foreground" />}
              </div>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                />
                <span className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-md hover:bg-accent">
                  <Upload className="h-4 w-4" /> Escolher arquivo
                </span>
              </label>
            </div>
            <p className="text-xs text-muted-foreground mt-2">PNG, JPG, SVG ou WebP. Recomendado: ≤ 2MB.</p>
          </div>
          <div>
            <Label>Cor primária</Label>
            <div className="flex items-center gap-3 mt-2">
              <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-20 p-1" />
              <Input value={color} onChange={(e) => setColor(e.target.value)} className="flex-1 font-mono" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
