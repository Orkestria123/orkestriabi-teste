import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { PortalShell } from "@/components/portal-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, AlertTriangle, CheckCircle2, Trash2, ArrowLeft, Wand2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { parsePlanoContasCSV, type PlanoContaRow, type PlanoParseResult } from "@/lib/diario/plano-parser";
import { parseDiarioXLSX, type DiarioParseResult } from "@/lib/diario/diario-parser";
import { salvarPlanoContas, salvarDiarioUpload, removerUpload } from "@/lib/diario/uploader";
import { sugerirMapeamento, classificacoesNaoMapeadas, type MapeamentoSugerido, type TipoDemonstracao } from "@/lib/diario/suggest-mapping";
import { formatBRL } from "@/lib/format";
import { MascaraConfigPanel } from "@/components/mascara-config";
import { BalancoFechaBadge } from "@/components/balanco-fecha-badge";
import { getMascaraConfig } from "@/lib/mascara/interpretar";
import { IndicadoresEmpresaPanel } from "@/components/indicadores/indicadores-empresa-panel";
import { AjustesGerenciaisPanel } from "@/components/gerencial/ajustes-gerenciais-panel";
import { OrcamentoConfigPanel } from "@/components/orcamento/orcamento-config-panel";
import { DashboardConfigPanel } from "@/components/dashboard/dashboard-config-panel";

export const Route = createFileRoute("/admin/empresas/$id/dados")({
  component: Page,
});

