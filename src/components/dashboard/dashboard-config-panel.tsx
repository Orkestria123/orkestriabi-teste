import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, ArrowUp, ArrowDown, Info, LayoutDashboard, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { ContaPicker, type ContaPlanoItem } from "@/components/indicadores/conta-picker";

// ------------------------------------------------------------
// Catálogo de blocos padrão da Visão Geral (dashboard do cliente)
// ------------------------------------------------------------
type Categoria = "kpi" | "grafico";
interface BlocoDef {
  key: string;
  label: string;
  descricao: string;
  categoria: Categoria;
  suportaBaseComparacao: boolean;
}

export const BLOCOS_CATALOGO: BlocoDef[] = [
  { key: "kpi_receita_liquida", label: "KPI — Receita Líquida", descricao: "Valor do período com comparação.", categoria: "kpi", suportaBaseComparacao: true },
  { key: "kpi_ebitda", label: "KPI — EBITDA", descricao: "EBIT + Depreciação e Amortização (contas do resultado).", categoria: "kpi", suportaBaseComparacao: true },
  { key: "kpi_lucro_liquido", label: "KPI — Lucro Líquido", descricao: "Lucro líquido do período com comparação. Cor indica superávit/déficit.", categoria: "kpi", suportaBaseComparacao: true },
  { key: "grafico_tendencia", label: "Gráfico — Tendência do Resultado", descricao: "Evolução de Receita Líquida, EBITDA e Lucro Líquido.", categoria: "grafico", suportaBaseComparacao: false },
  { key: "grafico_receita_despesa", label: "Gráfico — Receita × Despesa", descricao: "Comparativo de receitas e despesas por período.", categoria: "grafico", suportaBaseComparacao: false },
];

export const BASE_COMPARACAO_OPCOES: { value: string; label: string }[] = [
  { value: "mes_anterior", label: "Mês anterior" },
  { value: "ano_anterior", label: "Mesmo mês do ano anterior" },
  { value: "orcado", label: "Orçado" },
];

interface DashboardConfigRow {
  id: string;
  tenant_id: string;
  company_id: string;
  bloco: string;
  visivel: boolean;
  ordem: number;
  config: Record<string, any> | null;
}

interface IndicadorRow {
  id: string;
  nome: string;
  categoria: string | null;
  visibilidade: "invisivel" | "indicadores" | "dashboard" | "ambos";
}

