// PLANO PADRÃO — o coração do BI, gerenciado no nível do ESCRITÓRIO.
//
// Sai de dentro da empresa porque não é dado de uma empresa: é a
// estrutura que o escritório mantém, espelhando o sistema contábil,
// e que gera DRE / Balanço / DFC / indicadores de TODAS as empresas
// que usam esse sistema.
//
// Três coisas acontecem aqui:
//   1. Atualização mensal (carga incremental do CSV — o plano só cresce)
//   2. Contas novas que apareceram no DIÁRIO e não existem no plano,
//      com aprovação explícita conta a conta
//   3. Alocação DRE/Balanço/DFC feita UMA VEZ para todas as empresas
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PortalShell } from "@/components/portal-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, CheckCircle2, Loader2, Search, Upload, Trash2, Undo2, BookOpen, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatBRL } from "@/lib/format";
import { parsePlanoContasCSV, type PlanoParseResult } from "@/lib/diario/plano-parser";
import { getMascaraConfig } from "@/lib/mascara/interpretar";
import { ContasNovasEmpresaPanel } from "@/components/plano/contas-novas-empresa";
import { getEstruturaPadrao } from "@/lib/plano/estrutura";
import { tituloConta } from "@/lib/format";
import { PlanilhaDfcBotoes } from "@/components/dfc/planilha-dfc-botoes";
import { ContasPlanoPadrao } from "@/components/plano/contas-plano-padrao";

export const Route = createFileRoute("/admin/plano-padrao")({ component: Page });

interface ContaNova {
  codigo: string;
  movimento: number;
  lancamentos: number;
  historico_exemplo: string | null;
  empresas: string | null;
  primeira_competencia: string | null;
  ultima_competencia: string | null;
}

