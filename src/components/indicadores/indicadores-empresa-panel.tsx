// O MONTADOR do que esta empresa vê.
//
// Antes esta tela era um editor completo: criar, duplicar, excluir e
// EDITAR A FÓRMULA de um indicador. Três problemas nisso, e o Georg
// apontou o primeiro:
//
//  1. A conta do indicador não é assunto de quem configura uma empresa.
//     O que se decide aqui é O QUE APARECE, não como se calcula.
//
//  2. Editar daqui um indicador GLOBAL mudava a fórmula de todos os
//     clientes do escritório, sem confirmação — o único sinal era um
//     `title` num badge.
//
//  3. Editar daqui uma CÓPIA LOCAL era pior: o diálogo montava o payload
//     com `indicador.company_id`, e a lista desta tela vem da RPC
//     `indicadores_da_empresa`, que NÃO devolve `company_id`. O valor
//     virava `undefined ?? null` = NULL, e a cópia local da empresa
//     virava definição global. Na segunda empresa com o mesmo nome, o
//     usuário levava um erro cru de chave única do Postgres.
//     Os `as any` do caminho escondiam isso do TypeScript.
//
// Então: a definição vive no painel do escritório. Aqui se monta o
// dashboard — o que entra, em que ordem, e o que fica só na aba de
// indicadores. Com o VALOR de cada um à mostra, porque escolher sem ver
// o número é escolher no escuro.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2, Info, ArrowUp, ArrowDown, Plus, X, LayoutDashboard, ListChecks, Eye,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lerTudo } from "@/lib/supabase-paginado";
import {
  useIndicadoresDaEmpresa, alocarIndicadores, CHAVE_INDICADORES,
} from "@/hooks/use-indicadores-empresa";
import {
  aplicarModo, calcularSerie, formatarValor, destinosDe, visibilidadeDe,
  type IndicadorEmpresa, type Visibilidade,
} from "@/lib/indicadores/engine";
import {
  useIndicadorData, useDemoValues, criarResolverLinha, useEstruturaPadrao,
} from "@/hooks/use-indicador-data";
import { IndicadorEditorDialog } from "./indicador-editor-dialog";
import type { ContaPlanoItem } from "./conta-picker";

// ---------------------------------------------------------------
// A visibilidade tem 4 valores no banco, mas são 2 decisões
// independentes. Tratar como duas caixas é o que torna a tela um
// montador em vez de um formulário.
// ---------------------------------------------------------------
type Destinos = { dashboard: boolean; aba: boolean };

export { destinosDe, visibilidadeDe };

