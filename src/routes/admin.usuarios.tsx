import { createFileRoute } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Pencil, Building2, Search } from "lucide-react";
import { toast } from "sonner";
import { createUsuario, updateUsuario, deleteUserAccount } from "@/lib/api/orkestria.functions";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/admin/usuarios")({ component: Page });

type Tipo = "admin_escritorio" | "cliente";

interface UsuarioRow {
  id: string;
  full_name: string | null;
  email: string | null;
  telefone: string | null;
  tipo_usuario: Tipo | null;
  empresas: { id: string; name: string }[];
}

function Page() {
  const qc = useQueryClient();
  const { userId } = useAuth();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<UsuarioRow | null>(null);
  const [creating, setCreating] = useState<Tipo | null>(null);

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () =>
      (await supabase.from("companies").select("id,name").order("name")).data ?? [],
  });

  const { data: users } = useQuery({
    queryKey: ["tenant-users"],
    queryFn: async (): Promise<UsuarioRow[]> => {
      const [{ data: profs }, { data: vinculos }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, telefone, tipo_usuario")
          .order("full_name"),
        supabase.from("usuario_empresas").select("user_id, company_id, companies(name)"),
      ]);
      return (profs ?? []).map((p: any) => ({
        ...p,
        empresas: (vinculos ?? [])
          .filter((v: any) => v.user_id === p.id)
          .map((v: any) => ({ id: v.company_id, name: v.companies?.name ?? "—" })),
      }));
    },
  });

  const colaboradores = useMemo(
    () => (users ?? []).filter((u) => u.tipo_usuario !== "cliente"),
    [users],
  );
  const clientes = useMemo(
    () => (users ?? []).filter((u) => u.tipo_usuario === "cliente"),
    [users],
  );

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

  const refetch = () => qc.invalidateQueries({ queryKey: ["tenant-users"] });

  return (
    <PortalShell variant="admin" title="Usuários">
      <Tabs defaultValue="colaboradores" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="colaboradores">
              Colaboradores <Badge variant="secondary" className="ml-2">{colaboradores.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="clientes">
              Clientes <Badge variant="secondary" className="ml-2">{clientes.length}</Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="colaboradores" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Equipe do escritório — acesso a todas as empresas do tenant.
            </p>
            <Button size="sm" onClick={() => setCreating("admin_escritorio")}>
              <Plus className="h-4 w-4 mr-1" />Novo colaborador
            </Button>
          </div>
          <UserTable
            rows={colaboradores}
            selfId={userId}
            showEmpresas={false}
            deleting={deleting}
            onEdit={setEditing}
            onDelete={handleDelete}
          />
        </TabsContent>

        <TabsContent value="clientes" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Clientes finais — veem somente as empresas vinculadas, em modo leitura.
            </p>
            <Button size="sm" onClick={() => setCreating("cliente")}>
              <Plus className="h-4 w-4 mr-1" />Novo cliente
            </Button>
          </div>
          <UserTable
            rows={clientes}
            selfId={userId}
            showEmpresas
            deleting={deleting}
            onEdit={setEditing}
            onDelete={handleDelete}
          />
        </TabsContent>
      </Tabs>

      <UsuarioDialog
        open={!!creating || !!editing}
        user={editing}
        tipoInicial={creating ?? "cliente"}
        companies={(companies ?? []) as any}
        onClose={() => { setCreating(null); setEditing(null); }}
        onSaved={() => { setCreating(null); setEditing(null); refetch(); }}
      />
    </PortalShell>
  );
}