function Page() {
  const { profile, role } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const podeEditar = role === "tenant_admin" || role === "orkestria_admin";

  const { data: resumo, isLoading } = useQuery({
    queryKey: ["plano-padrao-resumo", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("plano_padrao_resumo", { _tenant_id: tenantId! });
      if (error) throw error;
      return data as any;
    },
  });

  if (!tenantId) {
    return (
      <PortalShell variant="admin" title="Plano Padrão">
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Seu usuário não está vinculado a um escritório.
        </Card>
      </PortalShell>
    );
  }

  const r = resumo ?? {};
  const vazio = (r.total ?? 0) === 0;

  return (
    <PortalShell variant="admin" title="Plano Padrão do escritório">
      <Card className="p-4 mb-4 border-primary/20 bg-primary/5">
        <div className="flex items-start gap-3 text-sm">
          <BookOpen className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Esta é a fonte principal do BI</div>
            <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">
              O Plano Padrão espelha o seu sistema contábil e vale para todas as empresas marcadas
              como "Plano Padrão". A <strong>estrutura das demonstrações é a própria hierarquia
              do plano</strong>, subtotais inclusive: as contas .98/.99 do próprio plano são as
              linhas de fecho da DRE. A única coisa que se configura aqui é como cada conta
              analítica movimenta a <strong>DFC</strong>. Empresas de outros sistemas usam
              de-para, dentro de cada empresa. O mapa de colunas do arquivo do ERP fica em{" "}
              <Link to="/admin/sistemas" className="underline">Sistemas e layouts</Link>.
            </p>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <Metrica label="Contas no plano" valor={r.total ?? 0}
              sub={`${r.estruturais ?? 0} estruturais · ${r.participantes ?? 0} participantes`} />
            <Metrica label="Subtotais da DRE" valor={r.acumuladores ?? 0}
              alerta={(r.acumuladores ?? 0) === 0} sub="contas .98/.99 do plano" />
            <Metrica label="Sem flag de DFC" valor={r.sem_dfc ?? 0}
              alerta={(r.sem_dfc ?? 0) > 0} sub="analíticas de Ativo/Passivo" />
            <Metrica label="Contas novas no diário" valor={r.contas_novas ?? 0}
              alerta={(r.contas_novas ?? 0) > 0} sub="aguardando revisão" />
            <Metrica label="Empresas usando" valor={r.empresas_usando ?? 0} sub="marcadas como Padrão" />
          </div>

          {vazio && (
            <Card className="p-4 mb-4 border-amber-500/40 bg-amber-500/5 text-sm">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <strong>O Plano Padrão ainda está vazio.</strong>
                  <p className="text-muted-foreground mt-1">
                    Enquanto estiver assim, cada empresa continua lendo o próprio plano (nada
                    quebra). Suba o CSV do seu sistema contábil na aba <em>Atualização</em>, ou
                    promova o plano de uma empresa existente para virar o Padrão.
                  </p>
                </div>
              </div>
            </Card>
          )}

          <Tabs defaultValue={(r.contas_novas ?? 0) > 0 ? "novas" : "contas"}>
            <TabsList>
              <TabsTrigger value="contas">Contas</TabsTrigger>
              <TabsTrigger value="atualizacao">Atualização mensal</TabsTrigger>
              <TabsTrigger value="novas">
                Contas novas do diário
                {(r.contas_novas ?? 0) > 0 && (
                  <Badge className="ml-1.5" variant="secondary">{r.contas_novas}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="marcos">Estrutura e DFC</TabsTrigger>
              <TabsTrigger value="descartadas">
                Descartadas {(r.descartadas ?? 0) > 0 && <span className="ml-1 opacity-60">({r.descartadas})</span>}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="contas">
              <ContasPlanoPadrao tenantId={tenantId} podeEditar={podeEditar} />
            </TabsContent>
            <TabsContent value="atualizacao">
              <AtualizacaoTab tenantId={tenantId} podeEditar={podeEditar} />
            </TabsContent>
            <TabsContent value="novas">
              <ContasNovasEmpresaPanel tenantId={tenantId} podeEditar={podeEditar} />
            </TabsContent>
            <TabsContent value="marcos">
              <EstruturaTab tenantId={tenantId} podeEditar={podeEditar} />
            </TabsContent>
            <TabsContent value="descartadas">
              <DescartadasTab tenantId={tenantId} podeEditar={podeEditar} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </PortalShell>
  );
}

function Metrica({ label, valor, sub, alerta }: {
  label: string; valor: number | string; sub?: string; alerta?: boolean;
}) {
  return (
    <Card className={`p-3 ${alerta ? "border-amber-500/40 bg-amber-500/5" : ""}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{valor}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}

// ============================================================
// Atualização mensal (carga incremental)
// ============================================================
function AtualizacaoTab({ tenantId, podeEditar }: { tenantId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<PlanoParseResult | null>(null);
  const [arquivo, setArquivo] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [progresso, setProgresso] = useState("");

  const { data: historico } = useQuery({
    queryKey: ["plano-atualizacoes", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("plano_atualizacoes")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("company_id", null)
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data ?? [];
    },
  });

  const escolher = async (f: File) => {
    setBusy(true);
    try {
      const mascara = await getMascaraConfig({ tenantId, companyId: null });
      const res = await parsePlanoContasCSV(f, mascara);
      setParsed(res);
      setArquivo(f.name);
      if (res.warnings.length) res.warnings.forEach((w) => toast.warning(w));
    } catch (e: any) {
      toast.error(e.message);
      setParsed(null);
    } finally {
      setBusy(false);
    }
  };

  const aplicar = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const LOTE = 500;
      let novas = 0, atualizadas = 0, inalteradas = 0;
      for (let i = 0; i < parsed.rows.length; i += LOTE) {
        setProgresso(`Enviando ${Math.min(i + LOTE, parsed.rows.length)} de ${parsed.rows.length}…`);
        const lote = parsed.rows.slice(i, i + LOTE).map((r) => ({
          codigo: r.codigo,
          classificacao: r.classificacao,
          descricao: r.descricao,
          tipo: r.tipo,
          natureza: r.natureza,
          nivel: r.nivel,
          is_participante: r.is_participante,
          is_sintetica: r.is_sintetica,
          conta_pai_classificacao: r.conta_pai_classificacao,
        }));
        const { data, error } = await (supabase as any).rpc("atualizar_plano_padrao", {
          _tenant_id: tenantId,
          _company_id: null as any,
          _rows: lote as any,
        });
        if (error) throw error;
        novas += (data as any).novas ?? 0;
        atualizadas += (data as any).atualizadas ?? 0;
        inalteradas += (data as any).inalteradas ?? 0;
      }
      await (supabase as any).from("plano_atualizacoes").insert({
        tenant_id: tenantId, company_id: null, filename: arquivo,
        total_arquivo: parsed.rows.length, novas, atualizadas, inalteradas,
      });
      toast.success(`Plano atualizado: ${novas} nova(s), ${atualizadas} alterada(s), ${inalteradas} sem mudança.`);
      setParsed(null);
      qc.invalidateQueries({ queryKey: ["plano-padrao-resumo", tenantId] });
      qc.invalidateQueries({ queryKey: ["plano-atualizacoes", tenantId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
      setProgresso("");
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5 max-w-2xl">
        <div className="text-sm font-medium mb-1">Carga mensal do plano</div>
        <p className="text-xs text-muted-foreground mb-4">
          A carga é <strong>incremental</strong>: contas novas entram, as existentes têm só a
          descrição atualizada, e <strong>nenhuma conta é apagada ou inativada</strong> — conta que
          não vier no arquivo continua no plano, com a alocação intacta.
        </p>
        <label className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 cursor-pointer hover:bg-accent/40 transition-colors">
          <Upload className="h-7 w-7 text-muted-foreground mb-2" />
          <div className="text-sm font-medium">Selecione o CSV do plano de contas</div>
          <div className="text-xs text-muted-foreground mt-1">
            Colunas: Código; Classificação; Descrição; Tipo; Natureza
          </div>
          <input type="file" accept=".csv,.txt" className="hidden" disabled={busy || !podeEditar}
            onChange={(e) => e.target.files?.[0] && escolher(e.target.files[0])} />
        </label>

        {parsed && (
          <div className="mt-4 rounded-lg border p-4 bg-muted/20">
            <div className="text-sm font-medium mb-2">Prévia de {arquivo}</div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Total</div><div className="font-semibold tabular-nums">{parsed.total}</div></div>
              <div><div className="text-xs text-muted-foreground">Estruturais</div><div className="font-semibold tabular-nums">{parsed.estruturais}</div></div>
              <div><div className="text-xs text-muted-foreground">Participantes</div><div className="font-semibold tabular-nums">{parsed.participantes}</div></div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button onClick={aplicar} disabled={busy || !podeEditar}>
                {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Aplicar ao Plano Padrão
              </Button>
              <Button variant="ghost" onClick={() => setParsed(null)} disabled={busy}>Cancelar</Button>
              {progresso && <span className="text-xs text-muted-foreground">{progresso}</span>}
            </div>
          </div>
        )}
      </Card>

      <PromoverPlanoCard tenantId={tenantId} podeEditar={podeEditar} />

      <div>
        <h3 className="text-sm font-medium mb-2 text-muted-foreground uppercase tracking-wider">Histórico</h3>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Quando</th>
                <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Arquivo</th>
                <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Novas</th>
                <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Atualizadas</th>
                <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Sem mudança</th>
              </tr>
            </thead>
            <tbody>
              {(historico ?? []).map((h: any) => (
                <tr key={h.id} className="border-t">
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(h.created_at).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-3 py-2">{h.filename ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{h.novas}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{h.atualizadas}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{h.inalteradas}</td>
                </tr>
              ))}
              {(historico ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhuma carga registrada ainda.
                </td></tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// ESTRUTURA e DFC
// ============================================================
// A estrutura da DRE/Balanço vem inteira da hierarquia do plano: as
// contas `.98`/`.99` que o sistema contábil já traz (3.01.99 = Receita
// Líquida, 3.05.99 = Lucro Bruto, 3.99 = Resultado do Exercício) são os
// subtotais da demonstração. Os "marcos" — etiqueta manual em ~25 contas
// dizendo onde cada bloco começava — foram removidos: eram uma segunda
// fonte de verdade para algo que o plano já dizia.
//
// Sobra uma configuração de verdade: como cada conta analítica movimenta
// o caixa (DFC).
function EstruturaTab({ tenantId, podeEditar }: { tenantId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [buscaDfc, setBuscaDfc] = useState("");

  // Cobertura numa consulta só.
  //
  // Esta tela carregava 40.000 linhas do plano em 40 idas ao servidor, só
  // para contar quantas contas faltavam classificar. Num plano de 135.000
  // contas ela não terminava de carregar — e era por isso que o botão de
  // reaplicar a planilha "não funcionava": a tela travava antes de dar
  // para clicar.
  const { data: cobertura, isLoading } = useQuery({
    queryKey: ["dfc-cobertura", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("dfc_cobertura", {
        _tenant_id: tenantId, _company_id: null,
      });
      if (error) throw error;
      return data as {
        analiticas_balanco: number; sem_codigo: number;
        sinteticas_balanco: number; sinteticas_sem_codigo: number; total_plano: number;
      };
    },
  });

  // As sintéticas que ainda mandam em analíticas sem código, ordenadas
  // pelo que cada uma RESOLVE. No plano do escritório as duas primeiras
  // linhas cobrem 134.000 contas.
  const { data: sinteticas } = useQuery({
    queryKey: ["dfc-sinteticas-pendentes", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("dfc_sinteticas_pendentes", {
        _tenant_id: tenantId, _company_id: null, _limite: 150,
      });
      if (error) throw error;
      return (data ?? []) as {
        classificacao: string; descricao: string; tipo: string; nivel: number;
        dfc_codigo: string | null; analiticas_sem_codigo: number; analiticas_total: number;
      }[];
    },
  });

  const { data: catalogo } = useQuery({
    queryKey: ["dfc-catalogo"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("dfc_catalogo").select("codigo, descricao, bloco, ordem").order("ordem");
      if (error) throw error;
      return (data ?? []) as { codigo: string; descricao: string; bloco: string; ordem: number }[];
    },
    staleTime: 10 * 60_000,
  });

  const { data: vinculos } = useQuery({
    queryKey: ["dfc-vinculos-mapa", tenantId],
    queryFn: async () => {
      const [{ data: v, error: e1 }, { data: p, error: e2 }] = await Promise.all([
        (supabase as any).from("dfc_vinculo")
          .select("classificacao, codigo_dfc, origem")
          .eq("tenant_id", tenantId).is("company_id", null).order("classificacao"),
        (supabase as any).from("dfc_padrao").select("classificacao, descricao_referencia"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const nomes = new Map((p ?? []).map((x: any) => [x.classificacao, x.descricao_referencia]));
      return ((v ?? []) as { classificacao: string; codigo_dfc: string; origem: string }[])
        .map((row) => ({ ...row, descricao: nomes.get(row.classificacao) ?? "" }));
    },
  });

  const { data: semDfc } = useQuery({
    queryKey: ["dfc-analiticas-sem-codigo", tenantId, buscaDfc],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("dfc_analiticas_sem_codigo", {
        _tenant_id: tenantId, _company_id: null,
        _busca: buscaDfc.trim() || null, _limite: 200,
      });
      if (error) throw error;
      return (data ?? []) as {
        codigo: string; classificacao: string; descricao: string;
        tipo: string; conta_pai: string | null;
      }[];
    },
  });

  // Os subtotais que o plano declara (.98/.99) — consulta pequena.
  const { data: acumuladores } = useQuery({
    queryKey: ["plano-acumuladores", tenantId],
    queryFn: async () => {
      const [{ data: rows, error }, est] = await Promise.all([
        supabase
          .from("plano_contas")
          .select("classificacao, descricao")
          .eq("tenant_id", tenantId)
          .is("company_id", null)
          .eq("is_sintetica", true)
          .like("classificacao", "3.%")
          .order("classificacao")
          .range(0, 999),
        getEstruturaPadrao(),
      ]);
      if (error) throw error;
      const ehApuracao = (c: string) =>
        c.split(".").slice(1).some((seg) => seg === "98" || seg === "99");
      return (rows ?? [])
        .filter((c: any) => ehApuracao(c.classificacao))
        .map((c: any) => {
          const def = est.find((e) => e.classificacao === c.classificacao);
          return {
            classificacao: c.classificacao,
            descricao: def?.rotulo ?? c.descricao,
            tipo: def?.tipo_linha ?? "bloco",
            papel: def?.papel ?? null,
          };
        });
    },
  });

  const invalidar = () => {
    for (const k of ["dfc-cobertura", "dfc-sinteticas-pendentes", "dfc-analiticas-sem-codigo",
                     "dfc-vinculos-mapa", "plano-acumuladores", "plano-padrao-resumo"]) {
      qc.invalidateQueries({ queryKey: [k, tenantId] });
      qc.invalidateQueries({ queryKey: [k] });
    }
  };

  const classificarSintetica = async (classificacao: string, codigo: string) => {
    setBusy(classificacao);
    try {
      // Vínculo por CLASSIFICAÇÃO: uma linha, não um UPDATE em cada
      // conta abaixo. Classificar "clientes nacionais" reescrevia 113.101
      // linhas e estourava o timeout de 8 s do servidor — medido em
      // 10,6 s contra 73 ms agora.
      const { data, error } = await (supabase as any).rpc("definir_dfc_classificacao", {
        _tenant_id: tenantId, _classificacao: classificacao,
        _dfc_codigo: codigo, _company_id: null,
      });
      if (error) throw error;
      const n = Number((data as any)?.contas_abrangidas ?? 0);
      toast.success(`${n.toLocaleString("pt-BR")} conta(s) abrangidas por este vínculo.`);
      invalidar();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const classificarConta = async (codigo: string, dfcCodigo: string) => {
    setBusy(codigo);
    try {
      const { error } = await supabase.from("plano_contas")
        .update({ dfc_codigo: dfcCodigo } as any)
        .eq("tenant_id", tenantId).is("company_id", null).eq("codigo", codigo);
      if (error) throw error;
      invalidar();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
      <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
    </div>;
  }

  const faltam = cobertura?.sem_codigo ?? 0;
  const opcoesDfc = catalogo ?? [];

  return (
    <div className="space-y-5">
      <Card className="p-4 text-sm bg-muted/30">
        <p className="text-muted-foreground text-xs leading-relaxed">
          A demonstração é montada pela <strong>hierarquia do plano</strong>, subtotais
          inclusive: as contas terminadas em <strong>.98</strong> e <strong>.99</strong> são as
          linhas de fecho da DRE, criadas pelo próprio sistema contábil. A única coisa que se
          configura aqui é como cada conta movimenta o <strong>caixa</strong> — e isso se faz
          pela conta sintética, não conta a conta.
        </p>
      </Card>

      <Card className={`p-4 ${faltam === 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {faltam === 0
              ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              : <AlertTriangle className="h-5 w-5 text-amber-600" />}
            <div>
              <div className="font-semibold text-sm">
                {faltam === 0
                  ? "DFC classificada por completo"
                  : `${faltam.toLocaleString("pt-BR")} conta(s) analíticas sem classificação de DFC`}
              </div>
              <div className="text-xs text-muted-foreground">
                de {(cobertura?.analiticas_balanco ?? 0).toLocaleString("pt-BR")} analíticas de
                Ativo e Passivo · plano com {(cobertura?.total_plano ?? 0).toLocaleString("pt-BR")} contas
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AlocarDfcButton tenantId={tenantId} onDone={invalidar} disabled={!podeEditar} />
            <PlanilhaDfcBotoes tenantId={tenantId} onDone={invalidar} disabled={!podeEditar}
              permitirImportar={podeEditar} />
            <CompletarEstruturaButton tenantId={tenantId} onDone={invalidar} disabled={!podeEditar} />
            <RevincularDfcButton tenantId={tenantId} onDone={invalidar} disabled={!podeEditar} />
          </div>
        </div>
      </Card>

      {(vinculos?.length ?? 0) > 0 && (
        <div>
          <h3 className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wider">
            Mapa em vigor ({vinculos!.length} vínculos por classificação)
          </h3>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground border-b">
                  <th className="px-3 py-1.5 font-medium">Classificação</th>
                  <th className="px-3 py-1.5 font-medium">Conta de referência</th>
                  <th className="px-3 py-1.5 font-medium">Código</th>
                  <th className="px-3 py-1.5 font-medium">Bloco</th>
                </tr>
              </thead>
              <tbody>
                {vinculos!.map((v) => {
                  const cat = opcoesDfc.find((c) => c.codigo === v.codigo_dfc);
                  const caixaDuvidoso = v.codigo_dfc === "C" &&
                    !/caixa|banco|equivalen|aplicac|movimento|vinculad/i.test(v.descricao);
                  return (
                    <tr key={v.classificacao} className={`border-t ${caixaDuvidoso ? "bg-amber-500/10" : ""}`}>
                      <td className="px-3 py-1.5 font-mono text-xs">{v.classificacao}</td>
                      <td className="px-3 py-1.5">
                        {v.descricao || "—"}
                        {caixaDuvidoso && (
                          <div className="text-[11px] text-amber-700">
                            Marcada como Caixa, mas o nome não é caixa/banco — distorce a variação de caixa.
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">{v.codigo_dfc}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{cat?.bloco ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {(sinteticas?.length ?? 0) > 0 && (
        <div>
          <h3 className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wider">
            Classificar pela conta sintética
          </h3>
          <Card className="p-4 mb-2 text-sm bg-muted/30">
            <p className="text-muted-foreground text-xs leading-relaxed">
              Cada linha aqui é uma sintética que ainda manda em analíticas sem classificação, e
              a coluna da direita diz <strong>quantas contas ela resolve de uma vez</strong>. A
              lista vem ordenada por isso: classificar as duas primeiras costuma cobrir quase
              todo o plano. Contas já classificadas não são alteradas.
            </p>
          </Card>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {(sinteticas ?? []).map((s) => (
                  <tr key={s.classificacao} className="border-t first:border-t-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{tituloConta(s.descricao)}</div>
                      <div className="text-xs text-muted-foreground font-mono">{s.classificacao}</div>
                    </td>
                    <td className="px-3 py-2 w-[150px] text-right">
                      <span className="text-sm font-semibold tabular-nums">
                        {Number(s.analiticas_sem_codigo).toLocaleString("pt-BR")}
                      </span>
                      <div className="text-[11px] text-muted-foreground">contas abaixo</div>
                    </td>
                    <td className="px-3 py-2 w-[280px]">
                      <Select
                        disabled={!podeEditar || busy === s.classificacao}
                        value={s.dfc_codigo ?? undefined}
                        onValueChange={(v) => classificarSintetica(s.classificacao, v)}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="Selecione o destino na DFC" />
                        </SelectTrigger>
                        <SelectContent>
                          <OpcoesDfcAgrupadas opcoes={opcoesDfc} />
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      <div>
        <h3 className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wider">
          Conta a conta ({semDfc?.length ?? 0}{(semDfc?.length ?? 0) >= 200 ? "+ mostrando 200" : ""})
        </h3>
        <div className="relative max-w-md mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar conta…"
            value={buscaDfc} onChange={(e) => setBuscaDfc(e.target.value)} />
        </div>
        {(semDfc?.length ?? 0) === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 mx-auto mb-2" />
            Nenhuma conta analítica de Ativo/Passivo pendente.
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {(semDfc ?? []).map((c) => (
                  <tr key={c.codigo} className="border-t first:border-t-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{tituloConta(c.descricao)}</div>
                      <div className="text-xs text-muted-foreground font-mono">{c.classificacao}</div>
                    </td>
                    <td className="px-3 py-2 w-[280px]">
                      <Select disabled={!podeEditar || busy === c.codigo}
                        onValueChange={(v) => classificarConta(c.codigo, v)}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          <OpcoesDfcAgrupadas opcoes={opcoesDfc} />
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      <div>
        <h3 className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wider">
          Subtotais que o plano declara ({acumuladores?.length ?? 0})
        </h3>
        {(acumuladores?.length ?? 0) === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Este plano não tem contas de apuração (.98/.99).
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {(acumuladores ?? []).map((a) => (
                  <tr key={a.classificacao} className="border-t first:border-t-0">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground w-[130px]">
                      {a.classificacao}
                    </td>
                    <td className="px-3 py-2 font-medium">{tituloConta(a.descricao)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground w-[220px]">
                      {a.tipo === "corrido" ? "acumula tudo que vem antes" : "fecha o próprio bloco"}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-muted-foreground w-[190px]">
                      {a.papel ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

// ============================================================
/**
 * Exportar e importar as alocações da DFC em Excel.
 *
 * O vínculo é por classificação — dezenas de linhas que alcançam as
 * 135.000 contas por prefixo. Isso é ótimo para configurar e ruim para
 * CONFERIR: na tela não dá para ver se cada conta caiu onde devia. A
 * planilha sai conta a conta, com a coluna que diz de ONDE cada uma
 * herdou o código, e volta como configuração.
 */
// Os códigos da DFC agrupados como na base de referência (aba "10. Fluxo
// de Caixa"): Bloco 1 / Bloco 2 / Bloco 3 e as contas de caixa à parte.
// É só a organização da lista — os códigos e o que cada um faz não mudam.
const BLOCOS_DFC: { chave: string; rotulo: string }[] = [
  { chave: "caixa", rotulo: "Caixa e Equivalentes" },
  { chave: "resultado", rotulo: "Bloco 1 — Atividades Operacionais" },
  { chave: "nao_caixa", rotulo: "Bloco 1 — Atividades Operacionais" },
  { chave: "operacional", rotulo: "Bloco 1 — Atividades Operacionais" },
  { chave: "investimento", rotulo: "Bloco 2 — Atividades de Investimento" },
  { chave: "financiamento", rotulo: "Bloco 3 — Atividades de Financiamento" },
];

function OpcoesDfcAgrupadas({
  opcoes,
}: {
  opcoes: { codigo: string; descricao: string; bloco: string; ordem: number }[];
}) {
  // Um rótulo por bloco, na ordem do leiaute; blocos vazios não aparecem.
  const vistos = new Set<string>();
  const grupos: { rotulo: string; itens: typeof opcoes }[] = [];
  for (const b of BLOCOS_DFC) {
    const itens = opcoes.filter((o) => o.bloco === b.chave);
    if (itens.length === 0) continue;
    const anterior = grupos[grupos.length - 1];
    if (anterior && anterior.rotulo === b.rotulo) anterior.itens.push(...itens);
    else grupos.push({ rotulo: b.rotulo, itens: [...itens] });
    vistos.add(b.chave);
  }
  const resto = opcoes.filter((o) => !vistos.has(o.bloco));
  if (resto.length > 0) grupos.push({ rotulo: "Outros", itens: resto });

  return (
    <>
      {grupos.map((g) => (
        <SelectGroup key={g.rotulo}>
          <SelectLabel>{g.rotulo}</SelectLabel>
          {g.itens.map((o) => (
            <SelectItem key={o.codigo} value={o.codigo}>
              {o.codigo} · {o.descricao}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  );
}

// ============================================================
/**
 * Alocar a DFC sozinho.
 *
 * `aplicar_dfc_padrao` já existia, mas grava `plano_contas.dfc_codigo` —
 * uma linha por conta, 135 mil UPDATEs, e é o caminho que o ajuste 15
 * aposentou (o vínculo por classificação ganha do código gravado na
 * conta). Este grava VÍNCULO por classificação: 71 linhas, e é o que a
 * leitura realmente usa. A herança resolve o resto.
 *
 * Nunca atropela o que foi decidido à mão — o padrão é ponto de partida,
 * não autoridade.
 */
function AlocarDfcButton({ tenantId, onDone, disabled }: {
  tenantId: string; onDone: () => void; disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const rodar = async () => {
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("dfc_alocar_automatico", {
        _tenant_id: tenantId, _company_id: null, _sobrescrever: false,
      });
      if (error) throw error;
      toast.success(
        `${data.vinculos_gravados} vínculo(s) de DFC gravado(s). ` +
        `${data.classificacoes_com_codigo} classificação(ões) com código, ` +
        `${data.classificacoes_sem_codigo} ainda sem. ` +
        "O que você definiu à mão não foi tocado.",
        { duration: 12000 },
      );
      onDone();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  return (
    <Button size="sm" disabled={busy || disabled} onClick={rodar}
      title="Cria os vínculos de DFC a partir do padrão, por classificação. Não sobrescreve o que foi definido à mão.">
      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            : <Sparkles className="h-4 w-4 mr-2" />}
      Alocar DFC automaticamente
    </Button>
  );
}

// ============================================================
/**
 * Cria os níveis que faltam na árvore do plano.
 *
 * O export do sistema contábil pula níveis: existe `3.17.01.01.01`
 * (CONTRIBUIÇÃO SOCIAL) mas não existe `3.17.01`. A demonstração é
 * desenhada num nível — se aquele nível não existe no ramo, as contas de
 * baixo não casam com linha nenhuma e somem. Foi por isso que IRPJ e
 * CSLL não apareciam na DRE.
 */
function CompletarEstruturaButton({ tenantId, onDone, disabled }: {
  tenantId: string; onDone: () => void; disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="outline" size="sm" disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        try {
          const { data, error } = await (supabase as any).rpc(
            "garantir_sinteticas_faltantes",
            { _tenant_id: tenantId, _company_id: null, _separador: "." },
          );
          if (error) throw error;
          const n = Number((data as any)?.sinteticas_criadas ?? 0);
          toast.success(
            n === 0
              ? "A árvore do plano já está completa."
              : `${n} conta(s) sintéticas criadas — os grupos que faltavam voltam a aparecer nas demonstrações.`,
          );
          onDone();
        } catch (e: any) { toast.error(e.message); }
        finally { setBusy(false); }
      }}>
      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
      Completar estrutura do plano
    </Button>
  );
}

// ============================================================
/**
 * Reaplica a planilha de DFC por cima de TUDO.
 *
 * `aplicar_dfc_padrao` só preenchia onde faltava, para não sobrescrever
 * ajuste manual. O efeito colateral: plano carregado antes da planilha
 * ficava com a classificação antiga (os 4 blocos deduzidos por
 * descrição) para sempre, e a DFC continuava mostrando a estrutura
 * velha. Este botão é o "reaplicar tudo".
 */
function RevincularDfcButton({ tenantId, onDone, disabled }: {
  tenantId: string; onDone: () => void; disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy || disabled}
      onClick={async () => {
        if (!confirm(
          "Reaplicar a planilha de DFC em todo o Plano Padrão?\n\n" +
          "A classificação atual de DFC é descartada e refeita a partir da planilha. " +
          "Contas marcadas manualmente voltam ao padrão."
        )) return;
        setBusy(true);
        try {
          const { data, error } = await (supabase as any).rpc("revincular_dfc", {
            _tenant_id: tenantId, _company_id: null, _todos_escopos: true,
          });
          if (error) throw error;
          const r = data as { vinculadas: number; sem_codigo: number; analiticas_balanco: number };
          toast.success(
            `${r.vinculadas} conta(s) vinculadas. ` +
            (r.sem_codigo === 0
              ? "Todas as analíticas de Ativo/Passivo classificadas."
              : `${r.sem_codigo} de ${r.analiticas_balanco} analíticas de balanço ainda sem código.`),
          );
          onDone();
        } catch (e: any) { toast.error(e.message); }
        finally { setBusy(false); }
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
      Reaplicar planilha de DFC
    </Button>
  );
}

// ============================================================
function DescartadasTab({ tenantId, podeEditar }: { tenantId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["contas-descartadas", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("plano_contas_descartadas")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const restaurar = async (codigo: string) => {
    try {
      const { error } = await (supabase as any).rpc("restaurar_conta_descartada", {
        _tenant_id: tenantId, _codigo: codigo,
      });
      if (error) throw error;
      toast.success(`${codigo} voltou para a fila.`);
      qc.invalidateQueries({ queryKey: ["contas-descartadas", tenantId] });
      qc.invalidateQueries({ queryKey: ["contas-novas", tenantId] });
      qc.invalidateQueries({ queryKey: ["plano-padrao-resumo", tenantId] });
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30">
          <tr>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Código</th>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Motivo</th>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Quando</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((d: any) => (
            <tr key={d.id} className="border-t">
              <td className="px-3 py-2 font-mono">{d.codigo}</td>
              <td className="px-3 py-2 text-muted-foreground">{d.motivo ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {new Date(d.created_at).toLocaleDateString("pt-BR")}
              </td>
              <td className="px-3 py-2 text-right">
                <Button size="sm" variant="ghost" disabled={!podeEditar}
                  onClick={() => restaurar(d.codigo)}>
                  <Undo2 className="h-3.5 w-3.5 mr-1" /> Restaurar
                </Button>
              </td>
            </tr>
          ))}
          {(data ?? []).length === 0 && (
            <tr><td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
              Nenhuma conta descartada.
            </td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

// ============================================================
// Caminho de migração para quem já tinha plano por empresa: copia as
// contas E as alocações já feitas. Não apaga nada da empresa.
function PromoverPlanoCard({ tenantId, podeEditar }: { tenantId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: empresas } = useQuery({
    queryKey: ["empresas-com-plano", tenantId],
    queryFn: async () => {
      const { data: cs, error } = await supabase
        .from("companies")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .order("name");
      if (error) throw error;
      const out: { id: string; name: string; contas: number }[] = [];
      for (const c of cs ?? []) {
        const { count } = await supabase
          .from("plano_contas")
          .select("id", { count: "exact", head: true })
          .eq("company_id", c.id);
        if ((count ?? 0) > 0) out.push({ id: c.id, name: c.name, contas: count ?? 0 });
      }
      return out;
    },
  });

  if ((empresas ?? []).length === 0) return null;

  const promover = async () => {
    if (!companyId) return;
    const emp = empresas!.find((e) => e.id === companyId);
    if (!confirm(`Copiar as ${emp?.contas} conta(s) de "${emp?.name}" para o Plano Padrão? O plano da empresa não é alterado.`)) return;
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("promover_plano_empresa", { _company_id: companyId });
      if (error) throw error;
      toast.success(`${(data as any).copiadas} conta(s) copiada(s) para o Plano Padrão.`);
      setCompanyId("");
      qc.invalidateQueries({ queryKey: ["plano-padrao-resumo", tenantId] });
      qc.invalidateQueries({ queryKey: ["plano-padrao-contas", tenantId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 max-w-2xl">
      <div className="text-sm font-medium mb-1">Promover o plano de uma empresa</div>
      <p className="text-xs text-muted-foreground mb-3">
        Se uma empresa já tem o plano montado, dá para copiá-lo para o Plano Padrão — junto com as
        alocações de DRE/Balanço/DFC já feitas. Contas que já existirem no Padrão são preservadas,
        e o plano da empresa continua intacto.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[240px]">
          <Label className="text-xs">Empresa de origem</Label>
          <Select value={companyId} onValueChange={setCompanyId} disabled={!podeEditar}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {(empresas ?? []).map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.name} ({e.contas} contas)</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={promover} disabled={busy || !podeEditar || !companyId} variant="outline">
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Copiar para o Plano Padrão
        </Button>
      </div>
    </Card>
  );
}
