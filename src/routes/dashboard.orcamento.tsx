// Etapa 5 do módulo Orçamento — Análise de Variação (Orçado x Realizado).
// Visão do cliente: seletor de orçamento (família por nome), grade evolutiva
// com colunas por PERÍODO quando um ano é escolhido, ou por ANO quando vários
// anos são selecionados no filtro global. Cada coluna traz Orçado, Realizado
// e Variação com semáforo, e permite drill-down por item nas contas do plano.
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
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
  computeContasDoItemMensal,
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/orcamento")({
  component: OrcamentoAnalise,
});

type TotalizarPor = "mes" | "trimestre" | "semestre" | "ano";
type VarDisplay = "valor" | "pct" | "ambos";

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

function calcStatus(
  orcado: number,
  realizado: number,
  tipo: string | null,
  tolAmarelo: number,
  tolVermelho: number,
): "verde" | "amarelo" | "vermelho" | "neutro" {
  if (orcado === 0 && realizado === 0) return "neutro";
  if (orcado === 0) return ehReceita(tipo) ? "verde" : "amarelo";
  const desvioPct = ((realizado - orcado) / Math.abs(orcado)) * 100;
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
        <CircleCheck className="h-3.5 w-3.5" />
      </span>
    );
  if (status === "amarelo")
    return (
      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs font-medium">
        <TriangleAlert className="h-3.5 w-3.5" />
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 text-xs font-medium">
      <CircleAlert className="h-3.5 w-3.5" />
    </span>
  );
}

function cellToneClass(s: "verde" | "amarelo" | "vermelho" | "neutro") {
  if (s === "vermelho") return "bg-red-500/10";
  if (s === "amarelo") return "bg-amber-500/10";
  if (s === "verde") return "bg-emerald-500/5";
  return "";
}

// -------------------- Column builder --------------------

interface Coluna {
  key: string;
  label: string;
  ano: number;
  meses: number[]; // months (1..12) covered by this column, within selectedMonths
}

function buildColunas(
  years: number[],
  months: number[],
  totalizarPor: TotalizarPor,
): { colunas: Coluna[]; isMultiAno: boolean } {
  const mesesOrdenados = [...months].sort((a, b) => a - b);
  const anosOrdenados = [...years].sort((a, b) => a - b);
  const isMultiAno = anosOrdenados.length > 1;

  if (isMultiAno) {
    // Colunas = anos. Cada coluna cobre TODOS os meses selecionados naquele ano.
    return {
      isMultiAno,
      colunas: anosOrdenados.map((ano) => ({
        key: `y-${ano}`,
        label: String(ano),
        ano,
        meses: mesesOrdenados,
      })),
    };
  }

  const ano = anosOrdenados[0] ?? new Date().getFullYear();

  if (totalizarPor === "ano") {
    return {
      isMultiAno,
      colunas: [
        { key: `full-${ano}`, label: String(ano), ano, meses: mesesOrdenados },
      ],
    };
  }

  if (totalizarPor === "mes") {
    return {
      isMultiAno,
      colunas: mesesOrdenados.map((m) => ({
        key: `m-${ano}-${m}`,
        label: MONTHS.find((x) => x.m === m)?.label ?? String(m),
        ano,
        meses: [m],
      })),
    };
  }

  if (totalizarPor === "trimestre") {
    const grupos: Coluna[] = [];
    for (let q = 1; q <= 4; q++) {
      const range = [q * 3 - 2, q * 3 - 1, q * 3];
      const meses = mesesOrdenados.filter((m) => range.includes(m));
      if (meses.length === 0) continue;
      grupos.push({ key: `q-${ano}-${q}`, label: `Q${q}`, ano, meses });
    }
    return { isMultiAno, colunas: grupos };
  }

  // semestre
  const grupos: Coluna[] = [];
  for (let s = 1; s <= 2; s++) {
    const range = s === 1 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12];
    const meses = mesesOrdenados.filter((m) => range.includes(m));
    if (meses.length === 0) continue;
    grupos.push({ key: `s-${ano}-${s}`, label: `S${s}`, ano, meses });
  }
  return { isMultiAno, colunas: grupos };
}

// -------------------- Componente principal --------------------

