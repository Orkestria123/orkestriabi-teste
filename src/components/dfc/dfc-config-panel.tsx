// Configuração da DFC (CPC 03) — Etapa 1: estrutura pré-montada + vínculo de contas.
// Não calcula nada; apenas persiste dfc_config e dfc_linha_contas.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Info, X, Wallet, Sparkles, AlertTriangle, Copy } from "lucide-react";
import { toast } from "sonner";
import { ContaPicker, type ContaPlanoItem } from "@/components/indicadores/conta-picker";
import { ReplicarDfcDialog } from "@/components/dfc/replicar-dfc-dialog";
import { cn } from "@/lib/utils";

import {
  DFC_LINHAS,
  BLOCO_LABEL,
  OPERACAO_OPCOES,
  CAIXA_SUGESTAO,
  sugerirContas,
  type DfcLinhaDef,
  type DfcOperacao,
} from "@/lib/dfc/estrutura";

interface ConfigRow {
  id: string;
  metodo_padrao: string;
  conta_caixa: string[] | null;
}
interface LinhaRow {
  id: string;
  metodo: string;
  linha: string;
  contas: string[] | null;
  operacao: DfcOperacao;
  ordem: number;
}

export function DfcConfigPanel({ tenantId, companyId }: { tenantId: string; companyId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [replicarOpen, setReplicarOpen] = useState(false);


  const { data: plano } = useQuery({
    queryKey: ["dfc-plano", companyId],
    queryFn: async () => {
      const acc: ContaPlanoItem[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("plano_contas")
          .select("codigo, classificacao, descricao, is_sintetica, is_participante")
          .eq("company_id", companyId)
          // Só contas ESTRUTURAIS: exclui participantes (clientes/fornecedores),
          // que são ~134k linhas e travavam o seletor.
          .eq("is_participante", false)
          .order("classificacao")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as any[];
        for (const r of rows) {
          acc.push({
            codigo: r.codigo ?? null,
            classificacao: r.classificacao,
            descricao: r.descricao ?? "",
            is_sintetica: r.is_sintetica,
            is_participante: r.is_participante,
            nivel: String(r.classificacao ?? "").split(".").length,
          });
        }
        if (rows.length < PAGE) break;
        if (from > 40000) break;
      }
      return acc;
    },
  });

  const { data: config, isLoading: loadingCfg } = useQuery({
    queryKey: ["dfc-config", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dfc_config" as any)
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as ConfigRow | null;
    },
  });

  const { data: linhas, isLoading: loadingLinhas } = useQuery({
    queryKey: ["dfc-linhas", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dfc_linha_contas" as any)
        .select("*")
        .eq("company_id", companyId);
      if (error) throw error;
      return (data ?? []) as unknown as LinhaRow[];
    },
  });

  const byKey = useMemo(() => {
    const m = new Map<string, LinhaRow>();
    for (const l of linhas ?? []) m.set(`${l.metodo}::${l.linha}`, l);
    return m;
  }, [linhas]);

  const planoList = plano ?? [];
  const planoSet = useMemo(() => new Set(planoList.map((p) => p.classificacao)), [plano]);


  const salvarConfig = async (patch: Partial<ConfigRow>) => {
    setBusy("config");
    try {
      const payload = {
        tenant_id: tenantId,
        company_id: companyId,
        metodo_padrao: patch.metodo_padrao ?? config?.metodo_padrao ?? "indireto",
        conta_caixa: patch.conta_caixa ?? config?.conta_caixa ?? [],
      };
      const { error } = await supabase
        .from("dfc_config" as any)
        .upsert(payload as any, { onConflict: "company_id" });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["dfc-config", companyId] });
    } catch (e: any) {
      toast.error("Erro ao salvar", { description: e.message });
    } finally {
      setBusy(null);
    }
  };

  const salvarLinha = async (
    def: DfcLinhaDef,
    patch: { contas?: string[]; operacao?: DfcOperacao },
  ) => {
    const key = `${def.metodo}::${def.key}`;
    setBusy(key);
    try {
      const atual = byKey.get(key);
      const payload = {
        tenant_id: tenantId,
        company_id: companyId,
        metodo: def.metodo,
        linha: def.key,
        contas: patch.contas ?? atual?.contas ?? [],
        operacao: patch.operacao ?? atual?.operacao ?? def.operacaoPadrao,
        ordem: def.ordem,
      };
      const { error } = await supabase
        .from("dfc_linha_contas" as any)
        .upsert(payload as any, { onConflict: "company_id,metodo,linha" });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["dfc-linhas", companyId] });
    } catch (e: any) {
      toast.error("Erro ao salvar linha", { description: e.message });
    } finally {
      setBusy(null);
    }
  };

  if (loadingCfg || loadingLinhas) {
    return (
      <Card className="p-8 flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando configuração da DFC…
      </Card>
    );
  }

  const metodo = config?.metodo_padrao ?? "indireto";
  const contasCaixa = (config?.conta_caixa as string[] | null) ?? [];
  const sugestaoCaixa = sugerirContas(planoList, CAIXA_SUGESTAO, ["1"]);

  const renderBloco = (bloco: DfcLinhaDef["bloco"], met: "direto" | "indireto" | "ambos") => {
    const defs = DFC_LINHAS.filter((d) => d.bloco === bloco && d.metodo === met).sort(
      (a, b) => a.ordem - b.ordem,
    );
    if (defs.length === 0) return null;
    return (
      <Card key={`${bloco}-${met}`} className="p-4">
        <h4 className="text-sm font-semibold mb-3">{BLOCO_LABEL[bloco]}</h4>
        <div className="divide-y divide-border/60">
          {defs.map((def) => (
            <LinhaConfig
              key={def.key}
              def={def}
              row={byKey.get(`${def.metodo}::${def.key}`) ?? null}
              plano={planoList}
              busy={busy === `${def.metodo}::${def.key}`}
              onSave={(patch) => salvarLinha(def, patch)}
            />
          ))}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">
            A estrutura da DFC é definida pelo CPC 03 e não pode ser alterada. Aqui você indica
            <strong> quais contas alimentam cada linha</strong> e como elas entram (soma, subtrai ou
            variação de saldo). Linhas de subtotal são calculadas automaticamente.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0 gap-1"
            onClick={() => setReplicarOpen(true)}
          >
            <Copy className="h-3.5 w-3.5" /> Replicar de outra empresa
          </Button>
        </div>
      </Card>

      <ReplicarDfcDialog
        open={replicarOpen}
        onOpenChange={setReplicarOpen}
        tenantId={tenantId}
        companyId={companyId}
        planoClassificacoes={planoSet}
        onDone={async () => {
          await qc.invalidateQueries({ queryKey: ["dfc-linhas", companyId] });
          await qc.invalidateQueries({ queryKey: ["dfc-config", companyId] });
        }}
      />


      {/* Método padrão + contas de caixa */}
      <Card className="p-4 space-y-4">
        <div>
          <div className="text-sm font-medium mb-1">Método padrão da DFC</div>
          <div className="flex gap-2">
            {(["indireto", "direto"] as const).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={metodo === m ? "default" : "outline"}
                disabled={busy === "config"}
                onClick={() => salvarConfig({ metodo_padrao: m })}
                className="h-7 text-xs capitalize"
              >
                {m}
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Define qual método é exibido por padrão ao cliente. Ambos podem ser configurados.
          </p>
        </div>

        <div className="border-t border-border/60 pt-3">
          <div className="text-sm font-medium mb-1 flex items-center gap-1.5">
            <Wallet className="h-3.5 w-3.5" /> Contas de Caixa / Disponível
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">
            Usadas para o caixa no início e no fim do período (devem bater com o Disponível do
            Balanço).
          </p>
          <ListaContas
            contas={contasCaixa}
            plano={planoList}
            busy={busy === "config"}
            onChange={(next) => salvarConfig({ conta_caixa: next })}
            sugestao={sugestaoCaixa}
          />
        </div>
      </Card>

      <Tabs defaultValue={metodo === "direto" ? "direto" : "indireto"}>
        <TabsList>
          <TabsTrigger value="indireto">Método Indireto</TabsTrigger>
          <TabsTrigger value="direto">Método Direto</TabsTrigger>
          <TabsTrigger value="comuns">Investimento / Financiamento</TabsTrigger>
        </TabsList>

        <TabsContent value="indireto" className="space-y-4 mt-4">
          {renderBloco("operacional", "indireto")}
        </TabsContent>

        <TabsContent value="direto" className="space-y-4 mt-4">
          {renderBloco("operacional", "direto")}
        </TabsContent>

        <TabsContent value="comuns" className="space-y-4 mt-4">
          {renderBloco("investimento", "ambos")}
          {renderBloco("financiamento", "ambos")}
          {renderBloco("fechamento", "ambos")}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LinhaConfig({
  def,
  row,
  plano,
  busy,
  onSave,
}: {
  def: DfcLinhaDef;
  row: LinhaRow | null;
  plano: ContaPlanoItem[];
  busy: boolean;
  onSave: (patch: { contas?: string[]; operacao?: DfcOperacao }) => void;
}) {
  const contas = (row?.contas as string[] | null) ?? [];
  const operacao = (row?.operacao as DfcOperacao) ?? def.operacaoPadrao;
  const sugestao = useMemo(
    () => (contas.length > 0 ? [] : sugerirContas(plano, def.sugestao, def.sugestaoPrefixos)),
    [plano, def, contas.length],
  );
  const revisar = useMemo(() => {
    if (contas.length === 0 || plano.length === 0) return false;
    const set = new Set(plano.map((p) => p.classificacao));
    return contas.some((c) => !set.has(c));
  }, [contas, plano]);


  if (def.calculada || def.origemDRE) {
    return (
      <div className="py-2.5 flex items-center gap-2">
        <span className={cn("text-sm", def.calculada && "font-semibold")}>{def.label}</span>
        <Badge variant="outline" className="text-[10px]">
          {def.origemDRE ? "Vem da DRE" : "Calculada"}
        </Badge>
        {def.descricao && (
          <span className="text-[11px] text-muted-foreground truncate">{def.descricao}</span>
        )}
      </div>
    );
  }

  return (
    <div className="py-3">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-sm font-medium">{def.label}</span>
        {revisar && (
          <Badge variant="outline" className="text-[10px] border-amber-500/60 gap-1">
            <AlertTriangle className="h-3 w-3 text-amber-600" /> Revisar contas
          </Badge>
        )}
        {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}

        <div className="ml-auto flex items-center gap-1">
          {OPERACAO_OPCOES.map((o) => (
            <Button
              key={o.value}
              size="sm"
              variant={operacao === o.value ? "secondary" : "ghost"}
              className="h-6 px-2 text-[11px]"
              title={o.hint}
              disabled={busy}
              onClick={() => onSave({ operacao: o.value })}
            >
              {o.label}
            </Button>
          ))}
        </div>
      </div>
      <ListaContas
        contas={contas}
        plano={plano}
        busy={busy}
        onChange={(next) => onSave({ contas: next })}
        sugestao={sugestao}
      />
    </div>
  );
}

function ListaContas({
  contas,
  plano,
  busy,
  onChange,
  sugestao,
}: {
  contas: string[];
  plano: ContaPlanoItem[];
  busy: boolean;
  onChange: (next: string[]) => void;
  sugestao: string[];
}) {
  const byClass = useMemo(() => {
    const m = new Map<string, ContaPlanoItem>();
    for (const p of plano) m.set(p.classificacao, p);
    return m;
  }, [plano]);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {contas.length === 0 && sugestao.length === 0 && (
          <span className="text-[11px] text-muted-foreground">Nenhuma conta vinculada.</span>
        )}
        {contas.map((c) => {
          const info = byClass.get(c);
          return (
            <Badge key={c} variant="secondary" className="text-[11px] gap-1 pr-1">
              <span className="font-mono">{c}</span>
              {info?.codigo && info.codigo !== c && (
                <span className="font-mono text-[10px] text-muted-foreground">[{info.codigo}]</span>
              )}
              {info?.descricao && <span className="truncate max-w-[220px]">{info.descricao}</span>}
              <button
                type="button"
                disabled={busy}
                onClick={() => onChange(contas.filter((x) => x !== c))}
                className="hover:bg-background/50 rounded p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}
      </div>

      {contas.length === 0 && sugestao.length > 0 && (
        <div className="rounded-md border border-blue-500/40 bg-blue-500/5 p-2">
          <div className="text-[11px] font-medium flex items-center gap-1 mb-1 text-blue-700 dark:text-blue-400">
            <Sparkles className="h-3 w-3" /> Sugestão automática — confira antes de aplicar
          </div>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {sugestao.map((c) => (
              <Badge key={c} variant="outline" className="text-[11px] border-blue-500/50">
                <span className="font-mono">{c}</span>
                <span className="ml-1 truncate max-w-[200px]">
                  {byClass.get(c)?.descricao ?? ""}
                </span>
              </Badge>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px]"
            disabled={busy}
            onClick={() => onChange(sugestao)}
          >
            Aplicar sugestão
          </Button>
        </div>
      )}

      <ContaPicker
        plano={plano}
        selecionadas={contas}
        onChange={onChange}
        allowAnaliticas
        buttonLabel="Vincular contas"
      />
    </div>
  );
}
