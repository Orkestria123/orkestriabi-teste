import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, ArrowUp, ArrowDown, FileText, Loader2, Send, Download, Pencil, Trash2, Sparkles, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useMyCompanies } from "@/hooks/use-financial-data";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SECOES, MODELO_PADRAO, normalizarSecoes, mesExtenso, type ConteudoRelatorio, type ModeloRelatorio, type SecaoCfg, type SecaoId } from "@/lib/relatorio/tipos";
import { coletarDados, periodosDisponiveis, resumoParaIA } from "@/lib/relatorio/dados";
import { gerarPdfRelatorio } from "@/lib/relatorio/pdf";
import { gerarTextosRelatorio } from "@/lib/api/relatorio-ia.functions";
import { urlDaImagemPerfil } from "@/lib/perfil-imagens";

const db = supabase as any;

function useModelo(tenantId: string | null) {
  return useQuery({
    queryKey: ["relatorio-modelo", tenantId], enabled: !!tenantId,
    queryFn: async (): Promise<ModeloRelatorio & { id?: string }> => {
      const { data } = await db.from("relatorio_modelos").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (!data) return MODELO_PADRAO;
      return { id: data.id, secoes: normalizarSecoes(data.secoes), textos: { ...MODELO_PADRAO.textos, ...(data.textos ?? {}) } };
    },
  });
}

function EditorSecoes({ secoes, onChange }: { secoes: SecaoCfg[]; onChange: (s: SecaoCfg[]) => void }) {
  const mover = (i: number, dir: number) => {
    const s = [...secoes]; const j = i + dir; if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j], s[i]]; onChange(s);
  };
  return (
    <div className="divide-y rounded-lg border bg-card">
      {secoes.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
          <span className={s.visivel ? "flex-1" : "flex-1 text-muted-foreground line-through"}>{SECOES.find((d) => d.id === s.id)?.titulo}</span>
          <Button size="icon" variant="ghost" onClick={() => mover(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" onClick={() => mover(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => onChange(secoes.map((x) => x.id === s.id ? { ...x, visivel: !x.visivel } : x))}>
            {s.visivel ? <><Eye className="h-4 w-4 mr-1" />Mostrar</> : <><EyeOff className="h-4 w-4 mr-1" />Esconder</>}
          </Button>
        </div>
      ))}
    </div>
  );
}

function ModeloPadrao({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const { data } = useModelo(tenantId);
  const [m, setM] = useState<ModeloRelatorio | null>(null);
  useEffect(() => { if (data) setM(data); }, [data]);
  if (!m) return <Loader2 className="h-5 w-5 animate-spin" />;
  const salvar = async () => {
    const { error } = await db.from("relatorio_modelos").upsert({ tenant_id: tenantId, secoes: m.secoes, textos: m.textos }, { onConflict: "tenant_id" });
    if (error) return toast.error(error.message);
    toast.success("Modelo padrão salvo."); qc.invalidateQueries({ queryKey: ["relatorio-modelo"] });
  };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-2">
        <h3 className="font-semibold">Seções e ordem</h3>
        <p className="text-xs text-muted-foreground">Vale para todos os relatórios novos. Em cada empresa você ainda pode ajustar.</p>
        <EditorSecoes secoes={m.secoes} onChange={(secoes) => setM({ ...m, secoes })} />
      </div>
      <div className="space-y-3">
        <h3 className="font-semibold">Textos fixos</h3>
        <p className="text-xs text-muted-foreground">Se preenchidos, entram em todos os relatórios no lugar do texto da IA.</p>
        {(["escritorio", "conclusoes", "glossario"] as SecaoId[]).map((k) => (
          <div key={k} className="space-y-1">
            <Label className="text-xs">{SECOES.find((s) => s.id === k)?.titulo}</Label>
            <Textarea rows={k === "glossario" ? 8 : 4} value={m.textos[k] ?? ""} onChange={(e) => setM({ ...m, textos: { ...m.textos, [k]: e.target.value } })} />
          </div>
        ))}
        <Button onClick={salvar}>Salvar modelo padrão</Button>
      </div>
    </div>
  );
}

