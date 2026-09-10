// PLANO PADRÃO — o coração do BI, gerenciado no nível do ESCRITÓRIO.
//
// Contas do plano + estrutura da DRE/Balanço + alocação da DFC.
// Atualização mensal, contas novas do diário e descartadas ficam na
// configuração da empresa.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PortalShell } from "@/components/portal-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, BookOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { ContasPlanoPadrao } from "@/components/plano/contas-plano-padrao";
import { DfcAlocacaoPanel, EstruturaDemonstracaoPanel } from "@/components/plano/estrutura-dfc-panel";

export const Route = createFileRoute("/admin/plano-padrao")({ component: Page });

function Page() {
  const { profile, role } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const podeEditar = role === "tenant_admin" || role === "orkestria_admin";

  const { data: resumo, isLoading } = useQuery({
    queryKey: ["plano-padrao-resumo", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("plano_padrao_resumo", { _tenant_id: tenantId! });
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
              como "Plano Padrão". A <strong>estrutura das demonstrações</strong> (o que é Receita
              Líquida, Lucro Bruto, Ativo Circulante…) e a <strong>DFC</strong> se editam aqui.
              Carga mensal do CSV, contas novas do diário e descartadas ficam na{" "}
              <Link to="/admin/empresas" className="underline">configuração da empresa</Link>.
              Empresas de outros sistemas usam de-para. O mapa de colunas do ERP fica em{" "}
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Metrica label="Contas no plano" valor={r.total ?? 0}
              sub={`${r.estruturais ?? 0} estruturais · ${r.participantes ?? 0} participantes`} />
            <Metrica label="Subtotais da DRE" valor={r.acumuladores ?? 0}
              alerta={(r.acumuladores ?? 0) === 0} sub="contas .98/.99 do plano" />
            <Metrica label="Sem flag de DFC" valor={r.sem_dfc ?? 0}
              alerta={(r.sem_dfc ?? 0) > 0} sub="analíticas de Ativo/Passivo" />
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
                    quebra). Na aba Contas, promova o plano de uma empresa existente, ou cadastre
                    as contas à mão.
                  </p>
                </div>
              </div>
            </Card>
          )}

          <Tabs defaultValue="contas">
            <TabsList>
              <TabsTrigger value="contas">Contas</TabsTrigger>
              <TabsTrigger value="estrutura">Estrutura</TabsTrigger>
              <TabsTrigger value="dfc">DFC</TabsTrigger>
            </TabsList>

            <TabsContent value="contas">
              <div className="space-y-4">
                <ContasPlanoPadrao tenantId={tenantId} podeEditar={podeEditar} />
                <PromoverPlanoCard tenantId={tenantId} podeEditar={podeEditar} />
              </div>
            </TabsContent>
            <TabsContent value="estrutura">
              <EstruturaDemonstracaoPanel tenantId={tenantId} podeEditar={podeEditar} />
            </TabsContent>
            <TabsContent value="dfc">
              <DfcAlocacaoPanel tenantId={tenantId} podeEditar={podeEditar} />
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
      const { data, error } = await supabase.rpc("promover_plano_empresa", { _company_id: companyId });
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
