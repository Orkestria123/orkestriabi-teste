import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Loader2, ChevronRight, Check, X, Info } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  INDICADOR_DEFS,
  isConfigurado,
  type Visibilidade,
  type IndicadorConfigRow,
  type IndicadorDef,
  type TermoDef,
} from "@/lib/indicadores/definicoes";
import {
  useMonthlyStatement,
} from "@/hooks/use-financial-data";
import { computeIndicadoresCompletos, formatIndicador, type FlatRow } from "@/lib/indicators";

interface PlanoRow {
  codigo: string;
  classificacao: string;
  descricao: string;
  tipo: string;
  natureza: string | null;
  nivel: number;
  is_sintetica: boolean | null;
  is_participante: boolean;
}

const VIS_OPTIONS: { value: Visibilidade; label: string; hint: string }[] = [
  { value: "indicadores", label: "Indicadores", hint: "Só na aba Indicadores do cliente" },
  { value: "dashboard", label: "Dashboard", hint: "Só no Dashboard do cliente" },
  { value: "ambos", label: "Ambos", hint: "Aparece nas duas telas" },
  { value: "invisivel", label: "Invisível", hint: "Configurado mas oculto para o cliente" },
];

export function IndicadoresConfigPanel({
  tenantId,
  companyId,
}: {
  tenantId: string;
  companyId: string;
}) {
  const qc = useQueryClient();

  const { data: plano, isLoading: loadPlano } = useQuery({
    queryKey: ["indic-plano", tenantId, companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plano_contas")
        .select("codigo, classificacao, descricao, tipo, natureza, nivel, is_sintetica, is_participante")
        .eq("tenant_id", tenantId)
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .order("classificacao")
        .range(0, 9999);
      if (error) throw error;
      return (data ?? []) as PlanoRow[];
    },
  });

  const { data: configs, isLoading: loadCfg } = useQuery({
    queryKey: ["indic-configs", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("indicador_config_empresa")
        .select("*")
        .eq("company_id", companyId);
      if (error) throw error;
      return (data ?? []) as IndicadorConfigRow[];
    },
  });

  // Seed inicial: cria registros faltantes para cada indicador padrão.
  useEffect(() => {
    if (!configs) return;
    const existentes = new Set(configs.map((c) => c.indicador_key));
    const faltantes = INDICADOR_DEFS.filter((d) => !existentes.has(d.key));
    if (faltantes.length === 0) return;
    (async () => {
      const { error } = await supabase.from("indicador_config_empresa").insert(
        faltantes.map((d, i) => ({
          tenant_id: tenantId,
          company_id: companyId,
          indicador_key: d.key,
          contas_por_termo: {},
          visibilidade: "indicadores",
          ordem: (configs.length + i) * 10,
        })),
      );
      if (!error) qc.invalidateQueries({ queryKey: ["indic-configs", companyId] });
    })();
  }, [configs, tenantId, companyId, qc]);

  const configByKey = useMemo(() => {
    const m = new Map<string, IndicadorConfigRow>();
    for (const c of configs ?? []) m.set(c.indicador_key, c);
    return m;
  }, [configs]);

  if (loadPlano || loadCfg) {
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

  return (
    <div className="space-y-4">
      <Card className="p-4 border-blue-500/30 bg-blue-500/5">
        <div className="flex gap-2 text-sm">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            Configure as contas do plano importado que compõem cada termo da fórmula.
            Alterações valem apenas para esta empresa. A visibilidade controla onde o cliente vê o indicador.
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3">
        {INDICADOR_DEFS.map((def) => (
          <IndicadorRow
            key={def.key}
            def={def}
            config={configByKey.get(def.key) ?? null}
            plano={plano}
            tenantId={tenantId}
            companyId={companyId}
            onSaved={() => qc.invalidateQueries({ queryKey: ["indic-configs", companyId] })}
          />
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Card por indicador
// ------------------------------------------------------------
function IndicadorRow({
  def, config, plano, tenantId, companyId, onSaved,
}: {
  def: IndicadorDef;
  config: IndicadorConfigRow | null;
  plano: PlanoRow[];
  tenantId: string;
  companyId: string;
  onSaved: () => void;
}) {
  const [contas, setContas] = useState<Record<string, string[]>>(config?.contas_por_termo ?? {});
  const [vis, setVis] = useState<Visibilidade>(config?.visibilidade ?? "indicadores");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setContas(config?.contas_por_termo ?? {});
    setVis(config?.visibilidade ?? "indicadores");
    setDirty(false);
  }, [config]);

  const configurado = isConfigurado(def, contas);

  const salvar = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("indicador_config_empresa")
        .update({ contas_por_termo: contas, visibilidade: vis })
        .eq("id", config.id);
      if (error) throw error;
      toast.success(`${def.label} salvo`);
      setDirty(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold">{def.label}</h4>
            <Badge variant="outline" className="text-[10px]">{def.categoria}</Badge>
            {!configurado && (
              <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-400">
                Não configurado
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 font-mono">{def.formulaTexto}</div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={vis}
            onChange={(e) => { setVis(e.target.value as Visibilidade); setDirty(true); }}
            className="h-8 rounded border border-border bg-background px-2 text-xs"
            title="Visibilidade para o cliente"
          >
            {VIS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <Button size="sm" onClick={salvar} disabled={!dirty || saving || !config}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Salvar"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {def.termos.map((termo) => (
          <TermoSelector
            key={termo.key}
            termo={termo}
            plano={plano}
            selecionadas={contas[termo.key] ?? []}
            onChange={(next) => {
              setContas((prev) => ({ ...prev, [termo.key]: next }));
              setDirty(true);
            }}
          />
        ))}
      </div>

      <PreviewIndicador
        companyId={companyId}
        indicadorKey={def.key}
        configurado={configurado}
      />
    </Card>
  );
}

// ------------------------------------------------------------
// Selector de contas (árvore por classificação)
// ------------------------------------------------------------
function TermoSelector({
  termo, plano, selecionadas, onChange,
}: {
  termo: TermoDef;
  plano: PlanoRow[];
  selecionadas: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");

  // Filtra plano por origem provável do termo (heurística por prefixo do
  // classificacao). Sem opinião forte — só ordena/limita.
  const filtered = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return plano
      .filter((p) => {
        if (p.is_participante) return false;
        if (!b) return true;
        return (
          p.classificacao.toLowerCase().includes(b) ||
          p.descricao.toLowerCase().includes(b)
        );
      })
      .slice(0, 500);
  }, [plano, busca]);

  const selSet = new Set(selecionadas);
  const toggle = (cls: string) => {
    if (selSet.has(cls)) {
      onChange(selecionadas.filter((c) => c !== cls));
    } else {
      onChange([...selecionadas, cls]);
    }
  };

  const remove = (cls: string) => onChange(selecionadas.filter((c) => c !== cls));

  const labelByCls = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of plano) m.set(p.classificacao, p.descricao);
    return m;
  }, [plano]);

  return (
    <div className="rounded-lg border border-border p-3 bg-muted/20">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs">
          <div className="font-medium">{termo.label}</div>
          <div className="text-muted-foreground">{termo.origem} · {termo.tipo}</div>
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 text-xs">
              <ChevronRight className="h-3 w-3 mr-1" /> Escolher
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[380px] p-0" align="end">
            <div className="p-2 border-b border-border">
              <Input
                placeholder="Buscar por classificação ou nome…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {filtered.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground text-center">Nenhuma conta.</div>
              )}
              {filtered.map((p) => {
                const sel = selSet.has(p.classificacao);
                return (
                  <button
                    key={p.classificacao}
                    onClick={() => toggle(p.classificacao)}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2",
                      sel && "bg-primary/5",
                    )}
                    style={{ paddingLeft: `${Math.min(p.nivel, 6) * 8 + 12}px` }}
                  >
                    <span className="w-4 flex-shrink-0">
                      {sel && <Check className="h-3 w-3 text-primary" />}
                    </span>
                    <span className="font-mono text-muted-foreground">{p.classificacao}</span>
                    <span className="truncate">{p.descricao}</span>
                    {p.is_sintetica && <Badge variant="outline" className="text-[9px] ml-auto">S</Badge>}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex flex-wrap gap-1 min-h-[24px]">
        {selecionadas.length === 0 && (
          <span className="text-xs text-muted-foreground italic">Nenhuma conta vinculada</span>
        )}
        {selecionadas.map((cls) => (
          <Badge key={cls} variant="secondary" className="text-[10px] gap-1">
            <span className="font-mono">{cls}</span>
            <span className="max-w-[120px] truncate">{labelByCls.get(cls) ?? ""}</span>
            <button onClick={() => remove(cls)} className="hover:text-destructive">
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Prévia do valor calculado (o que o cliente verá)
// ------------------------------------------------------------
function PreviewIndicador({
  companyId, indicadorKey, configurado,
}: {
  companyId: string;
  indicadorKey: string;
  configurado: boolean;
}) {
  // Carrega os períodos disponíveis mais recentes e calcula via engine atual.
  const { data: periodos } = useQuery({
    queryKey: ["periodos-preview", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saldos_mensais")
        .select("competencia")
        .eq("company_id", companyId)
        .order("competencia", { ascending: false })
        .limit(500);
      if (error) throw error;
      const set = new Set<string>((data ?? []).map((r: any) => r.competencia));
      return Array.from(set).sort();
    },
  });

  const ultimos = (periodos ?? []).slice(-3);
  const { data: dre } = useMonthlyStatement(companyId, "DRE", ultimos);
  const { data: bpA } = useMonthlyStatement(companyId, "BP_ATIVO", ultimos);
  const { data: bpP } = useMonthlyStatement(companyId, "BP_PASSIVO", ultimos);

  const preview = useMemo(() => {
    if (ultimos.length === 0) return null;
    const inds = computeIndicadoresCompletos(
      (dre ?? []) as FlatRow[],
      (bpA ?? []) as FlatRow[],
      (bpP ?? []) as FlatRow[],
      ultimos,
    );
    return inds.find((i) => i.key === indicadorKey) ?? null;
  }, [dre, bpA, bpP, ultimos, indicadorKey]);

  if (!periodos || periodos.length === 0) {
    return (
      <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
        Sem períodos disponíveis para prévia.
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <div className="flex items-center gap-4 flex-wrap text-xs">
        <span className="text-muted-foreground">Prévia (últimos períodos):</span>
        {preview?.serie.map((p) => (
          <div key={p.periodo} className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{p.periodo.slice(0, 7)}:</span>
            <span className="font-mono font-medium">
              {formatIndicador(p.valor, preview.formato)}
            </span>
          </div>
        ))}
        {!preview && <span className="text-muted-foreground italic">Sem dados.</span>}
      </div>
      {!configurado && (
        <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-500">
          Vincule contas para os termos acima. Enquanto não configurado, o indicador não é exibido ao cliente.
        </div>
      )}
    </div>
  );
}
