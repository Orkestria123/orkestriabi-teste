// Etapa 5 do módulo Orçamento — Análise de Variação (Orçado x Realizado).
// Visão do cliente: seletor de orçamento, período (mês do filtro global) e
// toggle Mês/Acumulado (YTD). Tabela por item com semáforo por tipo de conta,
// respeitando meses sem dados. Realizado calculado pelo motor da Etapa 4.
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  TriangleAlert,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useDashboardCompany } from "@/components/dashboard-context";
import { useFilters, MONTHS } from "@/components/filter-bar";
import {
  computeRealizadoDetalhado,
  type Visao,
} from "@/lib/orcamento/realizado";
import { formatBRL } from "@/lib/format";

import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/orcamento")({
  component: OrcamentoAnalise,
});

type Modo = "mes" | "ytd";

interface Orcamento {
  id: string;
  nome: string;
  ano: number;
  realizado_visao: Visao;
  status: string;
}

interface OrcamentoItem {
  id: string;
  rotulo: string;
  contas: string[];
  tipo_conta: string | null;
  ordem: number | null;
}

interface OrcamentoValor {
  item_id: string;
  competencia: string; // YYYY-MM-DD
  valor_orcado: number;
}

// -------------------- Semáforo --------------------

function ehReceita(tipo?: string | null) {
  const t = (tipo ?? "").toLowerCase();
  return t === "receita";
}

/**
 * Devolve o status colorido conforme o desvio.
 * Para despesa/custo: realizado > orçado é ruim (vermelho).
 * Para receita: realizado < orçado é ruim (vermelho).
 */
function calcStatus(
  orcado: number,
  realizado: number,
  tipo: string | null,
  tolAmarelo: number,
  tolVermelho: number,
): "verde" | "amarelo" | "vermelho" | "neutro" {
  if (orcado === 0 && realizado === 0) return "neutro";
  if (orcado === 0) {
    // Sem meta: qualquer realizado positivo em despesa é atenção
    return ehReceita(tipo) ? "verde" : "amarelo";
  }
  const desvioPct = ((realizado - orcado) / Math.abs(orcado)) * 100;
  // Direção ruim: despesa → desvio positivo é ruim; receita → desvio negativo é ruim.
  const desvioRuim = ehReceita(tipo) ? -desvioPct : desvioPct;
  if (desvioRuim <= tolAmarelo) return "verde";
  if (desvioRuim <= tolVermelho) return "amarelo";
  return "vermelho";
}

function StatusPill({ status }: { status: "verde" | "amarelo" | "vermelho" | "neutro" }) {
  if (status === "neutro")
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
        <CircleMinus className="h-3.5 w-3.5" /> —
      </span>
    );
  if (status === "verde")
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
        <CircleCheck className="h-3.5 w-3.5" /> No alvo
      </span>
    );
  if (status === "amarelo")
    return (
      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs font-medium">
        <TriangleAlert className="h-3.5 w-3.5" /> Atenção
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 text-xs font-medium">
      <CircleAlert className="h-3.5 w-3.5" /> Crítico
    </span>
  );
}

function statusRowClass(s: "verde" | "amarelo" | "vermelho" | "neutro") {
  if (s === "vermelho") return "bg-red-500/5 hover:bg-red-500/10";
  if (s === "amarelo") return "bg-amber-500/5 hover:bg-amber-500/10";
  return "";
}

// -------------------- Componente --------------------

