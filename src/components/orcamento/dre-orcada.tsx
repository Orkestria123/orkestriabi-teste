// DRE Orçada — Etapa 6 do módulo Orçamento
// Monta a DRE projetada a partir dos itens do orçamento, usando o MESMO
// mapeamento_demonstracao que produz a DRE realizada. Não exige orçamento
// por linha da DRE: cada item cai automaticamente na linha certa via prefixo
// de classificação.
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, CircleMinus, TriangleAlert, Info } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import {
  buildStatementFromDiario,
  type FlatRow,
} from "@/lib/diario/build-statements";
import {
  descendeDe,
  getMascaraConfig,
  type MascaraConfig,
} from "@/lib/mascara/interpretar";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MONTHS } from "@/components/filter-bar";

// ---------- tipos ----------
export interface DREColuna {
  key: string;
  label: string;
  ano: number;
  meses: number[]; // 1..12 dentro do ano
}

interface DREItem {
  id: string;
  rotulo: string;
  contas: string[]; // classificações do plano ("3.06.01.01.04", ...)
  tipo_conta: string | null;
}

interface Props {
  companyId: string;
  tenantId: string;
  visao: "contabil" | "gerencial";
  colunas: DREColuna[];
  isMultiAno: boolean;
  totalizarPorLabel: string; // apenas para header (ex: "Mês")
  itens: DREItem[];
  // Orçado (por item, por coluna) – já resolve base oficial/cenário/draft
  orcadoPorItemCol: Record<string, (number | null)[]>;
  baseLabel: string; // "Orçamento oficial" ou "Cenário: X"
  tolAmarelo: number;
  tolVermelho: number;
}

type TratamentoLacuna = "vazio" | "zero" | "realizado";

// ---------- linhas calculadas da DRE (mesmas fórmulas de build-statements) ----------
// (=) linhas são derivadas dos totais das linhas mapeadas.
interface SubtotalDef {
  linha: string;
  ordem: number;
  calc: (v: (l: string) => number | null) => number | null;
}

function somaSub(...vals: (number | null)[]): number | null {
  // Retorna null se TODAS as parcelas forem null (não orçadas), senão soma
  // ignorando null (parcial).
  let s = 0;
  let alguma = false;
  for (const v of vals) {
    if (v !== null && v !== undefined) {
      s += v;
      alguma = true;
    }
  }
  return alguma ? s : null;
}

// v(linha) devolve o valor da linha (com fallback conforme "tratamento"
// aplicado a montante). Aqui aplicamos apenas a lógica de sinais.
const SUBTOTAIS: SubtotalDef[] = [
  {
    linha: "(=) Receita Líquida",
    ordem: 150 * 1000 - 5,
    calc: (v) => somaSub(v("Receita Bruta"), invert(v("(-) Deduções da Receita Bruta"))),
  },
  {
    linha: "(=) Lucro Bruto",
    ordem: 290 * 1000,
    calc: (v) =>
      somaSub(
        v("(=) Receita Líquida"),
        invert(v("(-) Custos Industriais")),
        invert(v("(-) Custos Comerciais")),
        invert(v("(-) Custos Imobiliários")),
        invert(v("(-) Custos dos Serviços")),
        invert(v("(-) Custos")),
      ),
  },
  {
    linha: "(=) Resultado Operacional (EBIT)",
    ordem: 490 * 1000,
    calc: (v) =>
      somaSub(
        v("(=) Lucro Bruto"),
        invert(v("(-) Despesas Operacionais")),
        invert(v("(-) Despesas Administrativas")),
        invert(v("(-) Despesas Comerciais")),
        invert(v("(-) Despesas Tributárias")),
        invert(v("(-) Outras Despesas Operacionais")),
        v("(+) Outras Receitas Operacionais"),
      ),
  },
  {
    linha: "(=) Resultado Antes do IR/CSLL",
    ordem: 590 * 1000,
    calc: (v) =>
      somaSub(
        v("(=) Resultado Operacional (EBIT)"),
        v("(+) Receitas Financeiras"),
        invert(v("(-) Despesas Financeiras")),
      ),
  },
  {
    linha: "(=) Lucro Líquido do Exercício",
    ordem: 690 * 1000,
    calc: (v) =>
      somaSub(
        v("(=) Resultado Antes do IR/CSLL"),
        invert(v("(-) IRPJ")),
        invert(v("(-) CSLL")),
      ),
  },
];

