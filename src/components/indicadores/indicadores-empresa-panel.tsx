// Painel principal da aba "6. Indicadores" na tela de dados da empresa.
// Substitui `indicadores-config-panel.tsx`.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Copy, Pencil, Trash2, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import { IndicadorEditorDialog } from "./indicador-editor-dialog";
import { DuplicarIndicadoresDialog } from "./duplicar-dialog";
import type { ContaPlanoItem } from "./conta-picker";
import {
  aplicarModo,
  calcularSerie,
  formatarValor,
  formulaParaTexto,
  type IndicadorEmpresa,
  type Visibilidade,
} from "@/lib/indicadores/engine";
import { useIndicadorData } from "@/hooks/use-indicador-data";
import { INDICADOR_DEFS } from "@/lib/indicadores/definicoes";
import { sugerirContasPorLabel } from "@/lib/indicadores/engine";

const VIS_OPTS: { value: Visibilidade; label: string }[] = [
  { value: "invisivel", label: "Invisível" },
  { value: "indicadores", label: "Indicadores" },
  { value: "dashboard", label: "Dashboard" },
  { value: "ambos", label: "Ambos" },
];

const MODO_LABEL: Record<string, string> = {
  numero: "nº",
  reais: "R$",
  percentual: "%",
  ah_percent: "AH%",
  ah_valor: "AH$",
};

