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
import { Plus, Search, BarChart3, ArrowRight, Trash2, Database, Pencil, Loader2, ChevronDown, LayoutGrid, List as ListIcon, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { deleteCompany, setEmpresaUsuarios } from "@/lib/api/orkestria.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { formatarCnpj, limparCnpj, erroCnpj } from "@/lib/cnpj";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";


export const Route = createFileRoute("/admin/empresas/")({ component: Page });

interface FormEmpresa {
  name: string;
  razao_social: string;
  cnpj: string;
  regime_tributario: string;
  // endereço
  cep: string; logradouro: string; numero: string; complemento: string;
  bairro: string; municipio: string; uf: string;
  // contato
  telefone: string; email: string; responsavel: string;
  // perfil
  site: string; segmento_id: string; porte: string;
}

const FORM_VAZIO: FormEmpresa = {
  name: "", razao_social: "", cnpj: "", regime_tributario: "Lucro Real",
  cep: "", logradouro: "", numero: "", complemento: "",
  bairro: "", municipio: "", uf: "",
  telefone: "", email: "", responsavel: "",
  site: "", segmento_id: "", porte: "",
};

const PORTES = ["MEI", "Micro", "Pequena", "Média", "Grande"];

/** Aceita vazio; se preencher, tem que parecer um endereço web. */
function erroSite(v: string): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const comProtocolo = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(comProtocolo);
    if (!/^[\w-]+(\.[\w-]+)+$/.test(u.hostname)) return "Endereço de site inválido.";
    return null;
  } catch {
    return "Endereço de site inválido.";
  }
}