function UserTable({
  rows, selfId, showEmpresas, deleting, onEdit, onDelete,
}: {
  rows: UsuarioRow[];
  selfId: string | null;
  showEmpresas: boolean;
  deleting: string | null;
  onEdit: (u: UsuarioRow) => void;
  onDelete: (id: string, name: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30">
          <tr>
            <Th>Nome</Th>
            <Th>E-mail</Th>
            <Th>Telefone</Th>
            {showEmpresas && <Th>Empresas vinculadas</Th>}
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className="border-t align-top">
              <td className="px-4 py-3 font-medium">{u.full_name ?? "—"}</td>
              <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
              <td className="px-4 py-3 text-muted-foreground">{u.telefone || "—"}</td>
              {showEmpresas && (
                <td className="px-4 py-3">
                  {u.empresas.length === 0 ? (
                    <span className="text-xs text-destructive">Sem empresa vinculada</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {u.empresas.map((e) => (
                        <Badge key={e.id} variant="outline" className="text-xs font-normal">
                          <Building2 className="h-3 w-3 mr-1" />{e.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </td>
              )}
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(u)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                {u.id !== selfId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    disabled={deleting === u.id}
                    onClick={() => onDelete(u.id, u.full_name ?? u.email ?? "")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showEmpresas ? 5 : 4} className="px-4 py-10 text-center text-muted-foreground">
                Nenhum usuário nesta seção.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </th>
  );
}

function UsuarioDialog({
  open, user, tipoInicial, companies, onClose, onSaved,
}: {
  open: boolean;
  user: UsuarioRow | null;
  tipoInicial: Tipo;
  companies: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tipo, setTipo] = useState<Tipo>(tipoInicial);
  const [form, setForm] = useState({ full_name: "", email: "", telefone: "", password: "" });
  const [vinculos, setVinculos] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (user) {
      setTipo((user.tipo_usuario as Tipo) ?? "cliente");
      setForm({
        full_name: user.full_name ?? "",
        email: user.email ?? "",
        telefone: user.telefone ?? "",
        password: "",
      });
      setVinculos(user.empresas.map((e) => e.id));
    } else {
      setTipo(tipoInicial);
      setForm({ full_name: "", email: "", telefone: "", password: "" });
      setVinculos([]);
    }
    setBusca("");
  }, [open, user, tipoInicial]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? companies.filter((c) => c.name.toLowerCase().includes(q)) : companies;
  }, [companies, busca]);

  const toggle = (id: string) =>
    setVinculos((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        full_name: form.full_name,
        telefone: form.telefone || null,
        tipo_usuario: tipo,
        company_ids: tipo === "cliente" ? vinculos : [],
      };
      if (user) {
        await updateUsuario({ data: { ...payload, user_id: user.id } });
        toast.success("Usuário atualizado");
      } else {
        await createUsuario({ data: { ...payload, email: form.email, password: form.password } });
        toast.success("Usuário criado");
      }
      onSaved();
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{user ? "Editar usuário" : "Novo usuário"}</DialogTitle>
          <DialogDescription>
            Defina o tipo de acesso e, para clientes, as empresas que ele poderá visualizar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Tipo de usuário</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as Tipo)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin_escritorio">Colaborador (admin do escritório)</SelectItem>
                <SelectItem value="cliente">Cliente (acesso ao BI)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {tipo === "cliente"
                ? "Acesso somente leitura, restrito às empresas vinculadas."
                : "Acesso a todas as empresas do escritório."}
            </p>
          </div>

          <div>
            <Label>Nome</Label>
            <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>E-mail</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                disabled={!!user}
              />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="(11) 90000-0000" />
            </div>
          </div>
          {!user && (
            <div>
              <Label>Senha de acesso</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
              />
            </div>
          )}

          {tipo === "cliente" && (
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Empresas vinculadas</Label>
                <Badge variant="secondary">{vinculos.length} selecionada(s)</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Este cliente só verá as empresas marcadas. Sem vínculo, não vê nenhuma empresa.
              </p>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input className="pl-7 h-8" placeholder="Buscar empresa…" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>
              <div className="max-h-52 overflow-y-auto space-y-1">
                {filtradas.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent cursor-pointer text-sm">
                    <Checkbox checked={vinculos.includes(c.id)} onCheckedChange={() => toggle(c.id)} />
                    {c.name}
                  </label>
                ))}
                {filtradas.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2 py-3">Nenhuma empresa encontrada.</p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={loading}>{loading ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