export function IndicadoresEmpresaPanel({
  tenantId,
  companyId,
}: {
  tenantId: string;
  companyId: string;
}) {
  const qc = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<IndicadorEmpresa | null>(null);
  const [dupOpen, setDupOpen] = useState(false);

  const { data: plano } = useQuery({
    queryKey: ["indic-plano-empresa", tenantId, companyId],
    queryFn: async () => {
      // Filtra participantes no servidor: indicadores usam apenas contas
      // estruturais (~1.1k), nunca as ~134k subcontas de clientes/fornecedores.
      const { data, error } = await supabase
        .from("plano_contas")
        .select("classificacao, descricao, is_sintetica, is_participante, nivel")
        .eq("tenant_id", tenantId)
        .eq("is_participante", false)
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .order("classificacao")
        .range(0, 4999);
      if (error) throw error;
      return (data ?? []) as ContaPlanoItem[];
    },
  });

  const { data: indicadores, isLoading } = useQuery({
    queryKey: ["indicadores-empresa", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("indicadores_empresa" as any)
        .select("*")
        .eq("company_id", companyId)
        .order("categoria")
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as IndicadorEmpresa[];
    },
  });

  const { data: ctx } = useIndicadorData(tenantId, companyId);

  const planoClassSet = useMemo(
    () => new Set((plano ?? []).map((p) => p.classificacao)),
    [plano],
  );

  // Seed dos padrões quando a lista está vazia e há plano importado.
  useEffect(() => {
    if (!indicadores || !plano) return;
    if (indicadores.length > 0 || plano.length === 0) return;
    (async () => {
      const inserts = INDICADOR_DEFS.map((def, i) => {
        // Constrói uma expressão simples: (termo1) op (termo2) ...
        // Como não temos a expressão original, criamos uma fórmula "placeholder"
        // baseada nos rótulos, com contas sugeridas quando encontradas.
        const contasPorTermo = def.termos.map((t) => sugerirContasPorLabel(t.label, (plano as any)));
        const anyMissing = contasPorTermo.some((c) => c.length === 0);
        // fórmula: primeiro termo / segundo termo (fallback simples)
        // Melhor: um único termo somando todos, apenas para servir de esqueleto.
        const expressao = contasPorTermo.length >= 2
          ? [
              { tipo: "termo", contas: contasPorTermo[0], sinais: contasPorTermo[0].map(() => "+") } as const,
              { tipo: "operador", valor: "/" } as const,
              { tipo: "termo", contas: contasPorTermo[1], sinais: contasPorTermo[1].map(() => "+") } as const,
            ]
          : [
              { tipo: "termo", contas: contasPorTermo[0] ?? [], sinais: (contasPorTermo[0] ?? []).map(() => "+") } as const,
            ];
        return {
          tenant_id: tenantId,
          company_id: companyId,
          nome: def.label,
          categoria: def.categoria,
          descricao: def.formulaTexto,
          modo_analise: def.formato === "percent" ? "percentual" : def.formato === "money" ? "reais" : "numero",
          formula: { expressao },
          visibilidade: "invisivel",
          is_padrao: true,
          revisar_contas: anyMissing,
          ordem: i * 10,
        };
      });
      const { error } = await supabase.from("indicadores_empresa" as any).insert(inserts);
      if (!error) qc.invalidateQueries({ queryKey: ["indicadores-empresa", companyId] });
    })();
  }, [indicadores, plano, tenantId, companyId, qc]);

  const atualizarVis = async (id: string, vis: Visibilidade) => {
    const { error } = await supabase.from("indicadores_empresa" as any).update({ visibilidade: vis }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["indicadores-empresa", companyId] });
  };

  const excluir = async (ind: IndicadorEmpresa) => {
    if (!confirm(`Excluir "${ind.nome}"?`)) return;
    const { error } = await supabase.from("indicadores_empresa" as any).delete().eq("id", ind.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Excluído");
    qc.invalidateQueries({ queryKey: ["indicadores-empresa", companyId] });
  };

  const duplicar = async (ind: IndicadorEmpresa) => {
    const { error } = await supabase.from("indicadores_empresa" as any).insert({
      tenant_id: tenantId, company_id: companyId,
      nome: `${ind.nome} (cópia)`,
      categoria: ind.categoria,
      descricao: ind.descricao,
      modo_analise: ind.modo_analise,
      formula: ind.formula,
      faixas: ind.faixas,
      visibilidade: "invisivel",
      is_padrao: false,
      revisar_contas: false,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Duplicado");
    qc.invalidateQueries({ queryKey: ["indicadores-empresa", companyId] });
  };

  const abrirCriar = () => { setEditing(null); setEditorOpen(true); };
  const abrirEditar = (ind: IndicadorEmpresa) => { setEditing(ind); setEditorOpen(true); };

  const labelDaConta = (cls: string): string => {
    const p = plano?.find((x) => x.classificacao === cls);
    return p?.descricao ?? cls;
  };

  const periodos = useMemo(() => (ctx?.periodosDisponiveis ?? []).slice(-3), [ctx]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (!plano || plano.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Importe o plano de contas na aba <strong>1. Plano de Contas</strong> para configurar indicadores.
      </Card>
    );
  }

  // Agrupa por categoria
  const porCategoria = new Map<string, IndicadorEmpresa[]>();
  for (const ind of indicadores ?? []) {
    if (!porCategoria.has(ind.categoria)) porCategoria.set(ind.categoria, []);
    porCategoria.get(ind.categoria)!.push(ind);
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 border-blue-500/30 bg-blue-500/5">
        <div className="flex gap-2 text-sm">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            Crie e configure indicadores desta empresa. A fórmula é uma expressão livre de termos (contas), operadores e parênteses.
            Contas sintéticas expandem automaticamente para a soma das analíticas abaixo delas.
            A visibilidade controla o que o cliente vê.
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={abrirCriar}>
          <Plus className="h-4 w-4 mr-1" /> Criar Indicador
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDupOpen(true)}>
          <Copy className="h-4 w-4 mr-1" /> Duplicar Indicadores
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {(indicadores ?? []).length} indicador(es)
        </span>
      </div>

      {Array.from(porCategoria.entries()).map(([cat, items]) => (
        <div key={cat} className="space-y-2">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{cat}</h4>
          <div className="grid grid-cols-1 gap-2">
            {items.map((ind) => (
              <IndicadorCard
                key={ind.id}
                ind={ind}
                labelDaConta={labelDaConta}
                periodos={periodos}
                ctx={ctx}
                onVisChange={(v) => atualizarVis(ind.id, v)}
                onEditar={() => abrirEditar(ind)}
                onDuplicar={() => duplicar(ind)}
                onExcluir={() => excluir(ind)}
              />
            ))}
          </div>
        </div>
      ))}

      {(indicadores?.length ?? 0) === 0 && (
        <Card className="p-6 text-sm text-muted-foreground text-center">
          Nenhum indicador ainda. Crie um ou duplique de outra empresa.
        </Card>
      )}

      <IndicadorEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        tenantId={tenantId}
        companyId={companyId}
        plano={plano}
        indicador={editing}
        onSaved={() => qc.invalidateQueries({ queryKey: ["indicadores-empresa", companyId] })}
      />

      <DuplicarIndicadoresDialog
        open={dupOpen}
        onOpenChange={setDupOpen}
        tenantId={tenantId}
        companyId={companyId}
        planoClassificacoes={planoClassSet}
        onDone={() => qc.invalidateQueries({ queryKey: ["indicadores-empresa", companyId] })}
      />
    </div>
  );
}

// ------------------------------------------------------------
// Card por indicador (com prévia calculada)
// ------------------------------------------------------------

function IndicadorCard({
  ind, labelDaConta, periodos, ctx, onVisChange, onEditar, onDuplicar, onExcluir,
}: {
  ind: IndicadorEmpresa;
  labelDaConta: (cls: string) => string;
  periodos: string[];
  ctx: ReturnType<typeof useIndicadorData>["data"];
  onVisChange: (v: Visibilidade) => void;
  onEditar: () => void;
  onDuplicar: () => void;
  onExcluir: () => void;
}) {
  const previa = useMemo(() => {
    if (!ctx || periodos.length === 0) return [];
    const serie = calcularSerie(ind, periodos, ctx);
    return aplicarModo(serie, ind.modo_analise).serie;
  }, [ind, periodos, ctx]);

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h5 className="font-semibold text-sm">{ind.nome}</h5>
            <Badge variant="outline" className="text-[9px]">{MODO_LABEL[ind.modo_analise] ?? ind.modo_analise}</Badge>
            {ind.is_padrao && <Badge variant="secondary" className="text-[9px]">Padrão</Badge>}
            {ind.revisar_contas && (
              <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-700 dark:text-amber-400 gap-1">
                <AlertTriangle className="h-2.5 w-2.5" /> Revisar contas
              </Badge>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground font-mono truncate">
            {formulaParaTexto(ind.formula, labelDaConta) || "—"}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          <select
            value={ind.visibilidade}
            onChange={(e) => onVisChange(e.target.value as Visibilidade)}
            className="h-8 rounded border border-border bg-background px-2 text-xs"
          >
            {VIS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Button size="sm" variant="ghost" onClick={onEditar} title="Editar">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDuplicar} title="Duplicar">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onExcluir} title="Excluir" className="text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {previa.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border flex items-center gap-4 flex-wrap text-xs">
          <span className="text-muted-foreground">Prévia:</span>
          {previa.map((p) => (
            <div key={p.periodo} className="flex items-center gap-1.5">
              <span className="text-muted-foreground">{p.periodo.slice(0, 7)}:</span>
              <span className="font-mono font-medium">{formatarValor(p.valor, ind.modo_analise)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