function invert(x: number | null): number | null {
  return x === null ? null : -x;
}

// ---------- helpers ----------
async function getCompanyMeta(companyId: string, tenantId: string) {
  const { data: t } = await supabase
    .from("tenants")
    .select("plano_contas_modo")
    .eq("id", tenantId)
    .maybeSingle();
  return {
    modoGlobal: ((t as any)?.plano_contas_modo ?? "empresa") === "global",
  };
}

async function fetchMapaDRE(
  companyId: string,
  tenantId: string,
  modoGlobal: boolean,
) {
  const q = supabase
    .from("mapeamento_demonstracao")
    .select("classificacao_prefixo, linha_demonstracao, ordem, inverter_sinal")
    .eq("tenant_id", tenantId)
    .eq("tipo_demonstracao", "DRE");
  const { data, error } = modoGlobal
    ? await q.is("company_id", null)
    : await q.eq("company_id", companyId);
  if (error) throw error;
  return (data ?? []) as {
    classificacao_prefixo: string;
    linha_demonstracao: string;
    ordem: number;
    inverter_sinal: boolean;
  }[];
}

function buildMatcher(
  mapas: { classificacao_prefixo: string; linha_demonstracao: string; ordem: number; inverter_sinal: boolean }[],
  mascara: MascaraConfig,
) {
  const sorted = [...mapas].sort(
    (a, b) => b.classificacao_prefixo.length - a.classificacao_prefixo.length,
  );
  return (classificacao: string) => {
    for (const m of sorted) {
      if (descendeDe(classificacao, m.classificacao_prefixo, mascara)) return m;
    }
    return null;
  };
}

function calcStatusReceita(
  linha: string,
  orc: number | null,
  real: number | null,
  tolAmarelo: number,
  tolVermelho: number,
): "verde" | "amarelo" | "vermelho" | "neutro" {
  if (orc === null || real === null) return "neutro";
  if (orc === 0 && real === 0) return "neutro";
  if (orc === 0) return "amarelo";
  const desvioPct = ((real - orc) / Math.abs(orc)) * 100;
  // Convenção da DRE: receita positiva quer subir; despesa/custo/dedução
  // (linhas "(-)") positiva quer descer. Lucros: querem subir.
  const querSubir =
    linha.startsWith("Receita") ||
    linha.startsWith("(+)") ||
    linha.startsWith("(=)");
  const desvioRuim = querSubir ? -desvioPct : desvioPct;
  if (desvioRuim <= tolAmarelo) return "verde";
  if (desvioRuim <= tolVermelho) return "amarelo";
  return "vermelho";
}

function StatusPill({
  status,
}: {
  status: "verde" | "amarelo" | "vermelho" | "neutro";
}) {
  if (status === "neutro")
    return (
      <CircleMinus className="h-3.5 w-3.5 inline text-muted-foreground" />
    );
  if (status === "verde")
    return (
      <CircleCheck className="h-3.5 w-3.5 inline text-emerald-600 dark:text-emerald-400" />
    );
  if (status === "amarelo")
    return (
      <TriangleAlert className="h-3.5 w-3.5 inline text-amber-600 dark:text-amber-400" />
    );
  return (
    <CircleAlert className="h-3.5 w-3.5 inline text-red-600 dark:text-red-400" />
  );
}

function toneRow(status: "verde" | "amarelo" | "vermelho" | "neutro") {
  if (status === "vermelho") return "bg-red-500/5";
  if (status === "amarelo") return "bg-amber-500/5";
  if (status === "verde") return "bg-emerald-500/5";
  return "";
}

