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
import { Loader2, Upload, AlertTriangle, CheckCircle2, Trash2, ArrowLeft, Wand2, Save, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { parsePlanoContasCSV, type PlanoContaRow, type PlanoParseResult } from "@/lib/diario/plano-parser";
import { parseDiarioXLSX, type DiarioParseResult } from "@/lib/diario/diario-parser";
import { salvarPlanoContas, salvarDiarioUpload, removerUpload } from "@/lib/diario/uploader";
import { formatBRL } from "@/lib/format";
import { MascaraConfigPanel } from "@/components/mascara-config";
import { BalancoFechaBadge } from "@/components/balanco-fecha-badge";
import { EcdPanel } from "@/components/ecd/ecd-panel";
import { getMascaraConfig } from "@/lib/mascara/interpretar";
import { IndicadoresEmpresaPanel } from "@/components/indicadores/indicadores-empresa-panel";
import { AjustesGerenciaisPanel } from "@/components/gerencial/ajustes-gerenciais-panel";
import { OrcamentoConfigPanel } from "@/components/orcamento/orcamento-config-panel";
import { PlanilhaDfcBotoes } from "@/components/dfc/planilha-dfc-botoes";
import { DashboardConfigPanel } from "@/components/dashboard/dashboard-config-panel";
import { DeParaPanel } from "@/components/plano/depara-panel";
import { ContasNovasEmpresaPanel } from "@/components/plano/contas-novas-empresa";
import { getEscopoPlano } from "@/lib/plano/escopo";

export const Route = createFileRoute("/admin/empresas/$id/dados")({
  component: Page,
});

function ajusteAplicadoRaw(c: any): boolean {
  return !!c && "plano_tipo" in c;
}

function Page() {
  const { id } = useParams({ from: "/admin/empresas/$id/dados" });
  const [tab, setTab] = useState<"plano" | "depara" | "saldo-inicial" | "diarios" | "mascara" | "indicadores" | "gerencial" | "orcamento" | "dashboard">("plano");

  const { data: company } = useQuery({
    queryKey: ["company", id],
    queryFn: async () => {
      // select("*") de propósito: listar colunas explicitamente faz a
      // query inteira falhar se UMA delas ainda não existir no banco
      // (ex.: plano_tipo antes de aplicar as migrations do ajuste 01).
      // Como todo o conteúdo das abas é renderizado sob {company && ...},
      // esse erro deixava a página inteira em branco.
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
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

  // AJUSTE 02 — quem decide o escopo do plano é a própria empresa.
  const { data: escopo } = useQuery({
    queryKey: ["escopo-plano", id],
    enabled: !!company?.id && ajusteAplicadoRaw(company),
    queryFn: () => getEscopoPlano(id),
  });
  const usaPlanoPadrao = escopo?.usa_plano_padrao ?? false;
  const fallbackPlanoProprio = escopo?.fallback_plano_proprio ?? false;
  const modoGlobal = usaPlanoPadrao || (tenant?.plano_contas_modo ?? "empresa") === "global";
  // A presença da coluna plano_tipo é o sinal de que as migrations do
  // ajuste 01 já rodaram neste banco. Sem elas, as abas novas não têm
  // as RPCs de que dependem — melhor avisar do que falhar em silêncio.
  const ajusteAplicado = !!company && "plano_tipo" in company;
  const planoProprio = (company?.plano_tipo ?? "padrao") === "proprio";
  // O cadastro do Plano Padrão mora em /admin/plano-padrao. Quando a
  // empresa usa o Padrão, estas abas não existem aqui — só empresas com
  // plano de terceiro mantêm plano e alocação próprios.
  const abasDePlanoAqui = !usaPlanoPadrao;
  const mostraDePara = ajusteAplicado && planoProprio;

  // As abas visíveis variam (empresa de Plano Padrão não tem plano nem
  // de-para), então a numeração é derivada da lista — senão fica
  // "2. Saldo Inicial" como primeira, ou o De-Para sem número.
  const abas = useMemo(() => {
    const lista: { value: string; label: string }[] = [];
    if (abasDePlanoAqui) lista.push({ value: "plano", label: "Plano de Contas" });
    if (mostraDePara) lista.push({ value: "depara", label: "De-Para" });
    lista.push({ value: "saldo-inicial", label: "Saldo Inicial" });
    lista.push({ value: "diarios", label: "Diários" });
    lista.push({ value: "ecd", label: "ECD (períodos anteriores)" });
    lista.push({ value: "mascara", label: "Máscara" });
    lista.push({ value: "indicadores", label: "Indicadores" });
    lista.push({ value: "gerencial", label: "Ajustes Gerenciais" });
    lista.push({ value: "orcamento", label: "Orçamento" });
    lista.push({ value: "dashboard", label: "Dashboard" });
    return lista.map((a, i) => ({ ...a, label: `${i + 1}. ${a.label}` }));
  }, [abasDePlanoAqui, mostraDePara]);

  // Se a aba ativa deixou de existir (ex.: a empresa passou a usar o
  // Padrão enquanto a tela estava aberta), cai para uma aba válida.
  useEffect(() => {
    if (abas.length && !abas.some((a) => a.value === tab)) {
      setTab(abas[0].value as any);
    }
  }, [abas, tab]);

  return (
    <PortalShell variant="admin" title={`Dados Contábeis — ${company?.name ?? ""}`}>
      <div className="mb-4">
        <Link to="/admin/empresas" className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para empresas
        </Link>
      </div>

      {modoGlobal && !usaPlanoPadrao && (
        <Card className="p-4 mb-4 border-blue-500/40 bg-blue-500/5 text-sm">
          <strong>Modo de plano de contas: Global.</strong> Esta empresa usa o plano do escritório.
          Para editar, vá em <Link to="/admin/plano-padrao" className="underline">Plano Padrão</Link>.
        </Card>
      )}

      {company && !ajusteAplicado && (
        <Card className="p-4 mb-4 border-amber-500/40 bg-amber-500/5 text-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <strong>Migrations do ajuste 01 ainda não aplicadas neste banco.</strong>
              <p className="text-muted-foreground mt-1">
                As abas <em>De-Para</em> e <em>Plano Padrão</em> dependem de colunas e funções que ainda
                não existem. Rode <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">npx supabase db reset</code>{" "}
                na pasta do projeto (com as 3 migrations copiadas para <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">supabase/migrations/</code>)
                e recarregue esta página.
              </p>
            </div>
          </div>
        </Card>
      )}

      {company && ajusteAplicado && <OrigemPlanoCard company={company} />}

      {/* A alocação da DFC DESTA empresa, em planilha.
          Existia só para o escritório. Exportar aqui é conferência —
          conta a conta, com a coluna que diz de onde cada uma herdou o
          código — e é o único jeito de ver, para ESTA empresa, o que a
          tela mostra agregado. Importar só aparece quando a alocação é
          mesmo desta empresa: numa empresa de Plano Padrão ela é do
          escritório, e gravar aqui criaria uma divergência silenciosa. */}
      {company && ajusteAplicado && company.tenant_id && (
        <Card className="p-4 mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex-1 min-w-[240px]">
              <div className="text-sm font-medium">Alocação da DFC</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {usaPlanoPadrao
                  ? "A alocação vem do Plano Padrão do escritório. A planilha sai conta a conta, com o movimento desta empresa — para conferir sem sair daqui."
                  : "A alocação é desta empresa. A planilha sai conta a conta e volta como configuração."}
              </p>
            </div>
            <PlanilhaDfcBotoes
              tenantId={company.tenant_id}
              companyId={id}
              permitirImportar={!usaPlanoPadrao}
              nomeArquivo={`alocacoes-dfc-${(company.name ?? "empresa").replace(/[^\w-]+/g, "-").toLowerCase()}`}
              onDone={() => {}}
              disabled={false}
            />
          </div>
        </Card>
      )}

      {company && ajusteAplicado && usaPlanoPadrao && (
        <Card className="p-4 mb-4 border-blue-500/40 bg-blue-500/5 text-sm">
          <div className="flex items-start gap-3">
            <BookOpen className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <strong>Esta empresa usa o Plano Padrão do escritório.</strong>
              <p className="text-muted-foreground mt-1">
                O cadastro do plano e a alocação de DRE/Balanço/DFC não ficam aqui: são mantidos
                uma única vez no escritório e valem para todas as empresas do sistema contábil.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link to="/admin/plano-padrao">
                  <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                  Abrir Plano Padrão
                </Link>
              </Button>
            </div>
          </div>
        </Card>
      )}

      {company && ajusteAplicado && fallbackPlanoProprio && (
        <Card className="p-4 mb-4 border-amber-500/40 bg-amber-500/5 text-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <strong>Empresa marcada como Plano Padrão, mas o escritório ainda não tem um.</strong>
              <p className="text-muted-foreground mt-1">
                Por isso ela segue lendo o plano próprio — nada quebrou. Monte o plano em{" "}
                <Link to="/admin/plano-padrao" className="underline font-medium">Plano Padrão</Link>{" "}
                (dá para promover o plano desta empresa lá) e a troca é automática.
              </p>
            </div>
          </div>
        </Card>
      )}

      {company && <BalancoFechaBadge tenantId={company.tenant_id!} companyId={company.id} />}


      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          {abas.map((a) => (
            <TabsTrigger key={a.value} value={a.value}>{a.label}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="ecd">
          {company && (
            <EcdPanel tenantId={company.tenant_id!} companyId={company.id} />
          )}
        </TabsContent>

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
          {company && abasDePlanoAqui && (
            <PlanoTab
              tenantId={company.tenant_id!}
              companyId={modoGlobal ? null : company.id}
              readonly={modoGlobal}
            />
          )}
        </TabsContent>

        <TabsContent value="depara">
          {company && mostraDePara && (
            <DeParaPanel tenantId={company.tenant_id!} companyId={company.id} />
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
      // O diário é a fonte de dados do BI. Conta que veio nele e não
      // existe no plano NÃO entra sozinha: vira pendência de aprovação,
      // logo abaixo, para incrementar o Plano Padrão de forma explícita.
      if (r.contasDesconhecidas > 0) {
        qc.invalidateQueries({ queryKey: ["contas-novas-empresa", tenantId, companyId] });
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
      {/* Carrega diário -> valida contas novas -> aprovação para o Plano Padrão */}
      <ContasNovasEmpresaPanel tenantId={tenantId} companyId={companyId} />

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


// ============================================================
// Origem do plano de contas: Padrão do escritório x plano de terceiro
// ============================================================
function OrigemPlanoCard({ company }: { company: any }) {
  const qc = useQueryClient();
  const [salvando, setSalvando] = useState(false);
  const atual = (company.plano_tipo ?? "padrao") as "padrao" | "proprio";

  const trocar = async (novo: "padrao" | "proprio") => {
    if (novo === atual) return;
    setSalvando(true);
    try {
      const { error } = await supabase
        .from("companies")
        .update({ plano_tipo: novo })
        .eq("id", company.id);
      if (error) throw error;
      toast.success(
        novo === "padrao"
          ? "Empresa marcada como Plano Padrão."
          : "Empresa marcada como plano próprio — configure o De-Para.",
      );
      qc.invalidateQueries({ queryKey: ["company", company.id] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Card className="p-4 mb-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[240px]">
          <div className="text-sm font-medium">Origem do plano de contas</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {atual === "padrao"
              ? "Usa o Plano Padrão do escritório — a alocação de DRE/Balanço/DFC vem pronta e é atualizada junto com o plano."
              : "Plano de um sistema de terceiro — precisa do De-Para para as contas do Plano Padrão."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={atual === "padrao" ? "default" : "outline"}
            disabled={salvando}
            onClick={() => trocar("padrao")}
          >
            Plano Padrão
          </Button>
          <Button
            size="sm"
            variant={atual === "proprio" ? "default" : "outline"}
            disabled={salvando}
            onClick={() => trocar("proprio")}
          >
            Outro sistema
          </Button>
        </div>
      </div>
    </Card>
  );
}