function Page() {
  const { id } = useParams({ from: "/admin/empresas/$id/dados" });
  const [tab, setTab] = useState<"plano" | "mapeamento" | "saldo-inicial" | "diarios" | "mascara" | "indicadores" | "gerencial" | "orcamento" | "dashboard">("plano");

  const { data: company } = useQuery({
    queryKey: ["company", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, razao_social, tenant_id, fonte_dados")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: tenant } = useQuery({
    queryKey: ["tenant", company?.tenant_id],
    enabled: !!company?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, plano_contas_modo")
        .eq("id", company!.tenant_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const modoGlobal = (tenant?.plano_contas_modo ?? "empresa") === "global";

  return (
    <PortalShell variant="admin" title={`Dados Contábeis — ${company?.name ?? ""}`}>
      <div className="mb-4">
        <Link to="/admin/empresas" className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para empresas
        </Link>
      </div>

      {modoGlobal && (
        <Card className="p-4 mb-4 border-blue-500/40 bg-blue-500/5 text-sm">
          <strong>Modo de plano de contas: Global.</strong> Esta empresa usa o plano e o mapeamento do escritório.
          Para editar, vá em <Link to="/admin/configuracoes" className="underline">Configurações &gt; Plano Global</Link>.
        </Card>
      )}

      {company && <BalancoFechaBadge tenantId={company.tenant_id!} companyId={company.id} />}


      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="plano">1. Plano de Contas</TabsTrigger>
          <TabsTrigger value="mapeamento">2. Mapeamento</TabsTrigger>
          <TabsTrigger value="saldo-inicial">3. Saldo Inicial</TabsTrigger>
          <TabsTrigger value="diarios">4. Diários</TabsTrigger>
          <TabsTrigger value="mascara">5. Máscara</TabsTrigger>
          <TabsTrigger value="indicadores">6. Indicadores</TabsTrigger>
          <TabsTrigger value="gerencial">7. Ajustes Gerenciais</TabsTrigger>
          <TabsTrigger value="orcamento">8. Orçamento</TabsTrigger>
          <TabsTrigger value="dashboard">9. Dashboard</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          {company && (
            <DashboardConfigPanel
              tenantId={company.tenant_id!}
              companyId={company.id}
            />
          )}
        </TabsContent>

        <TabsContent value="gerencial">
          {company && (
            <AjustesGerenciaisPanel
              tenantId={company.tenant_id!}
              companyId={company.id}
            />
          )}
        </TabsContent>

        <TabsContent value="orcamento">
          {company && (
            <OrcamentoConfigPanel
              tenantId={company.tenant_id!}
              companyId={company.id}
            />
          )}
        </TabsContent>

        <TabsContent value="mascara">
          {company && (
            <MascaraConfigPanel
              tenantId={company.tenant_id!}
              companyId={modoGlobal ? null : company.id}
              escopo={modoGlobal ? "tenant" : "empresa"}
            />
          )}
        </TabsContent>

        <TabsContent value="indicadores">
          {company && (
            <IndicadoresEmpresaPanel
              tenantId={company.tenant_id!}
              companyId={company.id}
            />
          )}
        </TabsContent>

        <TabsContent value="plano">
          {company && (
            <PlanoTab
              tenantId={company.tenant_id!}
              companyId={modoGlobal ? null : company.id}
              readonly={modoGlobal}
            />
          )}
        </TabsContent>

        <TabsContent value="mapeamento">
          {company && (
            <MapeamentoTab
              tenantId={company.tenant_id!}
              companyId={modoGlobal ? null : company.id}
              readonly={modoGlobal}
            />
          )}
        </TabsContent>

        <TabsContent value="saldo-inicial">
          {company && (
            <SaldoInicialTab companyId={company.id} tenantId={company.tenant_id!} />
          )}
        </TabsContent>

        <TabsContent value="diarios">
          {company && (
            <DiariosTab companyId={company.id} tenantId={company.tenant_id!} />
          )}
        </TabsContent>
      </Tabs>
    </PortalShell>
  );
}

// ============================================================
// TAB 1 — Plano de Contas
// ============================================================
function PlanoTab({ tenantId, companyId, readonly }: { tenantId: string; companyId: string | null; readonly: boolean }) {
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<PlanoParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const { data: existente, isLoading } = useQuery({
    queryKey: ["plano-stats", tenantId, companyId],
    queryFn: async () => {
      const porTipo: Record<string, number> = {};
      let estr = 0, part = 0, total = 0;
      const step = 1000;
      for (let from = 0; ; from += step) {
        const q = supabase
          .from("plano_contas")
          .select("tipo, is_participante")
          .eq("tenant_id", tenantId)
          .range(from, from + step - 1);
        const r = companyId == null ? await q.is("company_id", null) : await q.eq("company_id", companyId);
        if (r.error) throw r.error;
        const rows = (r.data ?? []) as any[];
        for (const x of rows) {
          porTipo[x.tipo] = (porTipo[x.tipo] ?? 0) + 1;
          if (x.is_participante) part++; else estr++;
        }
        total += rows.length;
        if (rows.length < step) break;
      }
      return { total, estruturais: estr, participantes: part, porTipo };
    },
  });

  const onFile = async (f: File) => {
    setBusy(true);
    try {
      const mascara = await getMascaraConfig({ tenantId, companyId });
      const result = await parsePlanoContasCSV(f, mascara);
      setParsed(result);
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmar = async () => {
    if (!parsed) return;
    setBusy(true);
    setProgress(0);
    try {
      await salvarPlanoContas({
        tenantId,
        companyId,
        rows: parsed.rows,
        substituir: true,
        onProgress: (loaded, total) => setProgress(Math.round((loaded / total) * 100)),
      });
      toast.success(`Plano de contas importado: ${parsed.total} contas`);
      setParsed(null);
      qc.invalidateQueries({ queryKey: ["plano-stats"] });
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-semibold mb-2">Plano de contas atual</h3>
        {isLoading ? (
          <div className="text-sm text-muted-foreground"><Loader2 className="inline h-3 w-3 animate-spin mr-1" />Carregando…</div>
        ) : (existente?.total ?? 0) === 0 ? (
          <div className="text-sm text-muted-foreground">Nenhum plano carregado ainda.</div>
        ) : (
          <div className="text-sm space-y-1">
            <div><strong>{existente!.total}</strong> contas totais — <strong>{existente!.estruturais}</strong> estruturais, <strong>{existente!.participantes}</strong> participantes</div>
            <div className="flex gap-2 flex-wrap mt-2">
              {Object.entries(existente!.porTipo).map(([t, n]) => (
                <Badge key={t} variant="secondary">{t}: {n}</Badge>
              ))}
            </div>
          </div>
        )}
      </Card>

      {!readonly && (
        <Card className="p-5">
          <h3 className="font-semibold mb-3">Importar plano de contas</h3>
          <p className="text-xs text-muted-foreground mb-3">
            CSV separado por <code>;</code> com cabeçalho <code>Código;Classificação;Descrição;Tipo;Natureza</code>.
            Encoding ISO-8859-1 ou UTF-8 (detectado automaticamente). Importar substitui o plano atual.
          </p>
          <div className="flex items-center gap-3">
            <Input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
            {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {parsed && (
            <div className="mt-4 border border-border rounded-lg p-4 bg-muted/30">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="font-medium">Arquivo lido com sucesso</span>
              </div>
              <ul className="text-sm space-y-1">
                <li><strong>{parsed.total}</strong> linhas — {parsed.estruturais} estruturais + {parsed.participantes} participantes</li>
                <li>Encoding: <code>{parsed.encoding}</code></li>
                <li className="flex flex-wrap gap-1 pt-1">
                  {Object.entries(parsed.porTipo).map(([t, n]) => (
                    <Badge key={t} variant="outline">{t}: {n}</Badge>
                  ))}
                </li>
                {parsed.warnings.map((w, i) => (
                  <li key={i} className="text-amber-600 text-xs"><AlertTriangle className="h-3 w-3 inline mr-1" />{w}</li>
                ))}
              </ul>
              <div className="mt-4 flex gap-2 items-center">
                <Button onClick={confirmar} disabled={busy}>
                  {busy ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Importando {progress}%</> : <><Upload className="h-4 w-4 mr-1" />Confirmar importação</>}
                </Button>
                <Button variant="ghost" onClick={() => setParsed(null)} disabled={busy}>Cancelar</Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ============================================================
// TAB 2 — Mapeamento
// ============================================================
type MapaRow = {
  id?: string;
  classificacao_prefixo: string;
  tipo_demonstracao: TipoDemonstracao;
  linha_demonstracao: string;
  ordem: number;
  inverter_sinal: boolean;
};

function MapeamentoTab({ tenantId, companyId, readonly }: { tenantId: string; companyId: string | null; readonly: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<MapaRow[]>([]);
  const [dirty, setDirty] = useState(false);

  const { data: plano } = useQuery({
    queryKey: ["plano-rows", tenantId, companyId],
    queryFn: async () => {
      // Só precisamos das contas estruturais (não participantes) para sugerir mapeamento.
      // Sem esse filtro o limite padrão de 1000 linhas do PostgREST corta as contas
      // de DRE/BP em planos grandes (cheios de clientes e fornecedores).
      const q = supabase
        .from("plano_contas")
        .select("codigo, classificacao, descricao, tipo, natureza, nivel, is_participante")
        .eq("tenant_id", tenantId)
        .eq("is_participante", false)
        .lte("nivel", 4)
        .range(0, 9999);
      const r = companyId == null ? await q.is("company_id", null) : await q.eq("company_id", companyId);
      if (r.error) throw r.error;
      return (r.data ?? []) as PlanoContaRow[];
    },
  });

  const { data: mapas } = useQuery({
    queryKey: ["mapeamento", tenantId, companyId],
    queryFn: async () => {
      const q = supabase
        .from("mapeamento_demonstracao")
        .select("*")
        .eq("tenant_id", tenantId);
      const r = companyId == null ? await q.is("company_id", null) : await q.eq("company_id", companyId);
      if (r.error) throw r.error;
      return (r.data ?? []) as any[];
    },
  });

  useEffect(() => {
    if (mapas) {
      setEdit(mapas.map((m) => ({
        id: m.id,
        classificacao_prefixo: m.classificacao_prefixo,
        tipo_demonstracao: m.tipo_demonstracao,
        linha_demonstracao: m.linha_demonstracao,
        ordem: m.ordem,
        inverter_sinal: m.inverter_sinal,
      })));
      setDirty(false);
    }
  }, [mapas]);

  const pendentes = useMemo(() => {
    if (!plano) return [];
    return classificacoesNaoMapeadas(plano, edit);
  }, [plano, edit]);

  const aplicarSugestoes = () => {
    if (!plano) return;
    const sug = sugerirMapeamento(plano);
    const sugMap = new Map(sug.map((s) => [`${s.tipo_demonstracao}|${s.classificacao_prefixo}`, s]));
    // Atualiza linhas já existentes que coincidem com a sugestão (corrige mapeamentos errados antigos)
    const atualizado: MapaRow[] = edit.map((m) => {
      const key = `${m.tipo_demonstracao}|${m.classificacao_prefixo}`;
      const s = sugMap.get(key);
      if (!s) return m;
      sugMap.delete(key);
      return {
        ...m,
        linha_demonstracao: s.linha_demonstracao,
        ordem: s.ordem,
        inverter_sinal: s.inverter_sinal,
      };
    });
    const novos = Array.from(sugMap.values()).map((s) => ({
      classificacao_prefixo: s.classificacao_prefixo,
      tipo_demonstracao: s.tipo_demonstracao,
      linha_demonstracao: s.linha_demonstracao,
      ordem: s.ordem,
      inverter_sinal: s.inverter_sinal,
    }));
    setEdit([...atualizado, ...novos]);
    setDirty(true);
    toast.success(`${novos.length} novas linhas, ${atualizado.length - (edit.length - novos.length)} atualizadas`);
  };

  const limparMapeamento = () => {
    if (!confirm("Limpar todas as linhas de mapeamento (não salvas)?")) return;
    setEdit([]);
    setDirty(true);
  };


  const updateRow = (i: number, patch: Partial<MapaRow>) => {
    const next = [...edit];
    next[i] = { ...next[i], ...patch };
    setEdit(next);
    setDirty(true);
  };
  const removeRow = (i: number) => {
    setEdit(edit.filter((_, idx) => idx !== i));
    setDirty(true);
  };
  const addRow = () => {
    setEdit([...edit, { classificacao_prefixo: "", tipo_demonstracao: "DRE", linha_demonstracao: "", ordem: 0, inverter_sinal: false }]);
    setDirty(true);
  };

  const salvar = async () => {
    setBusy(true);
    try {
      // Apaga tudo e re-insere — simples e atômico no escopo (tenant, company, tipo)
      const q = supabase.from("mapeamento_demonstracao").delete().eq("tenant_id", tenantId);
      const r = companyId == null ? await q.is("company_id", null) : await q.eq("company_id", companyId);
      if (r.error) throw r.error;
      const valid = edit.filter((m) => m.classificacao_prefixo.trim() && m.linha_demonstracao.trim());
      if (valid.length > 0) {
        const { error } = await supabase.from("mapeamento_demonstracao").insert(
          valid.map((m) => ({
            tenant_id: tenantId,
            company_id: companyId,
            classificacao_prefixo: m.classificacao_prefixo.trim(),
            tipo_demonstracao: m.tipo_demonstracao,
            linha_demonstracao: m.linha_demonstracao.trim(),
            ordem: m.ordem,
            inverter_sinal: m.inverter_sinal,
          })),
        );
        if (error) throw error;
      }
      toast.success("Mapeamento salvo");
      qc.invalidateQueries({ queryKey: ["mapeamento"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {!readonly && (
        <div className="flex gap-2 items-center">
          <Button onClick={aplicarSugestoes} variant="outline" size="sm" disabled={!plano || plano.length === 0}>
            <Wand2 className="h-4 w-4 mr-1" /> Sugerir mapeamento automático
          </Button>
          <Button onClick={addRow} variant="outline" size="sm">+ Linha manual</Button>
          <Button onClick={limparMapeamento} variant="ghost" size="sm" disabled={edit.length === 0}>Limpar</Button>
          <Button onClick={salvar} disabled={!dirty || busy} size="sm" className="ml-auto">
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar mapeamento
          </Button>
        </div>
      )}

      {pendentes.length > 0 && (
        <Card className="p-4 border-amber-500/40 bg-amber-500/5">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400 mb-2">
            <AlertTriangle className="h-4 w-4" /> {pendentes.length} classificações de nível 3 sem mapeamento
          </div>
          <div className="text-xs text-muted-foreground flex flex-wrap gap-1">
            {pendentes.slice(0, 12).map((p) => (
              <Badge key={p.classificacao} variant="outline">{p.classificacao} — {p.descricao}</Badge>
            ))}
            {pendentes.length > 12 && <Badge variant="outline">+{pendentes.length - 12}</Badge>}
          </div>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-left px-3 py-2">Prefixo</th>
                <th className="text-left px-3 py-2">Linha</th>
                <th className="text-right px-3 py-2 w-20">Ordem</th>
                <th className="text-center px-3 py-2 w-24">Inverter sinal</th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {edit.length === 0 && (
                <tr><td colSpan={6} className="text-center text-muted-foreground p-8">Nenhum mapeamento. Use "Sugerir automático" para começar.</td></tr>
              )}
              {edit.map((m, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-1.5">
                    <select
                      className="h-8 rounded border border-border bg-background px-2 text-xs"
                      value={m.tipo_demonstracao}
                      onChange={(e) => updateRow(i, { tipo_demonstracao: e.target.value as TipoDemonstracao })}
                      disabled={readonly}
                    >
                      <option value="DRE">DRE</option>
                      <option value="BP_ATIVO">BP Ativo</option>
                      <option value="BP_PASSIVO">BP Passivo</option>
                      <option value="DFC">DFC</option>
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <Input className="h-8" value={m.classificacao_prefixo} onChange={(e) => updateRow(i, { classificacao_prefixo: e.target.value })} disabled={readonly} />
                  </td>
                  <td className="px-3 py-1.5">
                    <Input className="h-8" value={m.linha_demonstracao} onChange={(e) => updateRow(i, { linha_demonstracao: e.target.value })} disabled={readonly} />
                  </td>
                  <td className="px-3 py-1.5">
                    <Input className="h-8 text-right" type="number" value={m.ordem} onChange={(e) => updateRow(i, { ordem: parseInt(e.target.value) || 0 })} disabled={readonly} />
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <input type="checkbox" checked={m.inverter_sinal} onChange={(e) => updateRow(i, { inverter_sinal: e.target.checked })} disabled={readonly} />
                  </td>
                  <td className="px-3 py-1.5">
                    {!readonly && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeRow(i)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// TAB 3 — Diários
// ============================================================
function DiariosTab({ companyId, tenantId }: { companyId: string; tenantId: string }) {
  const qc = useQueryClient();
  const { userId } = useAuth();
  const [parsed, setParsed] = useState<DiarioParseResult | null>(null);
  const [filename, setFilename] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const { data: uploads } = useQuery({
    queryKey: ["diario-uploads", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("diario_uploads")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const onFile = async (f: File) => {
    setBusy(true);
    setFilename(f.name);
    try {
      toast.info("Lendo arquivo...");
      const r = await parseDiarioXLSX(f);
      setParsed(r);
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmar = async () => {
    if (!parsed) return;
    if (!parsed.partidas_fechadas) {
      toast.error("Débitos ≠ Créditos. Corrija o arquivo antes de importar.");
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const r = await salvarDiarioUpload({
        tenantId,
        companyId,
        uploadedBy: userId ?? null,
        filename,
        parsed,
        onProgress: (l, t) => setProgress(Math.round((l / t) * 100)),
      });
      // Garante fonte_dados='diario' após o primeiro upload bem-sucedido
      await supabase.from("companies").update({ fonte_dados: "diario" }).eq("id", companyId);
      toast.success(`Diário importado: ${r.total} lançamentos`);
      if (r.contasDesconhecidas > 0) {
        toast.warning(`${r.contasDesconhecidas} contas não estão no plano — lançamentos dessas contas ficarão fora das demonstrações.`);
      }
      setParsed(null);
      qc.invalidateQueries({ queryKey: ["diario-uploads"] });
      qc.invalidateQueries({ queryKey: ["available-periods"] });
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const apagar = async (id: string) => {
    if (!confirm("Remover este upload e seus lançamentos?")) return;
    try {
      await removerUpload(id);
      toast.success("Upload removido");
      qc.invalidateQueries({ queryKey: ["diario-uploads"] });
      qc.invalidateQueries({ queryKey: ["available-periods"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-semibold mb-3">Importar livro diário</h3>
        <p className="text-xs text-muted-foreground mb-3">
          XLSX com colunas <code>Conta, Data, Débito, Crédito</code> (e opcionais).
          O sistema corrige automaticamente XLSX gerados em Windows com barras invertidas no ZIP.
        </p>
        <Input
          type="file"
          accept=".xlsx"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        />
        {busy && !parsed && <div className="text-xs text-muted-foreground mt-2"><Loader2 className="h-3 w-3 inline animate-spin mr-1" />Lendo arquivo (pode demorar)…</div>}

        {parsed && (
          <div className="mt-4 border border-border rounded-lg p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-3">
              {parsed.partidas_fechadas ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-destructive" />
              )}
              <span className="font-medium">Pré-validação</span>
            </div>
            <ul className="text-sm space-y-1">
              <li><strong>{parsed.total}</strong> lançamentos · {parsed.competencia_inicio} a {parsed.competencia_fim}</li>
              <li>Débitos: <strong>{formatBRL(parsed.total_debitos)}</strong> · Créditos: <strong>{formatBRL(parsed.total_creditos)}</strong></li>
              <li>
                Diferença: <strong className={parsed.partidas_fechadas ? "text-emerald-600" : "text-destructive"}>{formatBRL(parsed.diferenca)}</strong>{" "}
                {parsed.partidas_fechadas ? "(partidas fechadas ✓)" : "(partidas NÃO fechadas)"}
              </li>
              <li>{parsed.competencias.length} competências distintas, {parsed.contas_codigos.length} contas distintas</li>
              {parsed.warnings.map((w, i) => (
                <li key={i} className="text-amber-600 text-xs"><AlertTriangle className="h-3 w-3 inline mr-1" />{w}</li>
              ))}
            </ul>
            <div className="mt-4 flex gap-2 items-center">
              <Button onClick={confirmar} disabled={busy || !parsed.partidas_fechadas}>
                {busy ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Importando {progress}%</> : <><Upload className="h-4 w-4 mr-1" />Confirmar importação</>}
              </Button>
              <Button variant="ghost" onClick={() => setParsed(null)} disabled={busy}>Cancelar</Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Arquivo</th>
              <th className="text-left px-3 py-2">Período</th>
              <th className="text-right px-3 py-2">Lançamentos</th>
              <th className="text-right px-3 py-2">Débitos</th>
              <th className="text-right px-3 py-2">Créditos</th>
              <th className="text-center px-3 py-2">Status</th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {(uploads ?? []).length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Nenhum upload ainda.</td></tr>
            )}
            {(uploads ?? []).map((u: any) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2">{u.filename}</td>
                <td className="px-3 py-2">{u.competencia_inicio} → {u.competencia_fim}</td>
                <td className="px-3 py-2 text-right">{u.total_lancamentos}</td>
                <td className="px-3 py-2 text-right">{formatBRL(Number(u.total_debitos))}</td>
                <td className="px-3 py-2 text-right">{formatBRL(Number(u.total_creditos))}</td>
                <td className="px-3 py-2 text-center">
                  {u.status === "done" ? <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">Pronto</Badge>
                    : u.status === "error" ? <Badge variant="destructive">Erro</Badge>
                    : <Badge variant="secondary">Processando</Badge>}
                  {u.contas_desconhecidas > 0 && <div className="text-xs text-amber-600 mt-1">{u.contas_desconhecidas} contas fora do plano</div>}
                </td>
                <td className="px-3 py-2">
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => apagar(u.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ============================================================
// TAB 3 — Saldo Inicial (balancete de abertura)
// ============================================================
function SaldoInicialTab({ tenantId, companyId }: { tenantId: string; companyId: string }) {
  const qc = useQueryClient();
  const { userId } = useAuth();
  const [parsed, setParsed] = useState<import("@/lib/saldo-inicial/parse-balancete").SaldoInicialParseResult | null>(null);
  const [filename, setFilename] = useState<string>("");
  const [dataRef, setDataRef] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const { data: uploads } = useQuery({
    queryKey: ["saldo-inicial-uploads", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saldo_inicial_uploads")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const onFile = async (f: File) => {
    setBusy(true);
    setFilename(f.name);
    try {
      const { parseSaldoInicialCSV } = await import("@/lib/saldo-inicial/parse-balancete");
      const mascara = await getMascaraConfig({ tenantId, companyId });
      const result = await parseSaldoInicialCSV(f, mascara);
      setParsed(result);
      // sugere 31/12 do ano anterior à competência mais antiga, ou hoje
      if (!dataRef) {
        const hoje = new Date();
        const anoPassado = hoje.getFullYear() - 1;
        setDataRef(`${anoPassado}-12-31`);
      }
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmar = async () => {
    if (!parsed || !dataRef) {
      toast.error("Defina a data de referência.");
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const { salvarSaldoInicial } = await import("@/lib/saldo-inicial/uploader");
      await salvarSaldoInicial({
        tenantId,
        companyId,
        uploadedBy: userId ?? null,
        filename,
        dataReferencia: dataRef,
        parsed,
        substituirData: true,
        onProgress: (loaded, total) => setProgress(Math.round((loaded / total) * 100)),
      });
      toast.success(`Saldo inicial importado: ${parsed.total} contas`);
      setParsed(null);
      setFilename("");
      qc.invalidateQueries({ queryKey: ["saldo-inicial-uploads", companyId] });
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const apagar = async (uploadId: string) => {
    if (!confirm("Remover este saldo inicial? Os saldos vinculados também serão apagados.")) return;
    try {
      const { removerSaldoInicialUpload } = await import("@/lib/saldo-inicial/uploader");
      await removerSaldoInicialUpload(uploadId, companyId);
      toast.success("Saldo inicial removido");
      qc.invalidateQueries({ queryKey: ["saldo-inicial-uploads", companyId] });
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-semibold mb-2">Importar balancete de abertura</h3>
        <p className="text-xs text-muted-foreground mb-3">
          CSV separado por <code>;</code> com cabeçalho <code>Classificação;Conta;Sub;Nome da conta contábil/C. Custo;Tipo conta;Nível;Cta. título;Estab.;Valor</code>.
          Encoding UTF-8 (com BOM) ou Latin-1 detectado automaticamente. Apenas analíticas (<code>Cta. título = 2-Não</code>) são processadas — incluindo participantes (clientes, fornecedores).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div>
            <Label className="text-xs">Arquivo CSV</Label>
            <Input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
          </div>
          <div>
            <Label className="text-xs">Data de referência (último dia do exercício anterior)</Label>
            <Input
              type="date"
              value={dataRef}
              onChange={(e) => setDataRef(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>
        {busy && !parsed && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}

        {parsed && (
          <div className="mt-4 border border-border rounded-lg p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-3">
              {parsed.equilibrado ? (
                <><CheckCircle2 className="h-4 w-4 text-emerald-600" /><span className="font-medium">Balanço fecha</span></>
              ) : (
                <><AlertTriangle className="h-4 w-4 text-amber-600" /><span className="font-medium">Balanço NÃO fecha — verifique</span></>
              )}
            </div>
            <ul className="text-sm space-y-1">
              <li><strong>{parsed.total}</strong> contas analíticas — {parsed.participantes} participantes (clientes/fornecedores)</li>
              <li>Ativo: <strong>{formatBRL(parsed.total_ativo)}</strong></li>
              <li>Passivo + PL: <strong>{formatBRL(parsed.total_passivo_pl)}</strong></li>
              <li>Diferença: <strong className={parsed.equilibrado ? "text-emerald-600" : "text-amber-600"}>{formatBRL(parsed.diferenca)}</strong></li>
              <li>Encoding: <code>{parsed.encoding}</code></li>
              {parsed.warnings.map((w, i) => (
                <li key={i} className="text-amber-600 text-xs"><AlertTriangle className="h-3 w-3 inline mr-1" />{w}</li>
              ))}
            </ul>
            <div className="mt-4 flex gap-2 items-center">
              <Button onClick={confirmar} disabled={busy || !dataRef}>
                {busy ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Importando {progress}%</> : <><Upload className="h-4 w-4 mr-1" />Confirmar importação</>}
              </Button>
              <Button variant="ghost" onClick={() => setParsed(null)} disabled={busy}>Cancelar</Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold mb-2">Saldos iniciais carregados</h3>
        {!uploads || uploads.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nenhum saldo inicial carregado ainda.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-1.5">Arquivo</th>
                <th className="text-left px-2 py-1.5">Data ref.</th>
                <th className="text-right px-2 py-1.5">Contas</th>
                <th className="text-right px-2 py-1.5">Ativo</th>
                <th className="text-right px-2 py-1.5">Passivo + PL</th>
                <th className="text-center px-2 py-1.5">Status</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u: any) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-2 py-2 text-xs">{u.filename}</td>
                  <td className="px-2 py-2 text-xs">{u.data_referencia}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{u.total_contas}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatBRL(Number(u.total_ativo))}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatBRL(Number(u.total_passivo_pl))}</td>
                  <td className="px-2 py-2 text-center">
                    {u.equilibrado ? (
                      <Badge variant="outline" className="text-emerald-600 border-emerald-600/40">✓ fecha</Badge>
                    ) : (
                      <Badge variant="outline" className="text-amber-600 border-amber-600/40">⚠ {formatBRL(Number(u.diferenca))}</Badge>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => apagar(u.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// suppress unused warning
void Label;