const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function IndicadoresEmpresaPanel({
  tenantId,
  companyId,
}: {
  tenantId: string;
  companyId: string;
}) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editando, setEditando] = useState<IndicadorEmpresa | null>(null);

  const { data: efetivos, isLoading } = useIndicadoresDaEmpresa(companyId);
  const indicadores = (efetivos ?? []) as unknown as (IndicadorEmpresa & {
    escopo?: string; ordem?: number | null;
  })[];

  // O VALOR, não a fórmula. É o que permite decidir se vale a pena
  // ocupar espaço no dashboard com aquele indicador.
  const { data: ctxRaw } = useIndicadorData(tenantId, companyId);
  const ctx = ctxRaw as import("@/lib/indicadores/engine").EngineContext | undefined;
  const periodos = useMemo(() => (ctx?.periodosDisponiveis ?? []).slice(-3), [ctx]);
  const { data: demoDreRaw } = useDemoValues(tenantId, companyId, periodos);
  const demoDre = demoDreRaw as import("@/lib/indicadores/linhas").DemoDre | undefined;
  const { data: estruturaPadrao } = useEstruturaPadrao();
  const { data: plano } = useQuery({
    queryKey: ["indic-plano-padrao", tenantId],
    queryFn: async () => {
      return await lerTudo<ContaPlanoItem>(
        (de, ate) => supabase
          .from("plano_contas")
          .select("classificacao, descricao, is_sintetica, is_participante, nivel, codigo")
          .eq("tenant_id", tenantId)
          .is("company_id", null)
          .eq("is_participante", false)
          .order("classificacao")
          .range(de, ate),
        "plano_contas (indicadores)",
      );
    },
  });
  const resolver = useMemo(
    () => criarResolverLinha(ctx, demoDre, estruturaPadrao),
    [ctx, demoDre, estruturaPadrao],
  );

  const valorDe = useMemo(() => {
    const cache = new Map<string, string>();
    return (ind: IndicadorEmpresa) => {
      if (!ctx || periodos.length === 0) return null;
      const achado = cache.get(ind.id);
      if (achado !== undefined) return achado;
      try {
        const serie = aplicarModo(
          calcularSerie(ind, periodos, ctx, resolver), ind.modo_analise).serie;
        const ultimo = serie[serie.length - 1];
        const txt = ultimo ? formatarValor(ultimo.valor, ind.modo_analise) : "—";
        cache.set(ind.id, txt);
        return txt;
      } catch {
        // Indicador com fórmula quebrada não pode derrubar o montador.
        return null;
      }
    };
  }, [ctx, periodos, resolver]);

  // ---------- listas ----------
  const noDashboard = useMemo(
    () => indicadores
      .filter((i) => destinosDe(i.visibilidade).dashboard)
      .sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome.localeCompare(b.nome)),
    [indicadores],
  );

  const disponiveis = useMemo(() => {
    const t = norm(busca).trim();
    return indicadores
      .filter((i) => !destinosDe(i.visibilidade).dashboard)
      .filter((i) => !t || norm(`${i.nome} ${i.categoria}`).includes(t))
      .sort((a, b) =>
        (a.categoria ?? "").localeCompare(b.categoria ?? "") || a.nome.localeCompare(b.nome));
  }, [indicadores, busca]);

  // ---------- gravação ----------
  const gravar = async (
    itens: { indicador_id: string; visibilidade: string; ordem?: number | null }[],
    nota: string,
  ) => {
    setSalvando(true);
    try {
      await alocarIndicadores(companyId, itens);
      toast.success(nota);
      qc.invalidateQueries({ queryKey: CHAVE_INDICADORES(companyId) });
    } catch (e: any) { toast.error(e.message); }
    finally { setSalvando(false); }
  };

  /**
   * Grava a ordem do dashboard INTEIRO junto com a mudança.
   *
   * Antes a alocação mandava só `{indicador_id, visibilidade}` e o
   * `indicador_alocar` faz `SET ordem = EXCLUDED.ordem` — ou seja,
   * gravava NULL por cima da ordem que existia. A ordem do dashboard se
   * perdia a cada clique de visibilidade.
   */
  const gravarComOrdem = (lista: typeof noDashboard, extras: typeof noDashboard = []) => {
    const itens = lista.map((i, n) => ({
      indicador_id: i.id,
      visibilidade: i.visibilidade as string,
      ordem: n + 1,
    }));
    for (const e of extras) {
      itens.push({ indicador_id: e.id, visibilidade: e.visibilidade as string, ordem: null as any });
    }
    return itens;
  };

  const mudarDestino = (ind: (typeof indicadores)[number], d: Destinos) => {
    const vis = visibilidadeDe(d);
    const alterado = { ...ind, visibilidade: vis };
    const nova = d.dashboard
      ? [...noDashboard.filter((i) => i.id !== ind.id), alterado]
      : noDashboard.filter((i) => i.id !== ind.id);
    const itens = gravarComOrdem(nova as any, d.dashboard ? [] : ([alterado] as any));
    return gravar(itens, `"${ind.nome}": ${ROTULO_VIS[vis]}.`);
  };

  const mover = (id: string, delta: number) => {
    const i = noDashboard.findIndex((x) => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= noDashboard.length) return;
    const nova = [...noDashboard];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    return gravar(gravarComOrdem(nova), "Ordem do dashboard salva.");
  };

  const lote = (lista: typeof disponiveis, d: Destinos) => {
    if (lista.length === 0) return;
    const vis = visibilidadeDe(d);
    const alterados = lista.map((i) => ({ ...i, visibilidade: vis }));
    const nova = d.dashboard ? [...noDashboard, ...alterados] : noDashboard;
    const itens = gravarComOrdem(nova as any, d.dashboard ? [] : (alterados as any));
    return gravar(itens, `${lista.length} indicador(es): ${ROTULO_VIS[vis]}.`);
  };

  const abrir = (ind: (typeof indicadores)[number]) => {
    setEditando(ind as IndicadorEmpresa);
    setEditorOpen(true);
  };

  const BotoesIndicador = ({ ind }: { ind: (typeof indicadores)[number] }) => (
    <Button size="sm" variant="ghost" className="h-7 text-xs"
      onClick={() => abrir(ind)} title="Visualizar definição (somente leitura)">
      <Eye className="h-3.5 w-3.5 mr-1" /> Ver
    </Button>
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (indicadores.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Nenhum indicador definido no escritório ainda. As definições ficam em{" "}
        <Link to="/admin/indicadores" className="underline font-medium">
          Configurações → Indicadores
        </Link>
        ; aqui você só aloca o que esta empresa vê.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 border-blue-500/30 bg-blue-500/5">
        <div className="flex gap-2 text-sm">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <strong>Alocação desta empresa.</strong>{" "}
            O plano padrão do escritório já calcula todos os indicadores.
            Aqui só se escolhe o que entra no <em>dashboard</em> e o que entra na
            <em>aba Indicadores</em>. Fórmulas se editam em{" "}
            <Link to="/admin/indicadores" className="underline">
              Configurações → Indicadores
            </Link>
            .
          </div>
        </div>
      </Card>

      {/* ---------- o dashboard, montado ---------- */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <LayoutDashboard className="h-3.5 w-3.5 text-muted-foreground" />
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            No dashboard do cliente ({noDashboard.length})
          </h4>
          <span className="text-[11px] text-muted-foreground ml-auto">
            a ordem aqui é a ordem na tela dele
          </span>
        </div>
        {noDashboard.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            O dashboard desta empresa está sem indicadores. Escolha abaixo.
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {noDashboard.map((ind, n) => (
                  <tr key={ind.id} className="border-t first:border-t-0">
                    <td className="pl-3 py-2 w-[52px] text-xs text-muted-foreground tabular-nums">
                      {n + 1}º
                    </td>
                    <td className="px-2 py-2">
                      <div className="font-medium">{ind.nome}</div>
                      <div className="text-[11px] text-muted-foreground">{ind.categoria}</div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-mono w-[120px]">
                      {valorDe(ind) ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-2 w-[190px]">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={destinosDe(ind.visibilidade).aba}
                          disabled={salvando}
                          onChange={(e) =>
                            mudarDestino(ind, { dashboard: true, aba: e.target.checked })}
                        />
                        aba Indicadores
                      </label>
                    </td>
                    <td className="px-2 py-2 w-[200px] text-right whitespace-nowrap">
                      <BotoesIndicador ind={ind} />
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                        disabled={salvando || n === 0} onClick={() => mover(ind.id, -1)}
                        title="Subir">
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                        disabled={salvando || n === noDashboard.length - 1}
                        onClick={() => mover(ind.id, 1)} title="Descer">
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        disabled={salvando}
                        onClick={() => mudarDestino(ind, {
                          dashboard: false, aba: destinosDe(ind.visibilidade).aba,
                        })}
                        title="Tirar do dashboard">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {/* ---------- o que ainda não está no dashboard ---------- */}
      <div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Disponíveis ({disponiveis.length})
          </h4>
          <Input
            className="h-7 text-xs max-w-[200px] ml-2"
            placeholder="Filtrar…"
            value={busca}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBusca(e.target.value)}
          />
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-7 text-xs"
              disabled={salvando || disponiveis.length === 0}
              onClick={() => lote(disponiveis, { dashboard: true, aba: true })}>
              Tudo em vista → dashboard
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs"
              disabled={salvando || disponiveis.length === 0}
              onClick={() => lote(disponiveis, { dashboard: false, aba: true })}>
              Só na aba
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs"
              disabled={salvando || disponiveis.length === 0}
              onClick={() => lote(disponiveis, { dashboard: false, aba: false })}>
              Esconder
            </Button>
          </div>
        </div>

        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {disponiveis.map((ind) => {
                const d = destinosDe(ind.visibilidade);
                return (
                  <tr key={ind.id} className="border-t first:border-t-0">
                    <td className="pl-3 px-2 py-2">
                      <div className="font-medium">{ind.nome}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {ind.categoria}
                        {ind.escopo === "empresa" && (
                          <Badge variant="outline" className="ml-1.5 text-[9px]">
                            cópia local
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-mono w-[120px]">
                      {valorDe(ind) ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-2 w-[190px]">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox" checked={d.aba} disabled={salvando}
                          onChange={(e) =>
                            mudarDestino(ind, { dashboard: false, aba: e.target.checked })}
                        />
                        aba Indicadores
                      </label>
                    </td>
                    <td className="px-2 py-2 w-[220px] text-right whitespace-nowrap">
                      <BotoesIndicador ind={ind} />
                      <Button size="sm" variant="ghost" className="h-7 text-xs"
                        disabled={salvando}
                        onClick={() => mudarDestino(ind, { dashboard: true, aba: d.aba })}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> dashboard
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {disponiveis.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {busca ? "Nenhum indicador com esse filtro." : "Todos já estão no dashboard."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      <IndicadorEditorDialog
        open={editorOpen}
        onOpenChange={(v) => {
          setEditorOpen(v);
          if (!v) setEditando(null);
        }}
        tenantId={tenantId}
        companyId={null}
        plano={plano ?? []}
        indicador={editando}
        somenteLeitura
        onSaved={() => {}}
      />
    </div>
  );
}

const ROTULO_VIS: Record<string, string> = {
  ambos: "no dashboard e na aba Indicadores",
  dashboard: "só no dashboard",
  indicadores: "só na aba Indicadores",
  invisivel: "escondido do cliente",
};