interface Cell {
  orcado: number | null; // null = sem orçamento cadastrado para este ano
  realizado: number | null; // null = sem dados (nenhum lançamento)
  semDados: boolean;
}

function OrcamentoAnalise() {
  const { companyId, company } = useDashboardCompany();
  const { years, months } = useFilters();

  const [orcamentoNome, setOrcamentoNome] = useState<string | null>(null);
  const [totalizarPor, setTotalizarPor] = useState<TotalizarPor>("mes");
  const [varDisplay, setVarDisplay] = useState<VarDisplay>("ambos");
  const [expandido, setExpandido] = useState<string | null>(null);
  const [tolAmarelo, setTolAmarelo] = useState(5);
  const [tolVermelho, setTolVermelho] = useState(15);

  const anosSelecionados = useMemo(
    () => [...years].sort((a, b) => a - b),
    [years],
  );
  const mesesSelecionados = useMemo(
    () => [...months].sort((a, b) => a - b),
    [months],
  );

  const { colunas, isMultiAno } = useMemo(
    () => buildColunas(anosSelecionados, mesesSelecionados, totalizarPor),
    [anosSelecionados, mesesSelecionados, totalizarPor],
  );

  // ---- Todos os orçamentos da empresa para os anos selecionados ----
  const orcamentosQ = useQuery({
    queryKey: ["orcamentos-multiano", companyId, anosSelecionados.join(",")],
    enabled: !!companyId && anosSelecionados.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orcamentos")
        .select("id, nome, ano, realizado_visao, status")
        .eq("company_id", companyId!)
        .in("ano", anosSelecionados)
        .order("ano", { ascending: false })
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Orcamento[];
    },
  });
  const orcamentos = orcamentosQ.data ?? [];

  // Nomes disponíveis (uma "família" de orçamento pode cobrir vários anos)
  const nomesDisponiveis = useMemo(() => {
    const s = new Set(orcamentos.map((o) => o.nome));
    return Array.from(s).sort();
  }, [orcamentos]);
  const nomeAtivo =
    orcamentoNome && nomesDisponiveis.includes(orcamentoNome)
      ? orcamentoNome
      : nomesDisponiveis[0] ?? null;

  // Mapa ano → orçamento daquela família
  const orcamentoPorAno = useMemo(() => {
    const m = new Map<number, Orcamento>();
    for (const o of orcamentos) {
      if (o.nome === nomeAtivo && !m.has(o.ano)) m.set(o.ano, o);
    }
    return m;
  }, [orcamentos, nomeAtivo]);

  // Orçamento "primário" (para pegar itens e visão) — o do ano mais recente selecionado
  // que tem orçamento; se nenhum, usa o mais recente da família.
  const orcamentoPrimario = useMemo(() => {
    for (let i = anosSelecionados.length - 1; i >= 0; i--) {
      const o = orcamentoPorAno.get(anosSelecionados[i]);
      if (o) return o;
    }
    const familia = orcamentos.filter((o) => o.nome === nomeAtivo);
    return familia.sort((a, b) => b.ano - a.ano)[0] ?? null;
  }, [orcamentoPorAno, anosSelecionados, orcamentos, nomeAtivo]);

  // ---- Itens do orçamento primário ----
  const itensQ = useQuery({
    queryKey: ["orcamento-itens-multi", orcamentoPrimario?.id],
    enabled: !!orcamentoPrimario?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orcamento_itens")
        .select("id, rotulo, contas, tipo_conta, ordem")
        .eq("orcamento_id", orcamentoPrimario!.id)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        contas: Array.isArray(r.contas) ? r.contas : [],
      })) as OrcamentoItem[];
    },
  });
  const itens = itensQ.data ?? [];

  // ---- Valores orçados de todos os orçamentos da família selecionados ----
  const orcamentoIds = useMemo(
    () => Array.from(orcamentoPorAno.values()).map((o) => o.id),
    [orcamentoPorAno],
  );
  const valoresQ = useQuery({
    queryKey: ["orcamento-valores-multi", orcamentoIds.join(",")],
    enabled: orcamentoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orcamento_valores")
        .select("orcamento_id, item_id, competencia, valor_orcado")
        .in("orcamento_id", orcamentoIds);
      if (error) throw error;
      return (data ?? []) as (OrcamentoValor & { orcamento_id: string })[];
    },
  });

  // ---- Realizado: 1 query por ano selecionado (Jan–Dez) ----
  // Rotulamos os itens uma vez por ID; o mapeamento item.contas→classificações
  // é feito dentro do motor. Para multi-ano, aplicamos os itens do orçamento
  // primário a cada ano — assume-se que a "família" mantém os mesmos itens.
  const visao: Visao = orcamentoPrimario?.realizado_visao ?? "contabil";
  const itensParaMotor = useMemo(
    () =>
      itens.map((i) => ({
        id: i.id,
        contas: i.contas,
        tipo_conta: i.tipo_conta,
      })),
    [itens],
  );

  const realizadoQueries = useQueries({
    queries: anosSelecionados.map((ano) => ({
      queryKey: [
        "orcamento-realizado-ano",
        company?.tenant_id,
        companyId,
        visao,
        ano,
        itens.map((i) => i.id).join(","),
      ],
      enabled:
        !!company?.tenant_id && !!companyId && itens.length > 0,
      queryFn: async () => {
        const res = await computeRealizadoDetalhado({
          tenantId: company!.tenant_id!,
          companyId: companyId!,
          visao,
          inicio: `${ano}-01`,
          fim: `${ano}-12`,
          itens: itensParaMotor,
        });
        return { ano, ...res };
      },
    })),
  });

  const carregando =
    orcamentosQ.isLoading ||
    itensQ.isLoading ||
    valoresQ.isLoading ||
    realizadoQueries.some((q) => q.isLoading);

  // ---- Cálculo de célula para (item, coluna) ----
  interface LinhaGrid {
    item: OrcamentoItem;
    cells: Cell[]; // uma por coluna
    totalCell: Cell;
  }

  const grid: LinhaGrid[] = useMemo(() => {
    const valores = valoresQ.data ?? [];
    const realPorAno = new Map<number, Record<string, any>>();
    for (const q of realizadoQueries) {
      const d = q.data;
      if (d) realPorAno.set(d.ano, d.porItem);
    }

    const computeCell = (item: OrcamentoItem, col: Coluna): Cell => {
      // Orçado — soma valor_orcado dos meses da coluna no orçamento daquele ano
      const orc = orcamentoPorAno.get(col.ano);
      let orcado: number | null = null;
      if (orc) {
        orcado = 0;
        for (const m of col.meses) {
          const key = `${col.ano}-${String(m).padStart(2, "0")}`;
          const v = valores.find(
            (x) =>
              x.orcamento_id === orc.id &&
              x.item_id === item.id &&
              x.competencia.slice(0, 7) === key,
          );
          if (v) orcado += Number(v.valor_orcado ?? 0);
        }
      }

      // Realizado
      const porItem = realPorAno.get(col.ano);
      let realizado: number | null = 0;
      let algumComDado = false;
      if (!porItem) {
        realizado = null;
      } else {
        const detalhe = porItem[item.id];
        if (!detalhe) {
          realizado = null;
        } else {
          for (const m of col.meses) {
            const key = `${col.ano}-${String(m).padStart(2, "0")}`;
            const r = detalhe.porMes.find((x: any) => x.competencia === key);
            if (r && !r.semDados) {
              realizado += r.valor;
              algumComDado = true;
            }
          }
          if (!algumComDado) realizado = null;
        }
      }

      return {
        orcado,
        realizado,
        semDados: realizado === null && orcado === null,
      };
    };

    return itens.map((item) => {
      const cells = colunas.map((c) => computeCell(item, c));
      // Total = soma horizontal
      let tOrc: number | null = null;
      let tReal: number | null = null;
      for (const c of cells) {
        if (c.orcado !== null) tOrc = (tOrc ?? 0) + c.orcado;
        if (c.realizado !== null) tReal = (tReal ?? 0) + c.realizado;
      }
      return {
        item,
        cells,
        totalCell: { orcado: tOrc, realizado: tReal, semDados: tOrc === null && tReal === null },
      };
    });
  }, [itens, colunas, valoresQ.data, realizadoQueries, orcamentoPorAno]);

  // ---- Totais gerais para cards ----
  const totais = useMemo(() => {
    let tOrc = 0;
    let tReal = 0;
    let houveOrc = false;
    let houveReal = false;
    for (const l of grid) {
      if (l.totalCell.orcado !== null) {
        tOrc += l.totalCell.orcado;
        houveOrc = true;
      }
      if (l.totalCell.realizado !== null) {
        tReal += l.totalCell.realizado;
        houveReal = true;
      }
    }
    return {
      tOrc: houveOrc ? tOrc : null,
      tReal: houveReal ? tReal : null,
      tVar: houveReal && houveOrc ? tReal - tOrc : null,
      tVarP:
        houveReal && houveOrc && tOrc !== 0
          ? ((tReal - tOrc) / Math.abs(tOrc)) * 100
          : null,
    };
  }, [grid]);

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
        <div className="text-sm font-medium">
          Nenhum orçamento cadastrado para {anosSelecionados.join(", ")}
        </div>
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
            value={nomeAtivo ?? ""}
            onValueChange={(v) => setOrcamentoNome(v)}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {nomesDisponiveis.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!isMultiAno && (
          <div>
            <Label className="text-xs text-muted-foreground">Totalizar por</Label>
            <Select
              value={totalizarPor}
              onValueChange={(v) => setTotalizarPor(v as TotalizarPor)}
            >
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mes">Mês</SelectItem>
                <SelectItem value="trimestre">Trimestre</SelectItem>
                <SelectItem value="semestre">Semestre</SelectItem>
                <SelectItem value="ano">Ano (Total)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div>
          <Label className="text-xs text-muted-foreground">Mostrar Variação</Label>
          <Select value={varDisplay} onValueChange={(v) => setVarDisplay(v as VarDisplay)}>
            <SelectTrigger className="h-9 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="valor">R$</SelectItem>
              <SelectItem value="pct">%</SelectItem>
              <SelectItem value="ambos">R$ e %</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Escopo</Label>
          <div className="h-9 flex items-center px-3 rounded-md border border-border bg-muted/30 text-sm">
            {isMultiAno
              ? `${anosSelecionados.length} anos · ${mesesSelecionados.length} meses`
              : `${mesesSelecionados.length} mês(es) de ${anosSelecionados[0]}`}
          </div>
        </div>

        <div className="flex items-end gap-2 ml-auto">
          <div>
            <Label className="text-xs text-muted-foreground">Tol. amarelo (%)</Label>
            <Input
              type="number"
              value={tolAmarelo}
              onChange={(e) => setTolAmarelo(Number(e.target.value) || 0)}
              className="h-9 w-20"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Tol. vermelho (%)</Label>
            <Input
              type="number"
              value={tolVermelho}
              onChange={(e) => setTolVermelho(Number(e.target.value) || 0)}
              className="h-9 w-20"
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

      {/* Grade evolutiva */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-sm border-separate border-spacing-0 min-w-full">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th
                  className="text-left px-3 py-2 font-medium sticky left-0 bg-muted/60 z-10 border-r border-border min-w-[220px]"
                  rowSpan={2}
                >
                  Item
                </th>
                <th className="text-left px-3 py-2 font-medium border-r border-border" rowSpan={2}>
                  Tipo
                </th>
                {colunas.map((c) => (
                  <th
                    key={c.key}
                    colSpan={3}
                    className="text-center px-2 py-1.5 font-semibold border-l border-border"
                  >
                    {c.label}
                    {!isMultiAno && totalizarPor !== "mes" && c.meses.length > 0 && (
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground/70">
                        ({c.meses.map((m) => MONTHS.find((x) => x.m === m)?.label).join("·")})
                      </span>
                    )}
                  </th>
                ))}
                <th
                  colSpan={3}
                  className="text-center px-2 py-1.5 font-semibold border-l-2 border-border bg-primary/5"
                >
                  TOTAL
                </th>
              </tr>
              <tr>
                {colunas.map((c) => (
                  <Fragment key={`sub-${c.key}`}>
                    <th className="text-right px-2 py-1 font-normal border-l border-border/60 text-[10px]">
                      Orç
                    </th>
                    <th className="text-right px-2 py-1 font-normal text-[10px]">Real</th>
                    <th className="text-right px-2 py-1 font-normal text-[10px]">Var</th>
                  </Fragment>
                ))}
                <th className="text-right px-2 py-1 font-normal border-l-2 border-border bg-primary/5 text-[10px]">
                  Orç
                </th>
                <th className="text-right px-2 py-1 font-normal bg-primary/5 text-[10px]">Real</th>
                <th className="text-right px-2 py-1 font-normal bg-primary/5 text-[10px]">Var</th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr>
                  <td
                    colSpan={2 + colunas.length * 3 + 3}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    Calculando…
                  </td>
                </tr>
              ) : grid.length === 0 ? (
                <tr>
                  <td
                    colSpan={2 + colunas.length * 3 + 3}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    Nenhum item configurado neste orçamento.
                  </td>
                </tr>
              ) : (
                grid.map((l) => {
                  const aberto = expandido === l.item.id;
                  return (
                    <Fragment key={l.item.id}>
                      <tr
                        className="border-t border-border cursor-pointer hover:bg-muted/30"
                        onClick={() => setExpandido(aberto ? null : l.item.id)}
                      >
                        <td className="px-3 py-2 font-medium sticky left-0 bg-background border-r border-border z-10">
                          <div className="flex items-center gap-1">
                            {aberto ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                            <span className="truncate">{l.item.rotulo}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 border-r border-border">
                          <Badge variant="outline" className="text-[10px]">
                            {l.item.tipo_conta ?? "—"}
                          </Badge>
                        </td>
                        {l.cells.map((cell, idx) => (
                          <CellTrio
                            key={colunas[idx].key}
                            cell={cell}
                            tipo={l.item.tipo_conta}
                            varDisplay={varDisplay}
                            tolAmarelo={tolAmarelo}
                            tolVermelho={tolVermelho}
                          />
                        ))}
                        <CellTrio
                          cell={l.totalCell}
                          tipo={l.item.tipo_conta}
                          varDisplay={varDisplay}
                          tolAmarelo={tolAmarelo}
                          tolVermelho={tolVermelho}
                          bgClass="bg-primary/5"
                          leftBorder="border-l-2"
                        />
                      </tr>
                      {aberto && (
                        <DetalheItem
                          item={l.item}
                          tenantId={company?.tenant_id ?? null}
                          companyId={companyId}
                          visao={visao}
                          colunas={colunas}
                          isMultiAno={isMultiAno}
                          itemCells={l.cells}
                          itemTotal={l.totalCell}
                        />
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="text-xs text-muted-foreground px-1 space-y-1">
        <div>
          Visão do realizado:{" "}
          <b>{visao === "gerencial" ? "Gerencial" : "Contábil"}</b> (definida no orçamento).
        </div>
        <div>
          Coluna vazia ("—") em Orçado significa ano SEM orçamento cadastrado; em Realizado
          significa ano/mês SEM lançamentos carregados.
        </div>
      </div>
    </div>
  );
}

// -------------------- Trio de células (Orç / Real / Var) --------------------

function CellTrio({
  cell,
  tipo,
  varDisplay,
  tolAmarelo,
  tolVermelho,
  bgClass = "",
  leftBorder = "border-l",
}: {
  cell: Cell;
  tipo: string | null;
  varDisplay: VarDisplay;
  tolAmarelo: number;
  tolVermelho: number;
  bgClass?: string;
  leftBorder?: "border-l" | "border-l-2";
}) {
  const varR =
    cell.realizado !== null && cell.orcado !== null ? cell.realizado - cell.orcado : null;
  const varP =
    cell.realizado !== null && cell.orcado !== null && cell.orcado !== 0
      ? ((cell.realizado - cell.orcado) / Math.abs(cell.orcado)) * 100
      : null;
  const status =
    cell.realizado === null || cell.orcado === null
      ? "neutro"
      : calcStatus(cell.orcado, cell.realizado, tipo, tolAmarelo, tolVermelho);

  const tone = cellToneClass(status);

  return (
    <>
      <td
        className={cn(
          "px-2 py-2 text-right tabular-nums text-xs",
          leftBorder,
          "border-border/60",
          bgClass,
        )}
      >
        {cell.orcado === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          formatBRL(cell.orcado)
        )}
      </td>
      <td className={cn("px-2 py-2 text-right tabular-nums text-xs", bgClass)}>
        {cell.realizado === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          formatBRL(cell.realizado)
        )}
      </td>
      <td
        className={cn(
          "px-2 py-2 text-right tabular-nums text-xs",
          tone || bgClass,
        )}
      >
        {varR === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-col items-end leading-tight">
            {(varDisplay === "valor" || varDisplay === "ambos") && (
              <span>{formatBRL(varR)}</span>
            )}
            {(varDisplay === "pct" || varDisplay === "ambos") && (
              <span className="text-[10px] opacity-80">
                {varP === null
                  ? "n/a"
                  : `${varP > 0 ? "+" : ""}${varP.toFixed(1).replace(".", ",")}%`}
              </span>
            )}
            <span className="mt-0.5">
              <StatusPill status={status} />
            </span>
          </div>
        )}
      </td>
    </>
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
// Mostra as contas analíticas que compõem o item, com valores REALIZADOS
// distribuídos nas MESMAS colunas de período usadas pela linha do item.
// Só realizado por conta — o orçado é definido no nível do item.

function DetalheItem({
  item,
  tenantId,
  companyId,
  visao,
  colunas,
  isMultiAno,
  itemCells,
  itemTotal,
}: {
  item: OrcamentoItem;
  tenantId: string | null;
  companyId: string | null;
  visao: Visao;
  colunas: Coluna[];
  isMultiAno: boolean;
  itemCells: Cell[];
  itemTotal: Cell;
}) {
  // Uma query por ano cobrindo o ano inteiro (Jan–Dez) — permite qualquer
  // agrupador (mês/trim/sem/ano) e multi-ano sem refetch por coluna.
  const anos = useMemo(
    () => Array.from(new Set(colunas.map((c) => c.ano))).sort(),
    [colunas],
  );

  const queries = useQueries({
    queries: anos.map((ano) => ({
      queryKey: [
        "orcamento-drill-mensal",
        item.id,
        companyId,
        visao,
        ano,
        item.contas.join(","),
        item.tipo_conta ?? "",
      ],
      enabled: !!tenantId && !!companyId && item.contas.length > 0,
      queryFn: async () => {
        const r = await computeContasDoItemMensal({
          tenantId: tenantId!,
          companyId: companyId!,
          visao,
          ano,
          contas: item.contas,
          tipoConta: item.tipo_conta,
        });
        return { ano, ...r };
      },
    })),
  });

  const totalColSpanEarly = 2 + colunas.length * 3 + 3;
  const msgRow = (msg: React.ReactNode, cls = "text-muted-foreground") => (
    <tr className="bg-muted/10 border-t border-border/40">
      <td colSpan={totalColSpanEarly} className={`px-3 py-2 text-xs ${cls}`}>
        {msg}
      </td>
    </tr>
  );

  if (item.contas.length === 0) {
    return msgRow("Item sem contas associadas.");
  }
  const loading = queries.some((q) => q.isLoading);
  const err = queries.find((q) => q.error)?.error as Error | undefined;
  if (loading) return msgRow("Carregando detalhes por conta…");
  if (err) return msgRow(`Erro ao carregar detalhes: ${err.message}`, "text-red-600");

  // Mapa ano → dados
  const porAno = new Map<number, { contas: any[]; mesesComMovimentoGlobal: Set<string> }>();
  for (const q of queries) {
    if (q.data) porAno.set(q.data.ano, q.data as any);
  }

  // Consolida contas únicas (por código) — descrição/classificação do primeiro ano em que apareceu
  const contasMap = new Map<
    string,
    { codigo: string; classificacao: string; descricao: string; origem: string }
  >();
  for (const { contas } of porAno.values()) {
    for (const c of contas) {
      if (!contasMap.has(c.codigo)) {
        contasMap.set(c.codigo, {
          codigo: c.codigo,
          classificacao: c.classificacao,
          descricao: c.descricao,
          origem: c.origem,
        });
      }
    }
  }
  const contasUnicas = Array.from(contasMap.values()).sort((a, b) =>
    a.classificacao.localeCompare(b.classificacao),
  );

  // Para cada (conta, coluna) somamos os meses da coluna do ano correspondente
  const valorContaColuna = (codigo: string, col: Coluna): { valor: number; semDados: boolean } => {
    const dados = porAno.get(col.ano);
    if (!dados) return { valor: 0, semDados: true };
    const conta = dados.contas.find((c: any) => c.codigo === codigo);
    if (!conta) {
      // Conta não teve movimento — mas o ano pode ter dados: reportamos 0 c/ dados
      const algumMes = col.meses.some((m) =>
        dados.mesesComMovimentoGlobal.has(`${col.ano}-${String(m).padStart(2, "0")}`),
      );
      return { valor: 0, semDados: !algumMes };
    }
    let soma = 0;
    let algumMovimento = false;
    let algumMesGlobal = false;
    for (const m of col.meses) {
      const key = `${col.ano}-${String(m).padStart(2, "0")}`;
      if (dados.mesesComMovimentoGlobal.has(key)) algumMesGlobal = true;
      const v = conta.porMes[key];
      if (v !== undefined) {
        soma += v;
        algumMovimento = true;
      }
    }
    if (!algumMovimento && !algumMesGlobal) return { valor: 0, semDados: true };
    return { valor: Math.round(soma * 100) / 100, semDados: false };
  };

  const valorContaTotal = (codigo: string) => {
    let soma = 0;
    let semTudo = true;
    for (const col of colunas) {
      const { valor, semDados } = valorContaColuna(codigo, col);
      if (!semDados) {
        soma += valor;
        semTudo = false;
      }
    }
    return { valor: Math.round(soma * 100) / 100, semDados: semTudo };
  };

  // ----- Proporção da conta dentro do realizado do item, por coluna -----
  // Fórmula: proporcao% = realizado_conta[col] / realizado_item[col] * 100
  // Só exibida quando o item tem realizado naquela coluna.
  const proporcaoContaCol = (codigo: string, i: number): number | null => {
    const itemReal = itemCells[i]?.realizado;
    if (itemReal === null || itemReal === undefined || Math.abs(itemReal) < 0.005) return null;
    const { valor, semDados } = valorContaColuna(codigo, colunas[i]);
    if (semDados) return null;
    return (valor / Math.abs(itemReal)) * 100;
  };

  const proporcaoContaTotal = (codigo: string): number | null => {
    const itemReal = itemTotal.realizado;
    if (itemReal === null || itemReal === undefined || Math.abs(itemReal) < 0.005) return null;
    const { valor, semDados } = valorContaTotal(codigo);
    if (semDados) return null;
    return (valor / Math.abs(itemReal)) * 100;
  };

  const totalColSpan = 2 + colunas.length * 3 + 3;

  const renderRealCellsInline = (codigo: string) => (
    <>
      {colunas.map((col, i) => {
        const { valor, semDados } = valorContaColuna(codigo, col);
        const pct = proporcaoContaCol(codigo, i);
        return (
          <Fragment key={`${codigo}-${col.key}`}>
            <td className="px-2 py-1 border-l border-border/40 bg-muted/10" />
            <td className="px-2 py-1 text-right tabular-nums text-xs bg-muted/10">
              {semDados ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <div className="flex flex-col items-end leading-tight">
                  <span>{formatBRL(valor)}</span>
                  {pct !== null && (
                    <span className="text-[10px] text-muted-foreground">
                      {pct.toFixed(1).replace(".", ",")}%
                    </span>
                  )}
                </div>
              )}
            </td>
            <td className="px-2 py-1 bg-muted/10" />
          </Fragment>
        );
      })}
      {(() => {
        const { valor, semDados } = valorContaTotal(codigo);
        const pct = proporcaoContaTotal(codigo);
        return (
          <>
            <td className="px-2 py-1 border-l-2 border-border bg-primary/5" />
            <td className="px-2 py-1 text-right tabular-nums text-xs font-medium bg-primary/5">
              {semDados ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <div className="flex flex-col items-end leading-tight">
                  <span>{formatBRL(valor)}</span>
                  {pct !== null && (
                    <span className="text-[10px] text-muted-foreground">
                      {pct.toFixed(1).replace(".", ",")}%
                    </span>
                  )}
                </div>
              )}
            </td>
            <td className="px-2 py-1 bg-primary/5" />
          </>
        );
      })()}
    </>
  );

  const totalPorColuna = colunas.map((col) => {
    let soma = 0;
    let semTudo = true;
    for (const c of contasUnicas) {
      const { valor, semDados } = valorContaColuna(c.codigo, col);
      if (!semDados) {
        soma += valor;
        semTudo = false;
      }
    }
    return { valor: Math.round(soma * 100) / 100, semDados: semTudo };
  });
  const totalGeral = (() => {
    let soma = 0;
    let semTudo = true;
    for (const c of contasUnicas) {
      const { valor, semDados } = valorContaTotal(c.codigo);
      if (!semDados) {
        soma += valor;
        semTudo = false;
      }
    }
    return { valor: Math.round(soma * 100) / 100, semDados: semTudo };
  })();

  return (
    <>
      <tr className="bg-muted/10 border-t border-border">
        <td
          colSpan={totalColSpan}
          className="px-3 py-1.5 text-[11px] text-muted-foreground"
        >
          Contas que compõem <b>{item.rotulo}</b> — realizado por{" "}
          {isMultiAno ? "ano" : "período"}. Sob cada valor, a{" "}
          <b>proporção da conta</b> dentro do realizado do item na coluna
          (soma = 100%).
        </td>
      </tr>

      {contasUnicas.length === 0 ? (
        <tr className="bg-muted/10 border-t border-border/40">
          <td
            colSpan={totalColSpan}
            className="px-3 py-2 text-xs text-muted-foreground italic"
          >
            Nenhuma conta analítica com movimento no período para as
            classificações selecionadas.
          </td>
        </tr>
      ) : (
        <>
          {contasUnicas.map((c) => (
            <tr
              key={`drill-${c.codigo}`}
              className="border-t border-border/40 bg-muted/10"
            >
              <td className="px-3 py-1 sticky left-0 bg-muted/10 border-r border-border z-10">
                <div className="pl-4 text-[11px] leading-tight">
                  <div className="font-mono">
                    {c.codigo} · {c.classificacao}
                  </div>
                  <div className="text-muted-foreground truncate">
                    {c.descricao || "—"}
                  </div>
                </div>
              </td>
              <td className="px-2 py-1 border-r border-border bg-muted/10" />
              {renderRealCellsInline(c.codigo)}
            </tr>
          ))}
          <tr className="border-t-2 border-border bg-muted/30 font-semibold">
            <td className="px-3 py-1 sticky left-0 bg-muted/30 border-r border-border z-10 text-[11px]">
              <div className="pl-4">Total das contas</div>
            </td>
            <td className="px-2 py-1 border-r border-border bg-muted/30" />
            {colunas.map((col, idx) => {
              const itemReal = itemCells[idx]?.realizado;
              const temPct =
                itemReal !== null &&
                itemReal !== undefined &&
                Math.abs(itemReal) > 0.005;
              return (
                <Fragment key={`tot-${col.key}`}>
                  <td className="px-2 py-1 border-l border-border/40 bg-muted/30" />
                  <td className="px-2 py-1 text-right tabular-nums text-xs bg-muted/30">
                    {totalPorColuna[idx].semDados ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-col items-end leading-tight">
                        <span>{formatBRL(totalPorColuna[idx].valor)}</span>
                        {temPct && (
                          <span className="text-[10px] text-muted-foreground">
                            100,0%
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1 bg-muted/30" />
                </Fragment>
              );
            })}
            <td className="px-2 py-1 border-l-2 border-border bg-primary/10" />
            <td className="px-2 py-1 text-right tabular-nums text-xs bg-primary/10">
              {totalGeral.semDados ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <div className="flex flex-col items-end leading-tight">
                  <span>{formatBRL(totalGeral.valor)}</span>
                  {itemTotal.realizado !== null &&
                    itemTotal.realizado !== undefined &&
                    Math.abs(itemTotal.realizado) > 0.005 && (
                      <span className="text-[10px] text-muted-foreground">
                        100,0%
                      </span>
                    )}
                </div>
              )}
            </td>
            <td className="px-2 py-1 bg-primary/10" />
          </tr>
        </>
      )}
    </>
  );
}