async function baixar(c: ConteudoRelatorio, nome: string) {
  const blob = await gerarPdfRelatorio(c);
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function EditorRelatorio({ rel, onClose }: { rel: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [c, setC] = useState<ConteudoRelatorio>(rel.conteudo);
  const [ocupado, setOcupado] = useState(false);
  const setTexto = (k: SecaoId, v: string) => setC({ ...c, textos: { ...c.textos, [k]: v } });
  const trocarImg = (k: keyof ConteudoRelatorio["imagens"]) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 3 * 1024 * 1024) return toast.error("Imagem até 3MB.");
    const fr = new FileReader(); fr.onload = () => setC({ ...c, imagens: { ...c.imagens, [k]: fr.result as string } }); fr.readAsDataURL(f);
  };
  const salvar = async () => {
    setOcupado(true);
    const { error } = await db.from("relatorios_executivos").update({ conteudo: c }).eq("id", rel.id);
    setOcupado(false);
    if (error) return toast.error(error.message);
    toast.success("Relatório salvo."); qc.invalidateQueries({ queryKey: ["relatorios"] }); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Editar relatório — {c.empresa.nome} · {mesExtenso(c.dados.periodo)}</DialogTitle></DialogHeader>
        <div className="space-y-5">
          <EditorSecoes secoes={c.secoes} onChange={(secoes) => setC({ ...c, secoes })} />
          <div className="grid gap-3 sm:grid-cols-3">
            {([["logoEscritorio", "Logo do escritório"], ["logoEmpresa", "Logo da empresa"], ["fotoEmpresa", "Foto da empresa"]] as const).map(([k, l]) => (
              <div key={k} className="rounded-lg border p-3 space-y-2">
                <Label className="text-xs">{l}</Label>
                {c.imagens[k] ? <img src={c.imagens[k]!} alt={l} className="h-16 object-contain" /> : <div className="h-16 text-xs text-muted-foreground">Sem imagem</div>}
                <div className="flex gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
                    <Upload className="h-3 w-3" />Trocar<input type="file" accept="image/*" className="hidden" onChange={trocarImg(k)} />
                  </label>
                  {c.imagens[k] && <Button size="sm" variant="ghost" onClick={() => setC({ ...c, imagens: { ...c.imagens, [k]: null } })}>Remover</Button>}
                </div>
              </div>
            ))}
          </div>
          {SECOES.filter((s) => s.temTexto && c.secoes.find((x) => x.id === s.id)?.visivel).map((s) => (
            <div key={s.id} className="space-y-1">
              <Label className="text-xs">{s.titulo}</Label>
              <Textarea rows={5} value={c.textos[s.id] ?? ""} onChange={(e) => setTexto(s.id, e.target.value)} />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => baixar(c, `Relatorio_${c.empresa.nome}_${c.dados.periodo.slice(0, 7)}.pdf`)}><Download className="h-4 w-4 mr-1" />Pré-visualizar PDF</Button>
          <Button onClick={salvar} disabled={ocupado}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisponibilizarDialog({ rel, onClose }: { rel: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const { data: emails, isLoading } = useQuery({
    queryKey: ["emails-empresa", rel.company_id],
    queryFn: async () => {
      const { data, error } = await db.rpc("emails_com_acesso_empresa", { _company_id: rel.company_id });
      if (error) throw error; return (data ?? []) as { user_id: string; nome: string | null; email: string }[];
    },
  });
  const [enviarEmail, setEnviarEmail] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const confirmar = async () => {
    setOcupado(true);
    try {
      const c = rel.conteudo as ConteudoRelatorio;
      const blob = await gerarPdfRelatorio(c);
      const path = `${rel.tenant_id}/${rel.company_id}/${rel.id}.pdf`;
      const up = await supabase.storage.from("relatorios").upload(path, blob, { upsert: true, contentType: "application/pdf" });
      if (up.error) throw up.error;
      const { error } = await db.from("relatorios_executivos").update({
        status: "disponibilizado", pdf_path: path, disponibilizado_em: new Date().toISOString(), disponibilizado_por: profile?.id,
      }).eq("id", rel.id);
      if (error) throw error;
      if (enviarEmail && emails?.length) {
        await db.from("relatorio_envios").insert(emails.map((e) => ({ tenant_id: rel.tenant_id, relatorio_id: rel.id, email: e.email, status: "aguardando_dominio" })));
      }
      toast.success(enviarEmail && emails?.length
        ? "Relatório disponibilizado no BI. Os e-mails ficaram registrados e serão enviados assim que o domínio de e-mail estiver ativo."
        : "Relatório disponibilizado no BI da empresa.");
      qc.invalidateQueries({ queryKey: ["relatorios"] }); onClose();
    } catch (e: any) { toast.error(e?.message ?? "Falha ao disponibilizar."); }
    finally { setOcupado(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disponibilizar relatório</DialogTitle>
          <DialogDescription>O relatório ficará visível no BI de {rel.conteudo.empresa.nome} para os usuários abaixo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={enviarEmail} onCheckedChange={(v) => setEnviarEmail(!!v)} />Enviar aviso por e-mail</label>
          <div className="max-h-60 overflow-y-auto rounded-lg border">
            {isLoading ? <div className="p-3"><Loader2 className="h-4 w-4 animate-spin" /></div>
              : !emails?.length ? <div className="p-3 text-sm text-muted-foreground">Nenhum usuário do cliente com acesso a esta empresa.</div>
              : emails.map((e) => (
                <div key={e.user_id} className="flex justify-between border-b px-3 py-2 text-sm last:border-0">
                  <span>{e.nome ?? "—"}</span><span className="text-muted-foreground">{e.email}</span>
                </div>
              ))}
          </div>
          {enviarEmail && <p className="text-xs text-muted-foreground">O envio de e-mails começa quando o domínio de e-mail do escritório for configurado; até lá os avisos ficam registrados.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar} disabled={ocupado}>{ocupado ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}Confirmar e disponibilizar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RelatoriosEmpresa({ tenantId, companyIdInicial }: { tenantId: string; companyIdInicial?: string }) {
  const qc = useQueryClient();
  const { data: companies } = useMyCompanies();
  const { data: modelo } = useModelo(tenantId);
  const [companyId, setCompanyId] = useState(companyIdInicial ?? "");
  const [periodo, setPeriodo] = useState("");
  const [gerando, setGerando] = useState<string | null>(null);
  const [editar, setEditar] = useState<any>(null);
  const [disp, setDisp] = useState<any>(null);
  const { data: periodos } = useQuery({ queryKey: ["rel-periodos", companyId], enabled: !!companyId, queryFn: () => periodosDisponiveis(companyId) });
  useEffect(() => { if (periodos?.length) setPeriodo(periodos[periodos.length - 1]); }, [periodos]);
  const { data: lista } = useQuery({
    queryKey: ["relatorios", tenantId, companyId],
    queryFn: async () => {
      let q = db.from("relatorios_executivos").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100);
      if (companyId) q = q.eq("company_id", companyId);
      const { data } = await q; return data ?? [];
    },
  });

  const gerar = async () => {
    if (!companyId || !periodo || !modelo) return;
    try {
      setGerando("Buscando os números do BI…");
      const [{ data: emp }, { data: ten }] = await Promise.all([
        db.from("companies").select("name, razao_social, cnpj, municipio, uf, regime_tributario, perfil_ia, logo_url, foto_url").eq("id", companyId).maybeSingle(),
        db.from("tenants").select("name, perfil_ia, logo_url").eq("id", tenantId).maybeSingle(),
      ]);
      const dados = await coletarDados(companyId, tenantId, emp?.name ?? "", periodo);
      setGerando("A IA está escrevendo os textos…");
      const r = await gerarTextosRelatorio({ data: {
        empresa: emp?.razao_social ?? emp?.name ?? "", escritorio: ten?.name ?? "",
        perfilEmpresa: emp?.perfil_ia ?? "", perfilEscritorio: ten?.perfil_ia ?? "", numeros: resumoParaIA(dados),
      } });
      if (!r.ok) toast.error(r.erro);
      const fixos = Object.fromEntries(Object.entries(modelo.textos).filter(([, v]) => v?.trim()));
      let logoEsc: string | null = ten?.logo_url ?? null;
      if (logoEsc && !/^https?:/.test(logoEsc)) logoEsc = (await supabase.storage.from("tenant-logos").createSignedUrl(logoEsc, 3600)).data?.signedUrl ?? null;
      const conteudo: ConteudoRelatorio = {
        secoes: modelo.secoes, textos: { ...(r.ok ? r.textos : {}), ...fixos },
        imagens: { logoEscritorio: logoEsc, logoEmpresa: await urlDaImagemPerfil(emp?.logo_url), fotoEmpresa: await urlDaImagemPerfil(emp?.foto_url) },
        escritorio: { nome: ten?.name ?? "" },
        empresa: { nome: emp?.name ?? "", razao: emp?.razao_social, cnpj: emp?.cnpj, cidade: [emp?.municipio, emp?.uf].filter(Boolean).join("-"), regime: emp?.regime_tributario },
        dados,
      };
      // Imagens embutidas para não expirar
      const embed = async (u?: string | null) => { if (!u) return null; try { const b = await (await fetch(u)).blob(); return await new Promise<string>((res) => { const f = new FileReader(); f.onload = () => res(f.result as string); f.readAsDataURL(b); }); } catch { return null; } };
      conteudo.imagens = { logoEscritorio: await embed(conteudo.imagens.logoEscritorio), logoEmpresa: await embed(conteudo.imagens.logoEmpresa), fotoEmpresa: await embed(conteudo.imagens.fotoEmpresa) };
      const { data: novo, error } = await db.from("relatorios_executivos").insert({
        tenant_id: tenantId, company_id: companyId, competencia: periodo, conteudo, titulo: `Relatório Executivo ${mesExtenso(periodo)}`,
      }).select("*").single();
      if (error) throw error;
      toast.success(r.ok ? `Relatório gerado (textos: ${r.fonte}). Revise antes de disponibilizar.` : "Relatório gerado sem textos da IA.");
      qc.invalidateQueries({ queryKey: ["relatorios"] }); setEditar(novo);
    } catch (e: any) { toast.error(e?.message ?? "Falha ao gerar o relatório."); }
    finally { setGerando(null); }
  };
  const excluir = async (r: any) => {
    if (!confirm("Excluir este relatório?")) return;
    if (r.pdf_path) await supabase.storage.from("relatorios").remove([r.pdf_path]);
    await db.from("relatorios_executivos").delete().eq("id", r.id);
    qc.invalidateQueries({ queryKey: ["relatorios"] });
  };
  const nomeEmp = (id: string) => companies?.find((c) => c.id === id)?.name ?? "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="space-y-1"><Label className="text-xs">Empresa</Label>
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-[280px]"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{companies?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">Mês</Label>
          <Select value={periodo} onValueChange={setPeriodo} disabled={!periodos?.length}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>{[...(periodos ?? [])].reverse().map((p) => <SelectItem key={p} value={p}>{mesExtenso(p)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button onClick={gerar} disabled={!companyId || !periodo || !!gerando}>
          {gerando ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />{gerando}</> : <><Sparkles className="h-4 w-4 mr-1" />Gerar relatório</>}
        </Button>
      </div>
      <div className="rounded-lg border bg-card divide-y">
        {!lista?.length && <div className="p-6 text-center text-sm text-muted-foreground">Nenhum relatório gerado ainda.</div>}
        {lista?.map((r: any) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <FileText className="h-4 w-4 text-primary" />
            <div className="flex-1 min-w-[200px]">
              <div className="font-medium">{nomeEmp(r.company_id) || r.conteudo?.empresa?.nome} · {mesExtenso(r.competencia)}</div>
              <div className="text-xs text-muted-foreground">Criado em {new Date(r.created_at).toLocaleDateString("pt-BR")}{r.disponibilizado_em ? ` · disponibilizado em ${new Date(r.disponibilizado_em).toLocaleDateString("pt-BR")}` : ""}</div>
            </div>
            <Badge variant={r.status === "disponibilizado" ? "default" : "secondary"}>{r.status === "disponibilizado" ? "Disponibilizado" : "Rascunho"}</Badge>
            <Button size="sm" variant="outline" onClick={() => setEditar(r)}><Pencil className="h-4 w-4 mr-1" />Editar</Button>
            <Button size="sm" variant="outline" onClick={() => baixar(r.conteudo, `Relatorio_${r.conteudo.empresa.nome}_${r.competencia.slice(0, 7)}.pdf`)}><Download className="h-4 w-4" /></Button>
            <Button size="sm" onClick={() => setDisp(r)}><Send className="h-4 w-4 mr-1" />{r.status === "disponibilizado" ? "Atualizar no BI" : "Disponibilizar relatório"}</Button>
            <Button size="icon" variant="ghost" onClick={() => excluir(r)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
      {editar && <EditorRelatorio rel={editar} onClose={() => setEditar(null)} />}
      {disp && <DisponibilizarDialog rel={disp} onClose={() => setDisp(null)} />}
    </div>
  );
}

export function RelatoriosAdmin({ tenantId, companyId }: { tenantId: string; companyId?: string }) {
  return (
    <Tabs defaultValue="relatorios">
      <TabsList><TabsTrigger value="relatorios">Relatórios por empresa</TabsTrigger><TabsTrigger value="modelo">Modelo padrão</TabsTrigger></TabsList>
      <TabsContent value="relatorios"><RelatoriosEmpresa tenantId={tenantId} companyIdInicial={companyId} /></TabsContent>
      <TabsContent value="modelo"><ModeloPadrao tenantId={tenantId} /></TabsContent>
    </Tabs>
  );
}