/** 00000-000 — só formata o que foi digitado, não valida. */
function formatarCep(v: string): string {
  const d = (v ?? "").replace(/\D/g, "").slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** (00) 00000-0000 — idem: conveniência, não regra. */
function formatarTelefone(v: string): string {
  const d = (v ?? "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Campos que só existem quando preenchidos — vazio grava NULL. */
function camposOpcionais(f: FormEmpresa) {
  const t = (v: string) => (v.trim() ? v.trim() : null);
  return {
    razao_social: t(f.razao_social),
    cnpj: limparCnpj(f.cnpj) || null,
    cep: t(f.cep), logradouro: t(f.logradouro), numero: t(f.numero),
    complemento: t(f.complemento), bairro: t(f.bairro), municipio: t(f.municipio),
    uf: f.uf.trim() ? f.uf.trim().toUpperCase() : null,
    telefone: t(f.telefone), email: t(f.email), responsavel: t(f.responsavel),
    site: t(f.site), segmento_id: f.segmento_id || null, porte: t(f.porte),
  };
}

/**
 * Seção que abre e fecha. As opcionais nascem fechadas: quem entrou só
 * para corrigir o nome não deve ter que rolar um formulário inteiro.
 * O contador no cabeçalho diz se tem coisa lá dentro sem precisar abrir.
 */
function Secao({
  titulo, preenchidos, children,
}: { titulo: string; preenchidos: number; children: React.ReactNode }) {
  const [aberta, setAberta] = useState(false);
  return (
    <Collapsible open={aberta} onOpenChange={setAberta} className="border rounded-md">
      <CollapsibleTrigger asChild>
        <button type="button"
          className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/50 transition-colors">
          <span className="font-medium">{titulo}</span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {preenchidos > 0 && <span>{preenchidos} preenchido(s)</span>}
            <ChevronDown className={`h-4 w-4 transition-transform ${aberta ? "rotate-180" : ""}`} />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 pt-1 space-y-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Mesmo formulário para criar e para editar.
 *
 * Só o CNPJ é validado — e mesmo ele aceita vazio: nem toda empresa tem
 * o CNPJ à mão na hora do cadastro. O que não pode é ficar um CNPJ
 * ERRADO gravado, porque ele é a chave que amarra a empresa aos arquivos
 * fiscais depois.
 */
function EmpresaForm({
  valor, onChange, onSubmit, salvando, rotuloBotao,
}: {
  valor: FormEmpresa;
  onChange: (v: FormEmpresa) => void;
  onSubmit: (e: React.FormEvent) => void;
  salvando: boolean;
  rotuloBotao: string;
}) {
  const erro = erroCnpj(valor.cnpj) ?? erroSite(valor.site);
  const { data: segmentos } = useQuery({
    queryKey: ["segmentos"],
    queryFn: async () => (await supabase.from("segmentos").select("id, nome").order("nome")).data ?? [],
  });
  // Só reclama depois de o campo ter conteúdo suficiente para julgar —
  // acusar "incompleto" no terceiro caractere digitado é ruído.
  const erroDoCnpj = erroCnpj(valor.cnpj);
  const mostrarErro = !!erroDoCnpj && limparCnpj(valor.cnpj).length >= 14;
  const msgSite = erroSite(valor.site);

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label>Nome fantasia</Label>
        <Input value={valor.name}
          onChange={(e) => onChange({ ...valor, name: e.target.value })} required />
      </div>
      <div>
        <Label>Razão social</Label>
        <Input value={valor.razao_social}
          onChange={(e) => onChange({ ...valor, razao_social: e.target.value })} />
      </div>
      <div>
        <Label>CNPJ</Label>
        <Input
          value={valor.cnpj}
          inputMode="text"
          placeholder="00.000.000/0000-00"
          aria-invalid={mostrarErro}
          className={mostrarErro ? "border-destructive focus-visible:ring-destructive" : undefined}
          onChange={(e) => onChange({ ...valor, cnpj: formatarCnpj(e.target.value) })}
        />
        {mostrarErro
          ? <p className="text-xs text-destructive mt-1">{erroDoCnpj}</p>
          : <p className="text-xs text-muted-foreground mt-1">Opcional. Se preencher, tem que ser válido.</p>}
      </div>
      <div>
        <Label>Regime tributário</Label>
        <Select value={valor.regime_tributario}
          onValueChange={(v) => onChange({ ...valor, regime_tributario: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Lucro Real">Lucro Real</SelectItem>
            <SelectItem value="Lucro Presumido">Lucro Presumido</SelectItem>
            <SelectItem value="Simples Nacional">Simples Nacional</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Secao
        titulo="Perfil da empresa"
        preenchidos={[valor.site, valor.segmento_id, valor.porte].filter((v) => v.trim()).length}
      >
        <div>
          <Label className="text-xs">Site</Label>
          <Input value={valor.site} placeholder="www.empresa.com.br"
            aria-invalid={!!msgSite}
            className={msgSite ? "border-destructive focus-visible:ring-destructive" : undefined}
            onChange={(e) => onChange({ ...valor, site: e.target.value })} />
          {msgSite && <p className="text-xs text-destructive mt-1">{msgSite}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Segmento</Label>
            <Select value={valor.segmento_id || "__none"}
              onValueChange={(v) => onChange({ ...valor, segmento_id: v === "__none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Não informado</SelectItem>
                {(segmentos ?? []).map((sg: any) => (
                  <SelectItem key={sg.id} value={sg.id}>{sg.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Porte</Label>
            <Select value={valor.porte || "__none"}
              onValueChange={(v) => onChange({ ...valor, porte: v === "__none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Não informado</SelectItem>
                {PORTES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Logo e perfil da empresa serão configurados futuramente.
        </p>
      </Secao>

      <Secao
        titulo="Endereço"
        preenchidos={[valor.cep, valor.logradouro, valor.numero, valor.complemento,
                      valor.bairro, valor.municipio, valor.uf].filter((v) => v.trim()).length}
      >
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-xs">CEP</Label>
            <Input value={valor.cep} placeholder="00000-000"
              onChange={(e) => onChange({ ...valor, cep: formatarCep(e.target.value) })} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Logradouro</Label>
            <Input value={valor.logradouro}
              onChange={(e) => onChange({ ...valor, logradouro: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-xs">Número</Label>
            <Input value={valor.numero}
              onChange={(e) => onChange({ ...valor, numero: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Complemento</Label>
            <Input value={valor.complemento}
              onChange={(e) => onChange({ ...valor, complemento: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-xs">Bairro</Label>
            <Input value={valor.bairro}
              onChange={(e) => onChange({ ...valor, bairro: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Município</Label>
            <Input value={valor.municipio}
              onChange={(e) => onChange({ ...valor, municipio: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">UF</Label>
            <Input value={valor.uf} maxLength={2} placeholder="RS"
              onChange={(e) => onChange({ ...valor, uf: e.target.value.toUpperCase() })} />
          </div>
        </div>
      </Secao>

      <Secao
        titulo="Contato"
        preenchidos={[valor.telefone, valor.email, valor.responsavel].filter((v) => v.trim()).length}
      >
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Telefone</Label>
            <Input value={valor.telefone} placeholder="(00) 00000-0000"
              onChange={(e) => onChange({ ...valor, telefone: formatarTelefone(e.target.value) })} />
          </div>
          <div>
            <Label className="text-xs">E-mail</Label>
            <Input value={valor.email} type="email"
              onChange={(e) => onChange({ ...valor, email: e.target.value })} />
          </div>
        </div>
        <div>
          <Label className="text-xs">Responsável</Label>
          <Input value={valor.responsavel}
            onChange={(e) => onChange({ ...valor, responsavel: e.target.value })} />
        </div>
      </Secao>

      <DialogFooter>
        <Button type="submit" disabled={salvando || !!erro}>
          {salvando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {rotuloBotao}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Vínculo pelo lado da empresa. Mesma tabela usada no cadastro do usuário —
 * marcar aqui ou lá dá exatamente no mesmo, é fonte única de verdade.
 */
function UsuariosDaEmpresa({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["empresa-usuarios", companyId],
    queryFn: async () => {
      const [{ data: clientes }, { data: vinculos }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("tipo_usuario", "cliente")
          .order("full_name"),
        supabase.from("usuario_empresas").select("user_id").eq("company_id", companyId),
      ]);
      return {
        clientes: clientes ?? [],
        vinculados: new Set((vinculos ?? []).map((v: any) => v.user_id as string)),
      };
    },
  });

  const [selecao, setSelecao] = useState<Set<string> | null>(null);
  const marcados = selecao ?? data?.vinculados ?? new Set<string>();

  const alternar = (id: string) => {
    const novo = new Set(marcados);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    setSelecao(novo);
  };

  const salvar = async () => {
    setSalvando(true);
    try {
      await setEmpresaUsuarios({ data: { company_id: companyId, user_ids: [...marcados] } });
      toast.success("Acessos atualizados");
      setSelecao(null);
      qc.invalidateQueries({ queryKey: ["empresa-usuarios", companyId] });
      qc.invalidateQueries({ queryKey: ["tenant-users"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const lista = (data?.clientes ?? []).filter((u: any) => {
    const s = busca.trim().toLowerCase();
    if (!s) return true;
    return [u.full_name, u.email].filter(Boolean).some((v: string) => v.toLowerCase().includes(s));
  });

  return (
    <div className="border rounded-md p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Usuários com acesso</span>
        <Badge variant="secondary">{marcados.size} cliente(s)</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Apenas usuários do tipo Cliente aparecem aqui. Colaboradores do escritório já têm
        acesso a todas as empresas.
      </p>
      <Input placeholder="Buscar cliente…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <div className="max-h-48 overflow-y-auto space-y-1">
        {isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
        {!isLoading && lista.length === 0 && (
          <p className="text-xs text-muted-foreground">Nenhum cliente cadastrado.</p>
        )}
        {lista.map((u: any) => (
          <label key={u.id} className="flex items-center gap-2 text-sm px-1 py-1 rounded hover:bg-muted/50 cursor-pointer">
            <Checkbox checked={marcados.has(u.id)} onCheckedChange={() => alternar(u.id)} />
            <span className="flex-1 truncate">{u.full_name ?? "—"}</span>
            <span className="text-xs text-muted-foreground truncate">{u.email}</span>
          </label>
        ))}
      </div>
      <Button type="button" size="sm" variant="outline" onClick={salvar}
        disabled={salvando || selecao === null}>
        {salvando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Salvar acessos
      </Button>
    </div>
  );
}

/** Diálogo de edição de uma empresa já cadastrada. */
function EditarEmpresaDialog({ empresa, onSaved }: { empresa: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState<FormEmpresa>(FORM_VAZIO);

  // Recarrega do registro toda vez que abre: se alguém alterou em outra
  // aba, o formulário não abre com dado velho.
  const abrir = (v: boolean) => {
    if (v) {
      setForm({
        name: empresa.name ?? "",
        razao_social: empresa.razao_social ?? "",
        cnpj: formatarCnpj(empresa.cnpj ?? ""),
        regime_tributario: empresa.regime_tributario ?? "Lucro Real",
        cep: formatarCep(empresa.cep ?? ""),
        logradouro: empresa.logradouro ?? "",
        numero: empresa.numero ?? "",
        complemento: empresa.complemento ?? "",
        bairro: empresa.bairro ?? "",
        municipio: empresa.municipio ?? "",
        uf: empresa.uf ?? "",
        telefone: formatarTelefone(empresa.telefone ?? ""),
        email: empresa.email ?? "",
        responsavel: empresa.responsavel ?? "",
        site: empresa.site ?? "",
        segmento_id: empresa.segmento_id ?? "",
        porte: empresa.porte ?? "",
      });
    }
    setOpen(v);
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const erro = erroCnpj(form.cnpj) ?? erroSite(form.site);
    if (erro) return toast.error(erro);
    setSalvando(true);
    try {
      // Grava o CNPJ sem pontuação — é assim que ele já está no banco e
      // é o que o casamento com arquivo fiscal espera. Vazio vira NULL,
      // não string vazia.
      const { error } = await supabase
        .from("companies")
        .update({
          name: form.name,
          regime_tributario: form.regime_tributario,
          ...camposOpcionais(form),
        })
        .eq("id", empresa.id);
      if (error) throw error;
      toast.success("Cadastro atualizado");
      setOpen(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <DialogTrigger asChild>
        <Button size="icon" variant="outline" className="h-9 w-9" title="Editar cadastro">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar cadastro</DialogTitle></DialogHeader>
        <EmpresaForm valor={form} onChange={setForm} onSubmit={salvar}
          salvando={salvando} rotuloBotao="Salvar" />
      </DialogContent>
    </Dialog>
  );
}



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
  const [form, setForm] = useState<FormEmpresa>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);

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
    const erro = erroCnpj(form.cnpj) ?? erroSite(form.site);
    if (erro) return toast.error(erro);
    setSalvando(true);
    try {
      const { error } = await supabase.from("companies").insert({
        name: form.name,
        regime_tributario: form.regime_tributario,
        tenant_id: profile.tenant_id,
        ...camposOpcionais(form),
      });
      if (error) throw error;
      toast.success("Empresa criada");
      setOpen(false);
      setForm(FORM_VAZIO);
      qc.invalidateQueries({ queryKey: ["companies"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSalvando(false);
    }
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
            <EmpresaForm valor={form} onChange={setForm} onSubmit={submit}
              salvando={salvando} rotuloBotao="Criar" />
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
                {c.cnpj && <div className="text-xs text-muted-foreground mt-2">CNPJ {formatarCnpj(c.cnpj)}</div>}
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
                <EditarEmpresaDialog
                  empresa={c}
                  onSaved={() => qc.invalidateQueries({ queryKey: ["companies"] })}
                />
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
