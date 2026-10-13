// Comparativo entre as empresas a que o usuário tem acesso (ex.: sócio de
// várias empresas). Reusa o mesmo cálculo da tabela de Índices do dashboard.
import { createFileRoute } from "@tanstack/react-router";
import { usePersistente } from "@/hooks/use-persistente";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFilters } from "@/components/filter-bar";
import { useMyCompanies } from "@/hooks/use-financial-data";
import { useVisaoGerencial } from "@/hooks/use-visao-gerencial";
import {
  useIndicadorData, useDemoValues, useEstruturaPadrao, criarResolverLinha, isCtxPair, isDemoPair,
} from "@/hooks/use-indicador-data";
import type { ResolverLinha } from "@/lib/indicadores/engine";
import {
  INDICES_DASHBOARD, formatarIndice, rotuloMes, ROTULO_BASE_RECEITA,
  type BaseReceita, type BasesIndice,
} from "@/lib/dashboard/indices-financeiros";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/comparativo-empresas")({
  head: () => ({
    meta: [
      { title: "Consolidado Empresas — Orkestria BI" },
      { name: "description", content: "Compare os índices financeiros de todas as suas empresas em uma só tela." },
      { property: "og:title", content: "Consolidado Empresas — Orkestria BI" },
      { property: "og:description", content: "Índices financeiros lado a lado, no último mês, acumulado dos meses selecionados ou do ano." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

type Modo = "mes" | "sel" | "ano";
const MODOS: { id: Modo; label: string }[] = [
  { id: "mes", label: "Último mês" },
  { id: "sel", label: "Acumulado meses selecionados" },
  { id: "ano", label: "Acumulado do ano" },
];

type Bases = Record<string, BasesIndice>; // periodo -> bases

// Contas de resultado somam no período; contas de balanço usam o último mês.
function acumular(bs: BasesIndice[], base: BaseReceita): BasesIndice | null {
  if (!bs.length) return null;
  const u = bs[bs.length - 1]!;
  const soma = (k: keyof BasesIndice) => bs.reduce((a, b) => a + (Number(b[k]) || 0), 0);
  return { ...u, lucroBruto: soma("lucroBruto"), ebitda: soma("ebitda"), lucroLiquido: soma("lucroLiquido"),
    receitaLiquida: soma("receitaLiquida"), receitaBruta: soma("receitaBruta"), baseReceita: base };
}

const MARGENS = new Set(["margBruta", "margEbitda", "margLiq"]);
const LINHAS = INDICES_DASHBOARD.map((d) => ({ def: d, label: d.label, id: d.key }));
void MARGENS;

const n = (v: number | null | undefined) => Number(v) || 0;
function basesDe(r: ResolverLinha, p: string, base: BaseReceita): BasesIndice {
  return {
    ac: n(r("ATIVO_CIRCULANTE", p)), pc: n(r("PASSIVO_CIRCULANTE", p)),
    estoques: n(r("ESTOQUES", p)), disponivel: n(r("DISPONIVEL", p)),
    emprestimos: n(r("EMPRESTIMOS", p)), pl: n(r("PATRIMONIO_LIQUIDO", p)),
    lucroBruto: n(r("LUCRO_BRUTO", p)), ebitda: n(r("EBITDA", p)),
    lucroLiquido: n(r("LUCRO_LIQUIDO", p)), receitaLiquida: n(r("RECEITA_LIQUIDA", p)),
    receitaBruta: n(r("RECEITA_BRUTA", p)), baseReceita: base,
  };
}

function janela(ultimo: string, modo: Modo, selecionados: string[]): string[] {
  if (modo === "sel") return selecionados;
  if (modo === "mes") return [ultimo];
  const ano = Number(ultimo.slice(0, 4));
  const mes = Number(ultimo.slice(5, 7));
  let ini = mes;
  if (modo === "ano") ini = 1;
  const out: string[] = [];
  for (let m = ini; m <= mes; m++) out.push(`${ano}-${String(m).padStart(2, "0")}-01`);
  return out;
}

function Page() {
  const { periodos } = useFilters();
  const { visao } = useVisaoGerencial();
  const visaoCalc = visao === "comparativo" ? "contabil" : visao;
  const { data: companies } = useMyCompanies();
  const [modo, setModo] = usePersistente<Modo>("consolidado:modo2", "sel");
  const [base, setBase] = usePersistente<BaseReceita>("consolidado:base", "RL");
  const [res, setRes] = useState<Record<string, Bases | "loading">>({});

  const selecionados = useMemo(() => [...periodos].sort(), [periodos]);
  const ultimo = selecionados[selecionados.length - 1];
  const meses = useMemo(() => (ultimo ? janela(ultimo, modo, selecionados) : []), [ultimo, modo, selecionados]);
  const buscar = useMemo(
    () => Array.from(new Set([...selecionados, ...(ultimo ? janela(ultimo, "ano", []) : [])])).sort(),
    [selecionados, ultimo],
  );

  const report = useCallback((id: string, v: Bases | "loading") => {
    setRes((prev) => (prev[id] === v ? prev : { ...prev, [id]: v }));
  }, []);

  const lista = companies ?? [];
  const valor = (cid: string, linha: (typeof LINHAS)[number]): number | null => {
    const r = res[cid];
    if (!r || r === "loading") return null;
    const ag = acumular(meses.map((p) => r[p]).filter((x): x is BasesIndice => !!x), base);
    return ag ? linha.def.compute(ag) : null;
  };

  const rotuloPeriodo = !ultimo
    ? "Selecione os meses"
    : meses.length <= 1
      ? rotuloMes(ultimo, true)
      : `${rotuloMes(meses[0]!, true)} a ${rotuloMes(meses[meses.length - 1]!, true)} (acumulado de ${meses.length} meses)`;

  return (
    <div className="space-y-4">
      {lista.map((c) => (
        <Calculadora key={c.id} companyId={c.id} tenantId={(c as any).tenant_id}
          periodos={buscar} visao={visaoCalc} onResult={report} />
      ))}
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Consolidado de empresas</h2>
        <p className="text-sm text-muted-foreground">{rotuloPeriodo} · margens sobre a {ROTULO_BASE_RECEITA[base]}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-md border p-0.5">
          {MODOS.map((m) => (
            <button key={m.id} type="button" onClick={() => setModo(m.id)}
              className={cn("px-2.5 py-1 rounded text-xs font-medium",
                modo === m.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-md border p-0.5">
          {(["RB", "RL"] as BaseReceita[]).map((b) => (
            <button key={b} type="button" onClick={() => setBase(b)}
              className={cn("px-2.5 py-1 rounded text-xs font-medium",
                base === b ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
              {b}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-max min-w-full text-sm border-collapse">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-4 py-2.5 sticky left-0 z-10 bg-muted">Indicador</th>
              {lista.map((c) => (
                <th key={c.id} className="text-right text-xs font-medium text-muted-foreground px-3 py-2.5 max-w-[11rem] min-w-[8rem]">
                  {c.name}
                  {res[c.id] === "loading" && <div className="text-[10px] font-normal">calculando…</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LINHAS.map((linha, i) => (
              <tr key={linha.id} className={cn("border-b border-border/60", linha.def.key === "resultado" && "font-semibold bg-muted/40", i % 2 === 1 && "bg-muted/20")}>
                <td className="px-4 py-2 sticky left-0 z-10 bg-card font-medium whitespace-nowrap">{linha.label}</td>
                {lista.map((c) => (
                  <td key={c.id} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {formatarIndice(valor(c.id, linha), linha.def.formato)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Resultado, Lucro Bruto, EBITDA e receitas somam os meses do período; as margens são calculadas sobre esse total (RB ou RL, conforme o botão). Os índices de balanço (liquidez, caixa, dívida, endividamento) são do último mês.
      </p>
    </div>
  );
}

function Calculadora({ companyId, tenantId, periodos, visao, onResult }: {
  companyId: string; tenantId: string; periodos: string[]; visao: "contabil" | "gerencial";
  onResult: (id: string, v: Bases | "loading") => void;
}) {
  const { data: ctxRaw, isLoading: l1 } = useIndicadorData(tenantId, companyId, visao);
  const { data: demoRaw, isLoading: l2 } = useDemoValues(tenantId, companyId, periodos, visao);
  const { data: estrutura } = useEstruturaPadrao();
  const ctx = ctxRaw ? (isCtxPair(ctxRaw) ? (visao === "gerencial" ? ctxRaw.gerencial : ctxRaw.contabil) : ctxRaw) : undefined;
  const demo = demoRaw ? (isDemoPair(demoRaw) ? (visao === "gerencial" ? demoRaw.gerencial : demoRaw.contabil) : demoRaw) : undefined;

  const valores = useMemo(() => {
    if (!ctx) return null;
    const r = criarResolverLinha(ctx, demo, estrutura);
    const out: Bases = {};
    for (const p of periodos) out[p] = basesDe(r, p, "RL");
    return out;
  }, [ctx, demo, estrutura, periodos]);

  useEffect(() => {
    onResult(companyId, l1 || l2 || !valores ? "loading" : valores);
  }, [companyId, l1, l2, valores, onResult]);
  return null;
}