// ---------- componente principal ----------
export default function DREOrcada({
  companyId,
  tenantId,
  visao,
  colunas,
  isMultiAno,
  totalizarPorLabel,
  itens,
  orcadoPorItemCol,
  baseLabel,
  tolAmarelo,
  tolVermelho,
}: Props) {
  const [tratamento, setTratamento] = useState<TratamentoLacuna>("vazio");

  // ------------ periodos únicos (YYYY-MM) usados pelas colunas ------------
  const periodos = useMemo(() => {
    const s = new Set<string>();
    for (const c of colunas) {
      for (const m of c.meses) {
        s.add(`${c.ano}-${String(m).padStart(2, "0")}`);
      }
    }
    return Array.from(s).sort();
  }, [colunas]);

  // ------------ meta (modoGlobal) ------------
  const metaQ = useQuery({
    queryKey: ["dre-orcada-meta", companyId, tenantId],
    enabled: !!companyId && !!tenantId,
    queryFn: () => getCompanyMeta(companyId, tenantId),
  });
  const modoGlobal = metaQ.data?.modoGlobal ?? false;

  // ------------ mascara ------------
  const mascaraQ = useQuery({
    queryKey: ["dre-orcada-mascara", tenantId, companyId],
    enabled: !!tenantId && !!companyId,
    queryFn: () => getMascaraConfig({ tenantId, companyId }),
  });

  // ------------ mapeamento DRE ------------
  const mapaQ = useQuery({
    queryKey: ["dre-orcada-mapa", tenantId, companyId, modoGlobal],
    enabled: !!tenantId && !!companyId && metaQ.isFetched,
    queryFn: () => fetchMapaDRE(companyId, tenantId, modoGlobal),
  });

  // ------------ realizado (motor da DRE) ------------
  const realizadoQ = useQuery({
    queryKey: [
      "dre-orcada-realizado",
      companyId,
      tenantId,
      modoGlobal,
      visao,
      periodos.join(","),
    ],
    enabled:
      !!companyId &&
      !!tenantId &&
      metaQ.isFetched &&
      periodos.length > 0,
    queryFn: () =>
      buildStatementFromDiario(
        companyId,
        tenantId,
        modoGlobal,
        "DRE",
        periodos,
        visao,
      ) as Promise<FlatRow[]>,
  });

  // ------------ mapeia cada item → linha da DRE ------------
  const itemLinha = useMemo(() => {
    const map: Record<string, string | null> = {};
    if (!mapaQ.data || !mascaraQ.data) return map;
    const matcher = buildMatcher(mapaQ.data, mascaraQ.data);
    for (const it of itens) {
      let linha: string | null = null;
      for (const c of it.contas) {
        const m = matcher(c);
        if (m) {
          linha = m.linha_demonstracao;
          break;
        }
      }
      map[it.id] = linha;
    }
    return map;
  }, [mapaQ.data, mascaraQ.data, itens]);

  // ------------ linhas ordenadas do DRE mapeado ------------
  const linhasMapeadas = useMemo(() => {
    if (!mapaQ.data) return [] as { linha: string; ordem: number }[];
    const meta = new Map<string, number>();
    for (const m of mapaQ.data) {
      const prev = meta.get(m.linha_demonstracao);
      if (prev === undefined || m.ordem < prev) meta.set(m.linha_demonstracao, m.ordem);
    }
    return Array.from(meta.entries())
      .map(([linha, ordem]) => ({ linha, ordem }))
      .sort((a, b) => a.ordem - b.ordem);
  }, [mapaQ.data]);

  // ------------ orcado por linha × coluna ------------
  const orcadoLinhaCol = useMemo(() => {
    // Map<linha, (number|null)[]>
    const out = new Map<string, (number | null)[]>();
    for (const { linha } of linhasMapeadas) {
      out.set(linha, colunas.map(() => null));
    }
    for (const it of itens) {
      const linha = itemLinha[it.id];
      if (!linha) continue;
      const cells = orcadoPorItemCol[it.id];
      if (!cells) continue;
      const arr = out.get(linha) ?? colunas.map(() => null);
      cells.forEach((v, idx) => {
        if (v === null || v === undefined) return;
        const cur = arr[idx];
        arr[idx] = (cur ?? 0) + v;
      });
      out.set(linha, arr);
    }
    return out;
  }, [linhasMapeadas, colunas, itens, itemLinha, orcadoPorItemCol]);

  // ------------ realizado por linha × coluna ------------
  const realizadoLinhaCol = useMemo(() => {
    // Chave = descricao (linha mapeada OU subtotal calculado)
    const out = new Map<string, number[]>();
    if (!realizadoQ.data) return out;

    // Coleta valor por (descricao, periodo) considerando nivel === 0
    // (header da linha mapeada) OU is_subtotal true para os "(=)".
    const porDescPeriodo = new Map<string, number>();
    for (const r of realizadoQ.data) {
      if (r.nivel !== 0) continue;
      porDescPeriodo.set(`${r.descricao}|${r.periodo}`, r.valor);
    }

    const addLinha = (linha: string) => {
      const arr = colunas.map((col) => {
        let s = 0;
        for (const m of col.meses) {
          const ym = `${col.ano}-${String(m).padStart(2, "0")}`;
          s += porDescPeriodo.get(`${linha}|${ym}`) ?? 0;
        }
        return s;
      });
      out.set(linha, arr);
    };
    for (const { linha } of linhasMapeadas) addLinha(linha);
    for (const sub of SUBTOTAIS) addLinha(sub.linha);
    return out;
  }, [realizadoQ.data, linhasMapeadas, colunas]);

  // ------------ resolve orçado da linha aplicando tratamento ------------
  const orcadoResolvidoLinhaCol = useMemo(() => {
    // Map<linha, (number|null)[]>
    const out = new Map<string, (number | null)[]>();
    for (const { linha } of linhasMapeadas) {
      const bruto = orcadoLinhaCol.get(linha) ?? colunas.map(() => null);
      const real = realizadoLinhaCol.get(linha) ?? colunas.map(() => 0);
      out.set(
        linha,
        bruto.map((v, i) => {
          if (v !== null) return v;
          if (tratamento === "zero") return 0;
          if (tratamento === "realizado") return real[i] ?? 0;
          return null;
        }),
      );
    }
    return out;
  }, [linhasMapeadas, orcadoLinhaCol, realizadoLinhaCol, colunas, tratamento]);

  // ------------ orcado dos subtotais ------------
  const orcadoSubtotais = useMemo(() => {
    const out = new Map<string, (number | null)[]>();
    // Cria uma função v(linha)[i] a partir de out e orcadoResolvidoLinhaCol
    const getLinhaCol = (linha: string, i: number): number | null => {
      if (out.has(linha)) return out.get(linha)![i];
      const arr = orcadoResolvidoLinhaCol.get(linha);
      return arr ? arr[i] : null;
    };
    for (const sub of SUBTOTAIS) {
      const arr = colunas.map((_, i) => sub.calc((l) => getLinhaCol(l, i)));
      out.set(sub.linha, arr);
    }
    return out;
  }, [orcadoResolvidoLinhaCol, colunas]);

  // ------------ ordem final: linhas mapeadas + subtotais intercalados ------------
  const linhasFinais = useMemo(() => {
    const all: { linha: string; ordem: number; isSubtotal: boolean }[] = [];
    for (const { linha, ordem } of linhasMapeadas) {
      all.push({ linha, ordem: ordem * 1000, isSubtotal: false });
    }
    for (const sub of SUBTOTAIS) {
      all.push({ linha: sub.linha, ordem: sub.ordem, isSubtotal: true });
    }
    return all.sort((a, b) => a.ordem - b.ordem);
  }, [linhasMapeadas]);

  // ------------ valores agregados ------------
  const getOrcCol = (linha: string, i: number): number | null => {
    if (orcadoSubtotais.has(linha)) return orcadoSubtotais.get(linha)![i];
    return orcadoResolvidoLinhaCol.get(linha)?.[i] ?? null;
  };
  const getRealCol = (linha: string, i: number): number =>
    realizadoLinhaCol.get(linha)?.[i] ?? 0;

  // Totais (soma das colunas)
  const totalOrc = (linha: string): number | null => {
    let s = 0;
    let alguma = false;
    colunas.forEach((_, i) => {
      const v = getOrcCol(linha, i);
      if (v !== null) {
        s += v;
        alguma = true;
      }
    });
    return alguma ? s : null;
  };
  const totalReal = (linha: string): number => {
    let s = 0;
    colunas.forEach((_, i) => (s += getRealCol(linha, i)));
    return s;
  };

  // ------------ Aviso: linhas sem orçamento ------------
  const linhasSemOrcamento = useMemo(() => {
    const out: string[] = [];
    for (const { linha } of linhasMapeadas) {
      const bruto = orcadoLinhaCol.get(linha);
      if (!bruto) continue;
      const algum = bruto.some((v) => v !== null);
      if (!algum) out.push(linha);
    }
    return out;
  }, [linhasMapeadas, orcadoLinhaCol]);

  // ------------ Lucro Líquido card ------------
  const lucroOrc = totalOrc("(=) Lucro Líquido do Exercício");
  const lucroReal = totalReal("(=) Lucro Líquido do Exercício");
  const lucroVar = lucroOrc !== null ? lucroReal - lucroOrc : null;
  const lucroVarPct =
    lucroOrc !== null && lucroOrc !== 0
      ? ((lucroReal - lucroOrc) / Math.abs(lucroOrc)) * 100
      : null;

  const carregando =
    metaQ.isLoading ||
    mascaraQ.isLoading ||
    mapaQ.isLoading ||
    realizadoQ.isLoading;

  return (
    <div className="space-y-4">
      {/* Cabeçalho de configuração */}
      <Card className="p-4 flex flex-wrap items-end gap-4">
        <div className="min-w-[220px]">
          <Label className="text-xs text-muted-foreground">
            Linhas sem orçamento
          </Label>
          <Select
            value={tratamento}
            onValueChange={(v) => setTratamento(v as TratamentoLacuna)}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vazio">Mostrar como "—" (parcial)</SelectItem>
              <SelectItem value="zero">Considerar como zero</SelectItem>
              <SelectItem value="realizado">Considerar igual ao realizado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="text-xs text-muted-foreground max-w-md">
          <b>Base:</b> {baseLabel}. Visão do realizado:{" "}
          <b>{visao === "gerencial" ? "Gerencial" : "Contábil"}</b>. As linhas
          da DRE são resolvidas automaticamente a partir das contas dos itens
          via mapeamento da empresa.
        </div>
      </Card>

      {/* Card do Lucro Líquido projetado */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Lucro Líquido Orçado</div>
          <div className="text-2xl font-semibold">
            {lucroOrc === null ? "—" : formatBRL(lucroOrc)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {lucroOrc === null ? "sem orçamento suficiente" : "com base selecionada"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Lucro Líquido Realizado</div>
          <div className="text-2xl font-semibold">{formatBRL(lucroReal)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Variação R$</div>
          <div
            className={cn(
              "text-2xl font-semibold",
              lucroVar === null
                ? "text-muted-foreground"
                : lucroVar >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400",
            )}
          >
            {lucroVar === null ? "—" : formatBRL(lucroVar)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Variação %</div>
          <div
            className={cn(
              "text-2xl font-semibold",
              lucroVarPct === null
                ? "text-muted-foreground"
                : lucroVarPct >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400",
            )}
          >
            {lucroVarPct === null
              ? "—"
              : `${lucroVarPct.toFixed(1).replace(".", ",")}%`}
          </div>
        </Card>
      </div>

      {/* Aviso de linhas sem orçamento */}
      {tratamento === "vazio" && linhasSemOrcamento.length > 0 && (
        <div className="text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5 px-1">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            <b>{linhasSemOrcamento.length} linha(s) da DRE</b> sem orçamento
            definido — subtotais podem ser parciais.{" "}
            <span className="text-muted-foreground">
              Linhas: {linhasSemOrcamento.join(", ")}
            </span>
          </div>
        </div>
      )}

      {/* Grade DRE */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-sm border-separate border-spacing-0 min-w-full">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th
                  className="text-left px-3 py-2 font-medium sticky left-0 bg-muted/60 z-10 border-r border-border min-w-[240px]"
                  rowSpan={2}
                >
                  Linha da DRE
                </th>
                {colunas.map((c) => (
                  <th
                    key={c.key}
                    colSpan={4}
                    className="text-center px-2 py-1.5 font-semibold border-l border-border"
                  >
                    {c.label}
                    {!isMultiAno && totalizarPorLabel !== "Mês" && c.meses.length > 1 && (
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground/70">
                        ({c.meses.map((m) => MONTHS.find((x) => x.m === m)?.label).join("·")})
                      </span>
                    )}
                  </th>
                ))}
                <th
                  colSpan={4}
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
                    <th className="text-right px-2 py-1 font-normal text-[10px]">Var%</th>
                    <th className="text-center px-2 py-1 font-normal text-[10px]">•</th>
                  </Fragment>
                ))}
                <th className="text-right px-2 py-1 font-normal border-l-2 border-border bg-primary/5 text-[10px]">
                  Orç
                </th>
                <th className="text-right px-2 py-1 font-normal bg-primary/5 text-[10px]">Real</th>
                <th className="text-right px-2 py-1 font-normal bg-primary/5 text-[10px]">Var%</th>
                <th className="text-center px-2 py-1 font-normal bg-primary/5 text-[10px]">•</th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr>
                  <td
                    colSpan={1 + colunas.length * 4 + 4}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    Calculando DRE orçada…
                  </td>
                </tr>
              ) : (
                linhasFinais.map((info) => {
                  const isSemOrc =
                    !info.isSubtotal &&
                    linhasSemOrcamento.includes(info.linha) &&
                    tratamento === "vazio";
                  const tOrc = totalOrc(info.linha);
                  const tReal = totalReal(info.linha);
                  const tVarP =
                    tOrc !== null && tOrc !== 0
                      ? ((tReal - tOrc) / Math.abs(tOrc)) * 100
                      : null;
                  const tStatus = calcStatusReceita(
                    info.linha,
                    tOrc,
                    tReal,
                    tolAmarelo,
                    tolVermelho,
                  );
                  return (
                    <tr
                      key={info.linha}
                      className={cn(
                        "border-t border-border",
                        info.isSubtotal && "font-semibold bg-muted/30",
                        isSemOrc && "text-muted-foreground",
                      )}
                    >
                      <td className="px-3 py-2 sticky left-0 bg-background border-r border-border z-10">
                        <div className="flex items-center gap-2">
                          <span className={cn(info.isSubtotal && "font-semibold")}>
                            {info.linha}
                          </span>
                          {isSemOrc && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0">
                              não orçada
                            </Badge>
                          )}
                        </div>
                      </td>
                      {colunas.map((_, i) => {
                        const orc = getOrcCol(info.linha, i);
                        const real = getRealCol(info.linha, i);
                        const varP =
                          orc !== null && orc !== 0
                            ? ((real - orc) / Math.abs(orc)) * 100
                            : null;
                        const status = calcStatusReceita(
                          info.linha,
                          orc,
                          real,
                          tolAmarelo,
                          tolVermelho,
                        );
                        return (
                          <Fragment key={`c-${i}`}>
                            <td
                              className={cn(
                                "text-right px-2 py-1.5 border-l border-border/60 tabular-nums",
                                toneRow(status),
                              )}
                            >
                              {orc === null ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                formatBRL(orc)
                              )}
                            </td>
                            <td
                              className={cn(
                                "text-right px-2 py-1.5 tabular-nums",
                                toneRow(status),
                              )}
                            >
                              {formatBRL(real)}
                            </td>
                            <td
                              className={cn(
                                "text-right px-2 py-1.5 tabular-nums text-[11px]",
                                toneRow(status),
                              )}
                            >
                              {varP === null
                                ? "—"
                                : `${varP > 0 ? "+" : ""}${varP.toFixed(1).replace(".", ",")}%`}
                            </td>
                            <td
                              className={cn(
                                "text-center px-2 py-1.5",
                                toneRow(status),
                              )}
                            >
                              <StatusPill status={status} />
                            </td>
                          </Fragment>
                        );
                      })}
                      {/* TOTAL */}
                      <td
                        className={cn(
                          "text-right px-2 py-1.5 border-l-2 border-border bg-primary/5 tabular-nums",
                        )}
                      >
                        {tOrc === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          formatBRL(tOrc)
                        )}
                      </td>
                      <td className="text-right px-2 py-1.5 bg-primary/5 tabular-nums">
                        {formatBRL(tReal)}
                      </td>
                      <td className="text-right px-2 py-1.5 bg-primary/5 tabular-nums text-[11px]">
                        {tVarP === null
                          ? "—"
                          : `${tVarP > 0 ? "+" : ""}${tVarP.toFixed(1).replace(".", ",")}%`}
                      </td>
                      <td className="text-center px-2 py-1.5 bg-primary/5">
                        <StatusPill status={tStatus} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