function OrcamentoAnalise() {
  const { companyId, company } = useDashboardCompany();
  const { years, months } = useFilters();

  const [orcamentoId, setOrcamentoId] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("mes");
  const [expandido, setExpandido] = useState<string | null>(null);
  const [tolAmarelo, setTolAmarelo] = useState(5);
  const [tolVermelho, setTolVermelho] = useState(15);

  // Mês de referência: último mês selecionado no filtro global
  const mesRef = months.length > 0 ? Math.max(...months) : new Date().getMonth() + 1;
  const anoRef = years[0] ?? new Date().getFullYear();
  const competenciaRef = `${anoRef}-${String(mesRef).padStart(2, "0")}`;

  // ---- Orçamentos disponíveis para a empresa (ano do filtro) ----
  const orcamentosQ = useQuery({
    queryKey: ["orcamentos-cliente", companyId, anoRef],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orcamentos")
        .select("id, nome, ano, realizado_visao, status")
        .eq("company_id", companyId!)
        .eq("ano", anoRef)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Orcamento[];
    },
  });

  const orcamentos = orcamentosQ.data ?? [];
  const orcamentoSel = useMemo(
    () => orcamentos.find((o) => o.id === orcamentoId) ?? orcamentos[0] ?? null,
    [orcamentos, orcamentoId],
  );

  // ---- Itens do orçamento ----
  const itensQ = useQuery({
    queryKey: ["orcamento-itens-cliente", orcamentoSel?.id],
    enabled: !!orcamentoSel?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orcamento_itens")
        .select("id, rotulo, contas, tipo_conta, ordem")
        .eq("orcamento_id", orcamentoSel!.id)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        contas: Array.isArray(r.contas) ? r.contas : [],
      })) as OrcamentoItem[];
    },
  });
  const itens = itensQ.data ?? [];

  // ---- Valores orçados (todos os meses do ano) ----
  const valoresQ = useQuery({
    queryKey: ["orcamento-valores-cliente", orcamentoSel?.id],
    enabled: !!orcamentoSel?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orcamento_valores")
        .select("item_id, competencia, valor_orcado")
        .eq("orcamento_id", orcamentoSel!.id);
      if (error) throw error;
      return (data ?? []) as OrcamentoValor[];
    },
  });

  // ---- Realizado (Jan → mesRef, para permitir Mês e YTD sem refetch) ----
  const realizadoQ = useQuery({
    queryKey: [
      "orcamento-realizado-cliente",
      orcamentoSel?.id,
      company?.tenant_id,
      companyId,
      anoRef,
      mesRef,
      itens.map((i) => i.id).join(","),
    ],
    enabled:
      !!orcamentoSel &&
      !!company?.tenant_id &&
      !!companyId &&
      itens.length > 0,
    queryFn: async () => {
      const res = await computeRealizadoDetalhado({
        tenantId: company!.tenant_id!,
        companyId: companyId!,
        visao: orcamentoSel!.realizado_visao,
        inicio: `${anoRef}-01`,
        fim: competenciaRef,
        itens: itens.map((i) => ({
          id: i.id,
          contas: i.contas,
          tipo_conta: i.tipo_conta,
        })),
      });
      return res;
    },
  });

  // ---- Monta linhas da tabela ----
  interface Linha {
    item: OrcamentoItem;
    orcado: number;
    realizado: number | null; // null = sem dados
    variacaoR: number | null;
    variacaoP: number | null;
    status: "verde" | "amarelo" | "vermelho" | "neutro";
  }

  const linhas: Linha[] = useMemo(() => {
    const valores = valoresQ.data ?? [];
    const real = realizadoQ.data?.porItem ?? {};
    const mesKey = competenciaRef;

    return itens.map((item) => {
      // Orçado
      let orcado = 0;
      if (modo === "mes") {
        const v = valores.find(
          (x) => x.item_id === item.id && x.competencia.slice(0, 7) === mesKey,
        );
        orcado = Number(v?.valor_orcado ?? 0);
      } else {
        // YTD: soma jan → mesRef
        for (const v of valores) {
          if (v.item_id !== item.id) continue;
          const mm = v.competencia.slice(0, 7);
          if (mm >= `${anoRef}-01` && mm <= mesKey) {
            orcado += Number(v.valor_orcado ?? 0);
          }
        }
      }

      // Realizado
      const detalhe = real[item.id];
      let realizado: number | null = 0;
      if (!detalhe) {
        realizado = null;
      } else if (modo === "mes") {
        const r = detalhe.porMes.find((x) => x.competencia === mesKey);
        realizado = r ? (r.semDados ? null : r.valor) : null;
      } else {
        const y = detalhe.ytd[detalhe.ytd.length - 1];
        // Só marca sem dados se TODOS os meses até aqui estão sem dados
        const algumComDados = detalhe.porMes.some((x) => !x.semDados);
        realizado = algumComDados ? y?.valor ?? 0 : null;
      }

      const variacaoR = realizado === null ? null : realizado - orcado;
      const variacaoP =
        realizado === null || orcado === 0
          ? null
          : ((realizado - orcado) / Math.abs(orcado)) * 100;
      const status =
        realizado === null
          ? "neutro"
          : calcStatus(orcado, realizado, item.tipo_conta, tolAmarelo, tolVermelho);

      return { item, orcado, realizado, variacaoR, variacaoP, status };
    });
  }, [itens, valoresQ.data, realizadoQ.data, modo, competenciaRef, anoRef, tolAmarelo, tolVermelho]);

  // ---- Totais do cabeçalho ----
  const totais = useMemo(() => {
    let tOrc = 0;
    let tReal = 0;
    let houveReal = false;
    for (const l of linhas) {
      tOrc += l.orcado;
      if (l.realizado !== null) {
        tReal += l.realizado;
        houveReal = true;
      }
    }
    const tVar = houveReal ? tReal - tOrc : null;
    const tVarP = houveReal && tOrc !== 0 ? ((tReal - tOrc) / Math.abs(tOrc)) * 100 : null;
    return { tOrc, tReal: houveReal ? tReal : null, tVar, tVarP };
  }, [linhas]);

  const mesLabel = MONTHS.find((m) => m.m === mesRef)?.label ?? "";
  const periodoLabel =
    modo === "mes"
      ? `${mesLabel}/${anoRef}`
      : `Jan → ${mesLabel}/${anoRef}`;

  if (!companyId) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Selecione uma empresa para ver a análise de orçamento.
      </Card>
    );
  }

  if (orcamentosQ.isLoading) {
    return <Card className="p-6 text-sm text-muted-foreground">Carregando orçamentos…</Card>;
  }

  if (orcamentos.length === 0) {
    return (
      <Card className="p-6 space-y-2">
        <div className="text-sm font-medium">Nenhum orçamento para {anoRef}</div>
        <div className="text-sm text-muted-foreground">
          Peça ao contador para configurar um orçamento na tela de configuração da empresa.
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Barra de controles */}
      <Card className="p-4 flex flex-wrap items-end gap-4">
        <div className="min-w-[220px]">
          <Label className="text-xs text-muted-foreground">Orçamento</Label>
          <Select
            value={orcamentoSel?.id ?? ""}
            onValueChange={(v) => setOrcamentoId(v)}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {orcamentos.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.nome} ({o.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Visão</Label>
          <div className="flex rounded-md border border-border overflow-hidden h-9">
            <button
              type="button"
              onClick={() => setModo("mes")}
              className={cn(
                "px-3 text-sm",
                modo === "mes" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
              )}
            >
              No mês
            </button>
            <button
              type="button"
              onClick={() => setModo("ytd")}
              className={cn(
                "px-3 text-sm border-l border-border",
                modo === "ytd" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
              )}
            >
              Acumulado (YTD)
            </button>
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Período de análise</Label>
          <div className="h-9 flex items-center px-3 rounded-md border border-border bg-muted/30 text-sm">
            {periodoLabel}
          </div>
        </div>
        <div className="flex items-end gap-2 ml-auto">
          <div>
            <Label className="text-xs text-muted-foreground">Tolerância amarelo (%)</Label>
            <Input
              type="number"
              value={tolAmarelo}
              onChange={(e) => setTolAmarelo(Number(e.target.value) || 0)}
              className="h-9 w-24"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Tolerância vermelho (%)</Label>
            <Input
              type="number"
              value={tolVermelho}
              onChange={(e) => setTolVermelho(Number(e.target.value) || 0)}
              className="h-9 w-24"
            />
          </div>
        </div>
      </Card>

      {/* Resumo executivo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <ResumoCard label="Total Orçado" valor={totais.tOrc} />
        <ResumoCard
          label="Total Realizado"
          valor={totais.tReal}
          hint={totais.tReal === null ? "Sem dados no período" : undefined}
        />
        <ResumoCard
          label="Variação R$"
          valor={totais.tVar}
          tone={
            totais.tVar === null
              ? "neutro"
              : totais.tVar > 0
                ? "alta"
                : totais.tVar < 0
                  ? "baixa"
                  : "neutro"
          }
        />
        <ResumoCard
          label="Variação %"
          valor={totais.tVarP}
          isPct
          tone={
            totais.tVarP === null
              ? "neutro"
              : totais.tVarP > 0
                ? "alta"
                : totais.tVarP < 0
                  ? "baixa"
                  : "neutro"
          }
        />
      </div>

      {/* Tabela de variação */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Item</th>
                <th className="text-left px-3 py-2 font-medium">Tipo</th>
                <th className="text-right px-3 py-2 font-medium">Orçado</th>
                <th className="text-right px-3 py-2 font-medium">Realizado</th>
                <th className="text-right px-3 py-2 font-medium">Variação R$</th>
                <th className="text-right px-3 py-2 font-medium">Variação %</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {itensQ.isLoading || realizadoQ.isLoading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    Calculando…
                  </td>
                </tr>
              ) : linhas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    Nenhum item configurado neste orçamento.
                  </td>
                </tr>
              ) : (
                linhas.map((l) => {
                  const aberto = expandido === l.item.id;
                  return (
                    <Fragment key={l.item.id}>
                      <tr
                        className={cn(
                          "border-t border-border cursor-pointer",
                          statusRowClass(l.status),
                        )}
                        onClick={() => setExpandido(aberto ? null : l.item.id)}
                      >
                        <td className="px-3 py-2 font-medium">
                          <div className="flex items-center gap-1">
                            {aberto ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                            {l.item.rotulo}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10px]">
                            {l.item.tipo_conta ?? "—"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatBRL(l.orcado)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.realizado === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            formatBRL(l.realizado)
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.variacaoR === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            formatBRL(l.variacaoR)
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.variacaoP === null ? (
                            <span className="text-muted-foreground">
                              {l.realizado === null ? "—" : "n/a"}
                            </span>
                          ) : (
                            `${l.variacaoP > 0 ? "+" : ""}${l.variacaoP.toFixed(1).replace(".", ",")}%`
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <StatusPill status={l.status} />
                        </td>
                      </tr>
                      {aberto && (
                        <tr className="bg-muted/20 border-t border-border">
                          <td colSpan={7} className="px-6 py-3">
                            <DetalheItem
                              item={l.item}
                              tenantId={company?.tenant_id ?? null}
                              companyId={companyId}
                              visao={orcamentoSel?.realizado_visao ?? "contabil"}
                              modo={modo}
                              anoRef={anoRef}
                              mesRef={mesRef}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
            {linhas.length > 0 && (
              <tfoot className="bg-muted/30 border-t-2 border-border font-medium">
                <tr>
                  <td className="px-3 py-2" colSpan={2}>Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatBRL(totais.tOrc)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totais.tReal === null ? "—" : formatBRL(totais.tReal)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totais.tVar === null ? "—" : formatBRL(totais.tVar)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totais.tVarP === null
                      ? "—"
                      : `${totais.tVarP > 0 ? "+" : ""}${totais.tVarP.toFixed(1).replace(".", ",")}%`}
                  </td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      <div className="text-xs text-muted-foreground px-1">
        Visão do realizado: <b>{orcamentoSel?.realizado_visao === "gerencial" ? "Gerencial" : "Contábil"}</b>{" "}
        (definida no orçamento). Meses sem lançamento aparecem como "—" e não geram variação.
      </div>
    </div>
  );
}

// -------------------- Cards de resumo --------------------

function ResumoCard({
  label,
  valor,
  isPct = false,
  tone = "neutro",
  hint,
}: {
  label: string;
  valor: number | null;
  isPct?: boolean;
  tone?: "neutro" | "alta" | "baixa";
  hint?: string;
}) {
  const toneClass =
    tone === "alta"
      ? "text-red-600 dark:text-red-400"
      : tone === "baixa"
        ? "text-emerald-600 dark:text-emerald-400"
        : "";
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", toneClass)}>
        {valor === null
          ? "—"
          : isPct
            ? `${valor > 0 ? "+" : ""}${valor.toFixed(1).replace(".", ",")}%`
            : formatBRL(valor)}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </Card>
  );
}

// -------------------- Drill/Detalhe do item --------------------

function DetalheItem({
  item,
  tenantId,
  companyId,
  visao,
  modo,
  anoRef,
  mesRef,
}: {
  item: OrcamentoItem;
  tenantId: string | null;
  companyId: string | null;
  visao: Visao;
  modo: Modo;
  anoRef: number;
  mesRef: number;
}) {
  const competenciaRef = `${anoRef}-${String(mesRef).padStart(2, "0")}`;

  // Realizado por conta que compõe o item: chamamos o motor uma vez por conta,
  // como itens de "1 conta cada", reutilizando computeRealizadoDetalhado.
  const q = useQuery({
    queryKey: ["orcamento-drill", item.id, companyId, visao, competenciaRef, modo],
    enabled: !!tenantId && !!companyId && item.contas.length > 0,
    queryFn: async () => {
      const res = await computeRealizadoDetalhado({
        tenantId: tenantId!,
        companyId: companyId!,
        visao,
        inicio: `${anoRef}-01`,
        fim: competenciaRef,
        itens: item.contas.map((c, i) => ({
          id: `${item.id}::${i}`,
          contas: [c],
          tipo_conta: item.tipo_conta,
        })),
      });
      return res;
    },
  });

  if (item.contas.length === 0) {
    return <div className="text-xs text-muted-foreground">Item sem contas associadas.</div>;
  }
  if (q.isLoading) return <div className="text-xs text-muted-foreground">Carregando detalhes…</div>;

  const detalhes = q.data?.porItem ?? {};

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground mb-1">
        Contas que compõem este item ({modo === "mes" ? "no mês" : "YTD"}):
      </div>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="text-left py-1 font-medium">Conta</th>
            <th className="text-right py-1 font-medium">Realizado</th>
          </tr>
        </thead>
        <tbody>
          {item.contas.map((c, i) => {
            const d = detalhes[`${item.id}::${i}`];
            let valor: number | null = 0;
            if (!d) {
              valor = null;
            } else if (modo === "mes") {
              const r = d.porMes.find((x) => x.competencia === competenciaRef);
              valor = r ? (r.semDados ? null : r.valor) : null;
            } else {
              const y = d.ytd[d.ytd.length - 1];
              const algum = d.porMes.some((x) => !x.semDados);
              valor = algum ? y?.valor ?? 0 : null;
            }
            return (
              <tr key={c} className="border-t border-border/50">
                <td className="py-1 font-mono">{c}</td>
                <td className="py-1 text-right tabular-nums">
                  {valor === null ? "—" : formatBRL(valor)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
