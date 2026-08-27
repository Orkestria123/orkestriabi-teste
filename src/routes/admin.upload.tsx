import { createFileRoute } from "@tanstack/react-router";
import { PortalShell } from "@/components/portal-shell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { parseSpedContabil } from "@/lib/sped-parser";
import { parseSpedFiscal, isSpedFiscal } from "@/lib/sped-fiscal-parser";
import { deleteSpedFile } from "@/lib/api/orkestria.functions";
import { Upload as UploadIcon, FileText, CheckCircle2, AlertCircle, Trash2, Receipt, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin/upload")({ component: Page });

function Page() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id,name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: files } = useQuery({
    queryKey: ["sped-files"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sped_files").select("*, companies(name)").order("uploaded_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
  const [companyId, setCompanyId] = useState("");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteFile = async (id: string, filename: string) => {
    if (!confirm(`Excluir o arquivo "${filename}" e todos os dados importados dele?`)) return;
    setDeletingId(id);
    try {
      await deleteSpedFile({ data: { file_id: id } });
      toast.success("Arquivo e dados excluídos");
      qc.invalidateQueries({ queryKey: ["sped-files"] });
    } catch (e: any) { toast.error(e.message); }
    finally { setDeletingId(null); }
  };

  const handleFile = async (file: File) => {
    if (!companyId) { toast.error("Selecione uma empresa"); return; }
    if (!profile?.tenant_id) { toast.error("Tenant indefinido"); return; }
    const tenantId: string = profile.tenant_id;
    setProcessing(true);
    setProgress("Lendo arquivo…");
    try {
      const content = await file.text();
      const fiscal = isSpedFiscal(content);
      setProgress(fiscal ? "Detectado SPED Fiscal — processando…" : "Detectado SPED Contábil — processando…");

      if (fiscal) {
        await processFiscal(content, file, companyId, tenantId);
      } else {
        await processContabil(content, file, companyId, tenantId);
      }
      qc.invalidateQueries({ queryKey: ["sped-files"] });
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setProcessing(false);
      setProgress("");
    }
  };

  const processContabil = async (content: string, file: File, companyId: string, tenantId: string) => {
    const result = parseSpedContabil(content);
    setProgress("Salvando arquivo…");
    const storagePath = `${tenantId}/${companyId}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("sped-files").upload(storagePath, file);
    if (upErr) throw upErr;

    const { data: spedFile, error: sfErr } = await supabase.from("sped_files").insert({
      company_id: companyId,
      tenant_id: tenantId,
      filename: file.name,
      file_url: storagePath,
      // tipo_arquivo: "ECD",
      competencia_inicio: result.empresa.periodoInicio,
      competencia_fim: result.empresa.periodoFim,
      status: "processing",
      uploaded_by: profile!.id,
    }).select().single();
    if (sfErr) throw sfErr;

    setProgress(`Inserindo ${result.planoContas.length} contas…`);
    for (let i = 0; i < result.planoContas.length; i += 500) {
      // `chart_of_accounts` é do pipeline antigo e não tem as colunas do
      // I051/I052 — tira antes de mandar, senão o insert é recusado.
      const chunk = result.planoContas.slice(i, i + 500).map((c) => {
        const { cod_referencial: _r, cod_aglutinacao: _a, ...conta } = c;
        return { ...conta, sped_file_id: spedFile.id, company_id: companyId, tenant_id: tenantId };
      });
      const { error } = await supabase.from("chart_of_accounts").insert(chunk);
      if (error) throw error;
    }
    setProgress(`Inserindo ${result.saldos.length} saldos…`);
    for (let i = 0; i < result.saldos.length; i += 500) {
      const chunk = result.saldos.slice(i, i + 500).map((s) => ({
        ...s, sped_file_id: spedFile.id, company_id: companyId, tenant_id: tenantId,
      }));
      const { error } = await supabase.from("account_balances").insert(chunk);
      if (error) throw error;
    }
    setProgress(`Inserindo ${result.demonstracoes.length} linhas de demonstrações…`);
    for (let i = 0; i < result.demonstracoes.length; i += 500) {
      const chunk = result.demonstracoes.slice(i, i + 500).map((d) => ({
        ...d, sped_file_id: spedFile.id, company_id: companyId, tenant_id: tenantId,
      }));
      const { error } = await supabase.from("financial_statements").insert(chunk);
      if (error) throw error;
    }

    await supabase.from("sped_files").update({
      status: "done",
      processed_at: new Date().toISOString(),
      validation_results: result.validacoes as any,
    }).eq("id", spedFile.id);

    const erros = result.validacoes.filter((v) => !v.passou && v.severidade === "error");
    const alertas = result.validacoes.filter((v) => !v.passou && v.severidade === "warning");
    if (erros.length > 0) {
      toast.error(`SPED processado com ${erros.length} erro(s): ${erros[0].nome}`);
    } else if (alertas.length > 0) {
      toast.success(`SPED Contábil processado (${alertas.length} alerta(s)).`);
    } else {
      toast.success(`SPED Contábil OK — ${result.planoContas.length} contas, ${result.demonstracoes.length} linhas.`);
    }
  };

  const processFiscal = async (content: string, file: File, companyId: string, tenantId: string) => {
    const result = parseSpedFiscal(content);
    setProgress("Salvando arquivo…");
    const storagePath = `${tenantId}/${companyId}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("sped-files").upload(storagePath, file);
    if (upErr) throw upErr;

    const { data: spedFile, error: sfErr } = await supabase.from("sped_files").insert({
      company_id: companyId,
      tenant_id: tenantId,
      filename: file.name,
      file_url: storagePath,
      // tipo_arquivo: "EFD",
      competencia_inicio: result.empresa.periodoInicio,
      competencia_fim: result.empresa.periodoFim,
      status: "processing",
      uploaded_by: profile!.id,
    }).select().single();
    if (sfErr) throw sfErr;

    setProgress(`Inserindo ${result.participants.length} participantes…`);
    const participantsByCnpj = new Map<string, string>();
    for (let i = 0; i < result.participants.length; i += 500) {
      const chunk = result.participants.slice(i, i + 500).map((p) => ({
        company_id: companyId,
        cnpj_cpf: p.cnpj_cpf,
        nome: p.nome,
        uf: p.uf,
        municipio: p.municipio,
        ie: p.ie,
      }));
      const { data, error } = await supabase
        .from("fiscal_participants")
        .upsert(chunk, { onConflict: "company_id,cnpj_cpf" })
        .select("id, cnpj_cpf");
      if (error) throw error;
      (data ?? []).forEach((row) => participantsByCnpj.set(row.cnpj_cpf, row.id));
    }
    // Garante mapeamento para CNPJs que já existiam (upsert retorna apenas linhas afetadas em alguns casos)
    if (result.participants.length > 0) {
      const cnpjs = result.participants.map((p) => p.cnpj_cpf);
      const { data: existing } = await supabase
        .from("fiscal_participants")
        .select("id, cnpj_cpf")
        .eq("company_id", companyId)
        .in("cnpj_cpf", cnpjs);
      (existing ?? []).forEach((r) => participantsByCnpj.set(r.cnpj_cpf, r.id));
    }

    setProgress(`Inserindo ${result.invoices.length} notas fiscais…`);
    const invoicesPayload = result.invoices
      .filter((inv) => inv.chave_nfe || inv.numero) // ignora notas sem identificação
      .map((inv) => ({
        company_id: companyId,
        sped_file_id: spedFile.id,
        participant_id: inv.participant_cnpj ? participantsByCnpj.get(inv.participant_cnpj) ?? null : null,
        tipo: inv.tipo,
        modelo: inv.modelo,
        serie: inv.serie,
        numero: inv.numero,
        chave_nfe: inv.chave_nfe || `${inv.tipo}-${inv.numero}-${inv.serie ?? ""}-${inv.data_emissao ?? ""}`,
        data_emissao: inv.data_emissao,
        data_entrada_saida: inv.data_entrada_saida,
        cancelada: inv.cancelada,
        valor_total: inv.valor_total,
        valor_produtos: inv.valor_produtos,
        valor_desconto: inv.valor_desconto,
        valor_frete: inv.valor_frete,
        valor_icms: inv.valor_icms,
        valor_icms_st: inv.valor_icms_st,
        valor_ipi: inv.valor_ipi,
        valor_pis: inv.valor_pis,
        valor_cofins: inv.valor_cofins,
        _itens: inv.itens,
      }));

    let totalItens = 0;
    for (let i = 0; i < invoicesPayload.length; i += 300) {
      const chunk = invoicesPayload.slice(i, i + 300);
      const insertable = chunk.map(({ _itens, ...rest }) => rest);
      const { data: inserted, error } = await supabase
        .from("fiscal_invoices")
        .upsert(insertable, { onConflict: "company_id,tipo,chave_nfe", ignoreDuplicates: false })
        .select("id, chave_nfe, tipo");
      if (error) throw error;

      // Itens (se houver) — apenas para notas recém-inseridas
      const idByKey = new Map<string, string>();
      (inserted ?? []).forEach((row) => idByKey.set(`${row.tipo}|${row.chave_nfe}`, row.id));
      const itensPayload: any[] = [];
      for (const inv of chunk) {
        const id = idByKey.get(`${inv.tipo}|${inv.chave_nfe}`);
        if (!id) continue;
        for (const it of inv._itens) {
          itensPayload.push({ invoice_id: id, ...it });
        }
      }
      for (let j = 0; j < itensPayload.length; j += 500) {
        const sub = itensPayload.slice(j, j + 500);
        const { error: itErr } = await supabase.from("fiscal_invoice_items").insert(sub);
        if (itErr) throw itErr;
        totalItens += sub.length;
      }
    }

    await supabase.from("sped_files").update({
      status: "done",
      processed_at: new Date().toISOString(),
    }).eq("id", spedFile.id);

    toast.success(
      `SPED Fiscal OK — ${result.participants.length} participantes, ${invoicesPayload.length} notas, ${totalItens} itens.`,
    );
  };

  return (
    <PortalShell variant="admin" title="Upload de SPED">
      <Card className="p-4 mb-4 max-w-2xl border-primary/20 bg-primary/5">
        <div className="flex items-start gap-3 text-sm">
          <div className="rounded-md bg-card p-1.5"><FileText className="h-4 w-4 text-primary" /></div>
          <div>
            <div className="font-medium mb-1">Detecção automática do tipo de SPED</div>
            <div className="text-muted-foreground text-xs flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1"><BookOpen className="h-3 w-3" />SPED Contábil (ECD)</Badge>
              <span>gera DRE, Balanço e indicadores.</span>
              <Badge variant="outline" className="gap-1"><Receipt className="h-3 w-3" />SPED Fiscal (EFD ICMS/IPI)</Badge>
              <span>gera análise de fornecedores e notas fiscais.</span>
            </div>
          </div>
        </div>
      </Card>
      <Card className="p-6 max-w-2xl">
        <div className="space-y-4">
          <div>
            <Label>Empresa</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {(companies ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <label className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-10 cursor-pointer hover:bg-accent/40 transition-colors">
            <UploadIcon className="h-8 w-8 text-muted-foreground mb-3" />
            <div className="text-sm font-medium">Selecione o arquivo .txt do SPED</div>
            <div className="text-xs text-muted-foreground mt-1">ou arraste para esta área</div>
            <input
              type="file"
              accept=".txt"
              className="hidden"
              disabled={processing || !companyId}
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </label>
          {processing && (
            <div className="text-sm text-primary flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />{progress}
            </div>
          )}
        </div>
      </Card>

      <h3 className="mt-8 mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">Uploads recentes</h3>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Arquivo</th>
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Empresa</th>
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Competência</th>
              <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(files ?? []).map((f: any) => (
              <tr key={f.id} className="border-t">
                <td className="px-4 py-3 flex items-center gap-2"><FileText className="h-3.5 w-3.5 text-muted-foreground" />{f.filename}</td>
                <td className="px-4 py-3">{f.companies?.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{f.competencia_inicio} → {f.competencia_fim}</td>
                <td className="px-4 py-3">
                  {f.status === "done" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3 w-3" />Processado</span>
                  ) : f.status === "error" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-3 w-3" />Erro</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Processando…</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    disabled={deletingId === f.id}
                    onClick={() => handleDeleteFile(f.id, f.filename)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {(!files || files.length === 0) && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Nenhum upload ainda.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </PortalShell>
  );
}
