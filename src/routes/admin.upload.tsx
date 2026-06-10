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
import { deleteSpedFile } from "@/lib/api/orkestria.functions";
import { Upload as UploadIcon, FileText, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";

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
      setProgress("Fazendo parse do SPED…");
      const result = parseSpedContabil(content);

      setProgress("Salvando arquivo…");
      const storagePath = `${profile.tenant_id}/${companyId}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("sped-files").upload(storagePath, file);
      if (upErr) throw upErr;

      const { data: spedFile, error: sfErr } = await supabase.from("sped_files").insert({
        company_id: companyId,
        tenant_id: tenantId,
        filename: file.name,
        file_url: storagePath,
        competencia_inicio: result.empresa.periodoInicio,
        competencia_fim: result.empresa.periodoFim,
        status: "processing",
        uploaded_by: profile.id,
      }).select().single();
      if (sfErr) throw sfErr;

      setProgress(`Inserindo ${result.planoContas.length} contas…`);
      if (result.planoContas.length > 0) {
        // batch in chunks of 500
        for (let i = 0; i < result.planoContas.length; i += 500) {
          const chunk = result.planoContas.slice(i, i + 500).map((c) => ({
            ...c, sped_file_id: spedFile.id, company_id: companyId, tenant_id: tenantId,
          }));
          const { error } = await supabase.from("chart_of_accounts").insert(chunk);
          if (error) throw error;
        }
      }

      setProgress(`Inserindo ${result.saldos.length} saldos…`);
      if (result.saldos.length > 0) {
        for (let i = 0; i < result.saldos.length; i += 500) {
          const chunk = result.saldos.slice(i, i + 500).map((s) => ({
            ...s, sped_file_id: spedFile.id, company_id: companyId, tenant_id: tenantId,
          }));
          const { error } = await supabase.from("account_balances").insert(chunk);
          if (error) throw error;
        }
      }

      setProgress(`Inserindo ${result.demonstracoes.length} linhas de demonstrações…`);
      if (result.demonstracoes.length > 0) {
        for (let i = 0; i < result.demonstracoes.length; i += 500) {
          const chunk = result.demonstracoes.slice(i, i + 500).map((d) => ({
            ...d, sped_file_id: spedFile.id, company_id: companyId, tenant_id: tenantId,
          }));
          const { error } = await supabase.from("financial_statements").insert(chunk);
          if (error) throw error;
        }
      }

      await supabase.from("sped_files").update({
        status: "done",
        processed_at: new Date().toISOString(),
        validation_results: result.validacoes as any,
      }).eq("id", spedFile.id);

      const erros = result.validacoes.filter((v) => !v.passou && v.severidade === "error");
      const alertas = result.validacoes.filter((v) => !v.passou && v.severidade === "warning");
      if (erros.length > 0) {
        toast.error(`SPED processado com ${erros.length} erro(s) de validação: ${erros[0].nome}`);
      } else if (alertas.length > 0) {
        toast.success(`SPED processado (${alertas.length} alerta(s) de validação).`);
      } else {
        toast.success(`SPED processado! ${result.planoContas.length} contas, ${result.demonstracoes.length} linhas.`);
      }
      qc.invalidateQueries({ queryKey: ["sped-files"] });
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setProcessing(false);
      setProgress("");
    }
  };

  return (
    <PortalShell variant="admin" title="Upload de SPED Contábil">
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
              </tr>
            ))}
            {(!files || files.length === 0) && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">Nenhum upload ainda.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </PortalShell>
  );
}