export function DashboardConfigPanel({
  tenantId,
  companyId,
}: {
  tenantId: string;
  companyId: string;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["dashboard-config", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dashboard_config" as any)
        .select("*")
        .eq("company_id", companyId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as unknown as DashboardConfigRow[];
    },
  });

  // Seed inicial dos blocos faltantes
  useEffect(() => {
    if (!rows) return;
    const existentes = new Set(rows.map((r) => r.bloco));
    const faltantes = BLOCOS_CATALOGO.filter((b) => !existentes.has(b.key));
    if (faltantes.length === 0) return;
    (async () => {
      const baseOrdem = rows.length;
      const inserts = faltantes.map((b, i) => ({
        tenant_id: tenantId,
        company_id: companyId,
        bloco: b.key,
        visivel: true,
        ordem: (baseOrdem + BLOCOS_CATALOGO.findIndex((x) => x.key === b.key)) * 10,
        config: b.suportaBaseComparacao ? { base_comparacao: "mes_anterior" } : {},
      }));
      const { error } = await supabase.from("dashboard_config" as any).insert(inserts as any);
      if (!error) qc.invalidateQueries({ queryKey: ["dashboard-config", companyId] });
    })();
  }, [rows, tenantId, companyId, qc]);

  const byKey = useMemo(() => {
    const m = new Map<string, DashboardConfigRow>();
    for (const r of rows ?? []) m.set(r.bloco, r);
    return m;
  }, [rows]);

  const ordenados = useMemo(() => {
    // Ordena por row.ordem; blocos ainda não salvos aparecem por catálogo
    return BLOCOS_CATALOGO
      .map((b) => ({ def: b, row: byKey.get(b.key) ?? null }))
      .sort((a, b) => {
        const oa = a.row?.ordem ?? 9999;
        const ob = b.row?.ordem ?? 9999;
        if (oa !== ob) return oa - ob;
        return a.def.label.localeCompare(b.def.label);
      });
  }, [byKey]);

  const atualizar = async (row: DashboardConfigRow, patch: Partial<DashboardConfigRow>) => {
    setSaving(row.bloco);
    try {
      const { error } = await supabase
        .from("dashboard_config" as any)
        .update(patch as any)
        .eq("id", row.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["dashboard-config", companyId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(null);
    }
  };

  const mover = async (index: number, delta: -1 | 1) => {
    const alvo = ordenados[index];
    const vizinho = ordenados[index + delta];
    if (!alvo?.row || !vizinho?.row) return;
    const oa = alvo.row.ordem;
    const ov = vizinho.row.ordem;
    // troca ordens
    setSaving(alvo.def.key);
    try {
      const { error: e1 } = await supabase.from("dashboard_config" as any).update({ ordem: ov } as any).eq("id", alvo.row.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("dashboard_config" as any).update({ ordem: oa } as any).eq("id", vizinho.row.id);
      if (e2) throw e2;
      qc.invalidateQueries({ queryKey: ["dashboard-config", companyId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(null);
    }
  };

  // Indicadores marcados como Dashboard/Ambos (informativo)
  const { data: indicadores } = useQuery({
    queryKey: ["dashboard-indicadores-info", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("indicadores_empresa" as any)
        .select("id, nome, categoria, visibilidade")
        .eq("company_id", companyId)
        .in("visibilidade", ["dashboard", "ambos"])
        .order("categoria")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as IndicadorRow[];
    },
  });

  // Plano de contas do resultado (grupo 3) para o picker de Depreciação/Amortização do EBITDA
  const { data: planoResultado } = useQuery({
    queryKey: ["dashboard-config-plano-resultado", companyId],
    queryFn: async () => {
      const acc: ContaPlanoItem[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("plano_contas")
          .select("codigo, classificacao, descricao, is_sintetica, is_participante")
          .eq("company_id", companyId)
          .like("classificacao", "3%")
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
        if (from > 20000) break; // salvaguarda
      }
      return acc;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 border-blue-500/30 bg-blue-500/5">
        <div className="flex gap-2 text-sm">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            Configure quais blocos aparecem na <strong>Visão Geral</strong> do cliente. Você pode ligar/desligar, reordenar e
            escolher a <strong>base de comparação</strong> dos KPIs. Os indicadores marcados como
            "Dashboard" ou "Ambos" na aba <strong>6. Indicadores</strong> também aparecem na Visão Geral.
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4" />
          <h3 className="font-semibold text-sm">Blocos padrão</h3>
        </div>
        <div className="divide-y divide-border">
          {ordenados.map(({ def, row }, i) => {
            if (!row) {
              return (
                <div key={def.key} className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Preparando "{def.label}"…
                </div>
              );
            }
            const base = (row.config as any)?.base_comparacao ?? "mes_anterior";
            const busy = saving === def.key;
            return (
              <div key={def.key} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="flex flex-col gap-1">
                  <Button size="icon" variant="ghost" className="h-6 w-6" disabled={i === 0 || busy} onClick={() => mover(i, -1)}>
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" disabled={i === ordenados.length - 1 || busy} onClick={() => mover(i, 1)}>
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{def.label}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{def.categoria}</Badge>
                    {!row.visivel && (
                      <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-400">
                        Oculto
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{def.descricao}</div>
                </div>
                {def.suportaBaseComparacao && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Comparar com:</span>
                    <select
                      value={base}
                      disabled={busy}
                      onChange={(e) =>
                        atualizar(row, {
                          config: { ...(row.config ?? {}), base_comparacao: e.target.value },
                        })
                      }
                      className="h-8 rounded border border-border bg-background px-2 text-xs"
                    >
                      {BASE_COMPARACAO_OPCOES.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Visível</span>
                  <Switch
                    checked={row.visivel}
                    disabled={busy}
                    onCheckedChange={(v) => atualizar(row, { visivel: v })}
                  />
                </div>
                {def.key === "kpi_ebitda" && (
                  <EbitdaConfig
                    row={row}
                    plano={planoResultado ?? []}
                    busy={busy}
                    onPatch={(patch) =>
                      atualizar(row, {
                        config: { ...(row.config ?? {}), ...patch },
                      })
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Indicadores exibidos na Visão Geral</h3>
          <div className="text-xs text-muted-foreground">
            Vindos da aba <strong>6. Indicadores</strong> (visibilidade "Dashboard" ou "Ambos"). Para alterar, edite lá.
          </div>
        </div>
        <div className="p-4">
          {(indicadores ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground italic">
              Nenhum indicador marcado para o Dashboard.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(indicadores ?? []).map((ind) => (
                <Badge key={ind.id} variant="secondary" className="text-xs gap-1">
                  <span>{ind.nome}</span>
                  {ind.categoria && (
                    <span className="text-muted-foreground">· {ind.categoria}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    ({ind.visibilidade === "ambos" ? "Ambos" : "Dashboard"})
                  </span>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/**
 * Sugere classificações de Depreciação/Amortização/Exaustão a partir do plano
 * do grupo 3 (resultado). Regra: contas cujo nome contém "deprecia", "amortiza"
 * ou "exaust" (sem acento). Prioriza sintéticas quando existirem; caso não haja
 * sintética, inclui a própria analítica.
 * Exportado para reuso na renderização dos KPIs (fallback antes da confirmação).
 */
export function computeDepAmortSuggestion(plano: ContaPlanoItem[]): string[] {
  const rx = /deprecia|amortiza|exaust/;
  const norm = (s: string) =>
    (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const matches = plano.filter((p) => rx.test(norm(p.descricao)));
  if (matches.length === 0) return [];
  const sinteticas = matches.filter((p) => p.is_sintetica);
  const base = sinteticas.length > 0 ? sinteticas : matches;
  // remove duplicatas por classificação, mantém apenas classificações "raiz"
  // dentro do próprio conjunto (se 3.02.03 e 3.02.03.001 batem, mantém a mais alta)
  const sorted = base
    .map((p) => p.classificacao)
    .sort((a, b) => a.split(".").length - b.split(".").length);
  const roots: string[] = [];
  for (const c of sorted) {
    if (roots.some((r) => c === r || c.startsWith(r + "."))) continue;
    roots.push(c);
  }
  return roots;
}

function EbitdaConfig({
  row,
  plano,
  busy,
  onPatch,
}: {
  row: DashboardConfigRow;
  plano: ContaPlanoItem[];
  busy: boolean;
  onPatch: (patch: Record<string, any>) => void;
}) {
  const cfg = (row.config as any) ?? {};
  const configuradas = (cfg.contas_depreciacao as string[] | undefined) ?? [];
  const confirmado = cfg.contas_depreciacao_confirmado === true;
  const sugeridas = useMemo(() => computeDepAmortSuggestion(plano), [plano]);

  // Se ainda não confirmou e não há seleção, apresenta a sugestão pré-marcada.
  const usandoSugestao = !confirmado && configuradas.length === 0 && sugeridas.length > 0;
  const contasExibidas = usandoSugestao ? sugeridas : configuradas;

  const byClass = useMemo(() => {
    const m = new Map<string, ContaPlanoItem>();
    for (const p of plano) m.set(p.classificacao, p);
    return m;
  }, [plano]);

  const salvar = (contas: string[]) =>
    onPatch({ contas_depreciacao: contas, contas_depreciacao_confirmado: true });

  const removerDaLista = (c: string) => {
    // Se o contador remove uma sugestão sem ter confirmado ainda, materializamos
    // a lista atual (sem essa conta) como escolha explícita.
    const base = usandoSugestao ? sugeridas : configuradas;
    salvar(base.filter((x) => x !== c));
  };

  return (
    <div className="w-full mt-2 pl-9 border-t border-border/50 pt-2">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium mb-1 flex items-center gap-1.5 flex-wrap">
            Depreciação / Amortização
            {usandoSugestao && (
              <Badge variant="outline" className="text-[10px] border-blue-500/50 text-blue-700 dark:text-blue-400 gap-1">
                <AlertTriangle className="h-3 w-3" /> Sugestão automática — confira e confirme
              </Badge>
            )}
            {!confirmado && !usandoSugestao && configuradas.length === 0 && (
              <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-400 gap-1">
                <AlertTriangle className="h-3 w-3" /> Não configurado — EBITDA = EBIT
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">
            O EBITDA soma de volta a depreciação e amortização ao resultado operacional.
            {usandoSugestao
              ? " Pré-selecionamos as contas do grupo de resultado cujo nome contém \"depreciação\", \"amortização\" ou \"exaustão\". Confira se todas são realmente depreciação/amortização e se nenhuma ficou de fora — a sugestão é ponto de partida, a decisão final é sua."
              : " Selecione as contas de depreciação/amortização da empresa. Contas mal cadastradas (ex.: uma conta \"Depreciação\" que recebe outros lançamentos) não devem ser incluídas."}
          </p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {contasExibidas.map((c) => {
              const info = byClass.get(c);
              return (
                <Badge
                  key={c}
                  variant={usandoSugestao ? "outline" : "secondary"}
                  className={cn(
                    "text-[11px] gap-1 pr-1",
                    usandoSugestao && "border-blue-500/50 bg-blue-500/5",
                  )}
                >
                  <span className="font-mono">{c}</span>
                  {info?.descricao && <span className="truncate max-w-[220px]">{info.descricao}</span>}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removerDaLista(c)}
                    className="hover:bg-background/50 rounded p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
            {contasExibidas.length === 0 && (
              <span className="text-[11px] text-muted-foreground italic">Nenhuma conta selecionada.</span>
            )}
          </div>
          {usandoSugestao && (
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => salvar(sugeridas)}
            >
              Confirmar sugestão ({sugeridas.length} contas)
            </Button>
          )}
        </div>
        <ContaPicker
          plano={plano}
          selecionadas={contasExibidas}
          onChange={salvar}
          buttonLabel="Adicionar / remover contas"
          allowAnaliticas
        />
      </div>
    </div>
  );
}
