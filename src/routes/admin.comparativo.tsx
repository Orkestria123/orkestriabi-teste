import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/portal-shell";
import { useQueries, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useVisaoGerencial } from "@/hooks/use-visao-gerencial";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, GitCompareArrows, Loader2, SlidersHorizontal } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE, CHART_COLORS, ANIMATION } from "@/lib/chart-config";
import { cn } from "@/lib/utils";
import {
  INDICES_COMPARAVEIS,
  ORDEM_GRUPOS,
  calcularIndicesEmpresa,
  formatarComparavel,
  periodosDaEmpresa,
  type DefComparavel,
  type EmpresaComparada,
} from "@/lib/comparativo/indices-empresa";

export const Route = createFileRoute("/admin/comparativo")({ component: Page });

const PORTES = ["MEI", "Micro", "Pequena", "Média", "Grande"];
const PADRAO_VISIVEIS = ["margBruta", "margEbitda", "margLiq", "lc", "ls", "endivPL", "roe"];

interface Empresa {
  id: string;
  name: string;
  razao_social: string | null;
  cnpj: string | null;
  segmento_id: string | null;
  grupo_id: string | null;
  porte: string | null;
}

function Page() {
  const { profile, isCliente } = useAuth();
  const { visao } = useVisaoGerencial();
  const visaoCalc: "contabil" | "gerencial" = visao === "gerencial" ? "gerencial" : "contabil";
  const tenantId = profile?.tenant_id ?? undefined;

  const { data: companies } = useQuery({
    queryKey: ["comparativo-companies"],
    enabled: !isCliente,
    queryFn: async (): Promise<Empresa[]> => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, razao_social, cnpj, segmento_id, grupo_id, porte")
        .eq("ativo", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Empresa[];
    },
  });

  const { data: segmentos } = useQuery({
    queryKey: ["comparativo-segmentos"],
    enabled: !isCliente,
    queryFn: async () => {
      const { data, error } = await supabase.from("segmentos").select("id, nome").order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: grupos } = useQuery({
    queryKey: ["comparativo-grupos"],
    enabled: !isCliente,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grupos_economicos").select("id, nome").order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [grupo, setGrupo] = useState("todos");
  const [segmento, setSegmento] = useState("todos");
  const [porte, setPorte] = useState("todos");
  const [selected, setSelected] = useState<string[]>([]);
  const [periodo, setPeriodo] = useState("ultimo");
  const [visiveis, setVisiveis] = useState<string[]>(PADRAO_VISIVEIS);
  const [indiceGrafico, setIndiceGrafico] = useState("margEbitda");

  const filtradas = useMemo(
    () =>
      (companies ?? []).filter(
        (c) =>
          (segmento === "todos" || c.segmento_id === segmento) &&
          (grupo === "todos" || c.grupo_id === grupo) &&
          (porte === "todos" || c.porte === porte),
      ),
    [companies, segmento, grupo, porte],
  );

  // Ao trocar filtro, mantém só o que continua elegível e pré-seleciona até 6.
  useEffect(() => {
    if (!companies) return;
    const ids = filtradas.map((c) => c.id);
    setSelected((prev) => {
      const mantidos = prev.filter((id) => ids.includes(id));
      if (segmento === "todos" && grupo === "todos" && porte === "todos") return mantidos;
      return mantidos.length >= 2 ? mantidos : ids.slice(0, 6);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmento, grupo, porte, companies]);

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 6 ? prev : [...prev, id],
    );

  const idsOrdenados = useMemo(() => [...selected].sort(), [selected]);

  const { data: periodosDisponiveis } = useQuery({
    queryKey: ["comparativo-periodos", idsOrdenados.join(",")],
    enabled: idsOrdenados.length > 0,
    queryFn: async () => {
      const listas = await Promise.all(idsOrdenados.map((id) => periodosDaEmpresa(id).catch(() => [])));
      return Array.from(new Set(listas.flat())).sort().reverse();
    },
  });

  const resultados = useQueries({
    queries: idsOrdenados.map((id) => {
      const emp = (companies ?? []).find((c) => c.id === id);
      return {
        queryKey: ["comparativo-indices", id, periodo, visaoCalc],
        enabled: !!tenantId && idsOrdenados.length >= 2,
        staleTime: 5 * 60_000,
        queryFn: () =>
          calcularIndicesEmpresa({
            companyId: id,
            tenantId: tenantId!,
            nome: emp?.razao_social ?? emp?.name ?? "Empresa",
            periodo: periodo === "ultimo" ? null : periodo,
            visao: visaoCalc,
          }),
      };
    }),
  });

  const carregando = resultados.some((r) => r.isLoading);
  const dados: EmpresaComparada[] = resultados
    .map((r) => r.data)
    .filter((d): d is EmpresaComparada => !!d);

  const linhas = useMemo(
    () =>
      INDICES_COMPARAVEIS.filter((d) => visiveis.includes(d.key)).sort(
        (a, b) => ORDEM_GRUPOS.indexOf(a.grupo) - ORDEM_GRUPOS.indexOf(b.grupo),
      ),
    [visiveis],
  );

  const medias = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const def of INDICES_COMPARAVEIS) {
      const vals = dados
        .map((d) => d.valores[def.key])
        .filter((v): v is number => v != null && isFinite(v));
      m[def.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    return m;
  }, [dados]);

  const bestWorst = useMemo(() => {
    const map: Record<string, { best: number | null; worst: number | null }> = {};
    for (const def of INDICES_COMPARAVEIS) {
      const vals = dados
        .map((d) => d.valores[def.key])
        .filter((v): v is number => v != null && isFinite(v));
      if (vals.length < 2) {
        map[def.key] = { best: null, worst: null };
        continue;
      }
      const hi = Math.max(...vals);
      const lo = Math.min(...vals);
      map[def.key] = def.melhor === "high" ? { best: hi, worst: lo } : { best: lo, worst: hi };
    }
    return map;
  }, [dados]);

  const defGrafico = INDICES_COMPARAVEIS.find((d) => d.key === indiceGrafico);
  const dadosGrafico = dados
    .map((d) => ({
      nome: d.nome.length > 18 ? d.nome.slice(0, 18) + "…" : d.nome,
      valor: d.valores[indiceGrafico] ?? null,
    }))
    .filter((d) => d.valor != null);

  const nomeSegmento = (segmentos ?? []).find((s) => s.id === segmento)?.nome;

  if (isCliente) {
    return (
      <PortalShell variant="admin" title="Comparativo entre empresas">
        <Card className="p-10 text-center text-sm text-muted-foreground">
          Você não tem acesso a esta tela.
        </Card>
      </PortalShell>
    );
  }

  return (
    <PortalShell variant="admin" title="Comparativo entre empresas">
      <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-6">
        <div className="space-y-4 h-fit xl:sticky xl:top-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Filtros</h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Segmento</label>
                <Select value={segmento} onValueChange={setSegmento}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os segmentos</SelectItem>
                    {(segmentos ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Grupo econômico</label>
                <Select value={grupo} onValueChange={setGrupo}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os grupos</SelectItem>
                    {(grupos ?? []).map((g: any) => (
                      <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Porte</label>
                <Select value={porte} onValueChange={setPorte}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os portes</SelectItem>
                    {PORTES.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Período</label>
                <Select value={periodo} onValueChange={setPeriodo}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ultimo">Último disponível</SelectItem>
                    {(periodosDisponiveis ?? []).map((p) => (
                      <SelectItem key={p} value={p}>{p.slice(0, 7)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <GitCompareArrows className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Empresas ({selected.length}/6)</h3>
            </div>
            <div className="space-y-1.5 max-h-[38vh] overflow-y-auto pr-1">
              {filtradas.map((c) => {
                const isSel = selected.includes(c.id);
                const disabled = !isSel && selected.length >= 6;
                return (
                  <label
                    key={c.id}
                    className={cn(
                      "flex items-start gap-2 rounded-md px-2 py-2 cursor-pointer transition-colors",
                      isSel ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-accent/50",
                      disabled && "opacity-40 cursor-not-allowed",
                    )}
                  >
                    <Checkbox checked={isSel} disabled={disabled} onCheckedChange={() => toggle(c.id)} className="mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{c.razao_social ?? c.name}</div>
                      {c.porte && <div className="text-[10px] text-muted-foreground">{c.porte}</div>}
                    </div>
                  </label>
                );
              })}
              {filtradas.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma empresa para os filtros.</p>
              )}
            </div>
            {selected.length > 0 && (
              <Button size="sm" variant="ghost" className="w-full mt-3" onClick={() => setSelected([])}>
                Limpar seleção
              </Button>
            )}
          </Card>

          <Card className="p-4">
            <h3 className="font-semibold text-sm mb-3">Índices exibidos</h3>
            <div className="space-y-3 max-h-[38vh] overflow-y-auto pr-1">
              {ORDEM_GRUPOS.map((g) => {
                const defs = INDICES_COMPARAVEIS.filter((d) => d.grupo === g);
                return (
                  <div key={g}>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{g}</p>
                    {defs.map((d) => (
                      <label key={d.key} className="flex items-center gap-2 py-1 cursor-pointer">
                        <Checkbox
                          checked={visiveis.includes(d.key)}
                          onCheckedChange={() =>
                            setVisiveis((prev) =>
                              prev.includes(d.key) ? prev.filter((k) => k !== d.key) : [...prev, d.key],
                            )
                          }
                        />
                        <span className="text-xs">{d.label}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          {selected.length < 2 ? (
            <Card className="p-12 text-center text-sm text-muted-foreground">
              <GitCompareArrows className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
              Selecione pelo menos 2 empresas (ou use os filtros de segmento/porte) para comparar.
            </Card>
          ) : carregando && dados.length === 0 ? (
            <Card className="p-12 text-center text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
              Calculando índices…
            </Card>
          ) : linhas.length === 0 ? (
            <Card className="p-12 text-center text-sm text-muted-foreground">
              Marque ao menos um índice na lista ao lado.
            </Card>
          ) : (
            <>
              <Card className="p-5 shadow-[var(--shadow-soft)] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground sticky left-0 bg-card z-10">
                          Índice
                        </th>
                        {dados.map((c) => (
                          <th key={c.id} className="text-right py-3 px-3 min-w-[170px]">
                            <Link to="/dashboard" search={{ company: c.id }} className="group inline-flex items-center gap-1.5">
                              <span className="font-semibold truncate max-w-[150px] group-hover:text-primary transition-colors">
                                {c.nome}
                              </span>
                              <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition" />
                            </Link>
                            <div className="text-[10px] font-normal text-muted-foreground mt-0.5">
                              {c.erro ? c.erro : c.periodo ? `ref: ${c.periodo.slice(0, 7)}` : "—"}
                            </div>
                          </th>
                        ))}
                        <th className="text-right py-3 px-3 min-w-[130px] bg-muted/30">
                          <span className="font-semibold">
                            {nomeSegmento ? `Média ${nomeSegmento}` : "Média do grupo"}
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map((def, idx) => {
                        const bw = bestWorst[def.key];
                        const media = medias[def.key];
                        return (
                          <tr
                            key={def.key}
                            className={cn(
                              "border-b last:border-0 hover:bg-accent/20 transition-colors",
                              idx % 2 === 1 && "bg-muted/10",
                            )}
                          >
                            <td className="py-2.5 px-3 font-medium sticky left-0 bg-card">
                              {def.label}
                              <span className="ml-2 text-[10px] text-muted-foreground">{def.grupo}</span>
                            </td>
                            {dados.map((c) => {
                              const v = c.valores[def.key] ?? null;
                              const isBest = bw?.best != null && v != null && v === bw.best;
                              const isWorst =
                                bw?.worst != null && v != null && v === bw.worst && bw.best !== bw.worst;
                              const vsMedia =
                                v != null && media != null
                                  ? def.melhor === "high"
                                    ? v - media
                                    : media - v
                                  : null;
                              return (
                                <td key={c.id} className="py-2.5 px-3 text-right tabular-nums">
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5",
                                      isBest && "bg-success/15 text-success font-semibold",
                                      isWorst && "bg-destructive/15 text-destructive font-semibold",
                                    )}
                                  >
                                    {formatarComparavel(v, def.formato)}
                                  </span>
                                  {vsMedia != null && Math.abs(vsMedia) > 0.005 && (
                                    <div className={cn("text-[10px] mt-0.5", vsMedia > 0 ? "text-success" : "text-destructive")}>
                                      {vsMedia > 0 ? "acima" : "abaixo"} da média
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                            <td className="py-2.5 px-3 text-right tabular-nums bg-muted/30 font-medium">
                              {formatarComparavel(media, def.formato)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="p-5 shadow-[var(--shadow-soft)]">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h3 className="font-semibold text-sm">Comparação gráfica</h3>
                  <Select value={indiceGrafico} onValueChange={setIndiceGrafico}>
                    <SelectTrigger className="h-8 w-[240px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INDICES_COMPARAVEIS.map((d: DefComparavel) => (
                        <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {dadosGrafico.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-8 text-center">Sem valores para este índice.</p>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer>
                      <BarChart data={dadosGrafico} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid {...GRID_PROPS} />
                        <XAxis dataKey="nome" {...AXIS_PROPS} interval={0} angle={-15} textAnchor="end" height={60} />
                        <YAxis {...AXIS_PROPS} width={60} />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          formatter={(v: number) => formatarComparavel(v, defGrafico?.formato ?? "ratio")}
                        />
                        <Bar dataKey="valor" fill={CHART_COLORS[0]} radius={[5, 5, 0, 0]} {...ANIMATION} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <Badge variant="outline" className="border-success/30 text-success bg-success/10">Melhor</Badge>
                <Badge variant="outline" className="border-destructive/30 text-destructive bg-destructive/10">Pior</Badge>
                <span>
                  Só índices relativos entram na comparação; valores em R$ aparecem apenas como crescimento (%).
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
