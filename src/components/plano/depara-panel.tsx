// DE-PARA — Outro sistema -> Plano Padrão do escritório.
//
// A fila vem do movimento (diário/saldos) e das contas de origem
// carregadas do arquivo do ERP. Cada escolha grava na hora e a tela
// confere no banco — o seletor preenchido sem persistir era o que
// fazia o de-para parecer pronto e a DRE continuar zerada.
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { lerTudo, countNaPrimeira } from "@/lib/supabase-paginado";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";
import { useContasDestino } from "@/hooks/use-contas-destino";
import { grupoDoDestino, grupoMaisFrequente, type ContaDestino } from "@/lib/contas/busca";
import { SeletorConta } from "@/components/contas/seletor-conta";
import { BarraDepara } from "@/components/contas/barra-depara";
import { CabecalhoGrupo } from "@/components/contas/grupo-depara";
import {
  filtrarLinhas, contarEstados, estadoDe,
  agruparPorClassificacao, agruparPorTipo, niveisDisponiveis, cortarGrupos,
  type FiltroEstado, type LinhaDepara,
} from "@/lib/contas/filtro-depara";
import { getMascaraConfig, MASCARA_DEFAULT, opcoesLotePorMascara, rotuloNivelMascara } from "@/lib/mascara/interpretar";
import { aplicarDeparaConfirmado, limparCacheDepara } from "@/lib/plano/depara";
import { Fragment } from "react";

import { DeParaArquivoCard } from "./depara-arquivo-card";

interface Props {
  tenantId: string;
  companyId: string;
  sistemaId?: string | null;
  readonly?: boolean;
}

interface Pendencia {
  codigo: string;
  classificacao: string;
  descricao: string;
  tipo: string;
  movimento: number;
  sugestao_codigo: string | null;
  sugestao_descricao: string | null;
}

interface Feito {
  conta_codigo: string;
  conta_padrao_codigo: string | null;
  ignorada: boolean;
  observacao: string | null;
  classificacao: string;
  descricao: string;
  tipo: string;
  movimento: number;
}

const IGNORAR = "__IGNORAR__";
/** Teto da fila. Alto de propósito, e a tela avisa se for atingido. */
const LIMITE_FILA = 3000;
/** Agrupa pelo tipo inferido (Ativo / Passivo / DRE), não pela máscara. */
const GRUPO_TIPO = 100;

function chaveNivelGrupo(companyId: string) {
  return `orkestria.depara.nivelGrupo.${companyId}`;
}

function lerNivelGrupo(companyId: string): number | null {
  try {
    const v = localStorage.getItem(chaveNivelGrupo(companyId));
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function gravarNivelGrupo(companyId: string, n: number) {
  try {
    localStorage.setItem(chaveNivelGrupo(companyId), String(n));
  } catch {
    /* private mode etc. */
  }
}

function tipoUnico(linhas: { tipo?: string | null }[]): string | undefined {
  const tipos = new Set(linhas.map((l) => l.tipo).filter(Boolean) as string[]);
  return tipos.size === 1 ? [...tipos][0] : undefined;
}

/** Só as contas que já estão no de-para — nunca o plano inteiro da empresa. */
const TAM_ORIGEM = 120;

async function nomesDasOrigens(companyId: string, codigos: string[]) {
  const uniq = [...new Set(codigos.filter(Boolean))];
  const porCod = new Map<string, {
    classificacao: string | null;
    descricao: string | null;
    tipo: string | null;
  }>();
  for (let i = 0; i < uniq.length; i += TAM_ORIGEM) {
    const fatia = uniq.slice(i, i + TAM_ORIGEM);
    const { data, error } = await supabase
      .from("plano_contas")
      .select("codigo, classificacao, descricao, tipo")
      .eq("company_id", companyId)
      .in("codigo", fatia);
    if (error) throw error;
    for (const o of data ?? []) {
      porCod.set(o.codigo, {
        classificacao: o.classificacao,
        descricao: o.descricao,
        tipo: o.tipo,
      });
    }
  }
  return porCod;
}

function DestinoDaLinha({
  linha,
  destinos,
  destinosPorCodigo,
  carregando,
  disabled,
  onEscolher,
  onIgnorar,
}: {
  linha: {
    descricao: string;
    classificacao: string;
    tipo: string;
    destino: string | null;
  };
  destinos: ContaDestino[];
  destinosPorCodigo: Map<string, ContaDestino>;
  carregando: boolean;
  disabled: boolean;
  onEscolher: (codigo: string | null) => void;
  onIgnorar: () => void;
}) {
  const [editar, setEditar] = useState(false);
  if (linha.destino && !editar) {
    const d = destinosPorCodigo.get(linha.destino);
    const rotulo = d
      ? `${d.classificacao ?? ""} · ${d.descricao ?? d.codigo}`
      : linha.destino;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditar(true)}
        className="flex-1 h-8 min-w-0 px-2 text-xs text-left truncate rounded-md border border-input bg-background hover:bg-accent disabled:opacity-50"
        title="Trocar o destino"
      >
        {rotulo}
      </button>
    );
  }
  return (
    <SeletorConta
      destinos={destinos}
      carregando={carregando}
      valor={linha.destino}
      tipo={linha.tipo}
      sugestaoGrupo={grupoDoDestino({
        descricao: linha.descricao,
        classificacao: linha.classificacao,
      })?.chave}
      onEscolher={onEscolher}
      onIgnorar={onIgnorar}
      permitirIgnorar
      disabled={disabled}
      compacto
      className="flex-1"
      placeholder="Selecione a conta destino"
      abrirAoMontar={editar}
    />
  );
}

export function DeParaPanel({ tenantId, companyId, sistemaId, readonly }: Props) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [filtro, setFiltro] = useState<FiltroEstado>("pendente");
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [limite, setLimite] = useState(150);
  const [nivelGrupo, setNivelGrupo] = useState<number | null>(() => lerNivelGrupo(companyId));

  useEffect(() => {
    setNivelGrupo(lerNivelGrupo(companyId));
  }, [companyId]);

  const { data: mascara = MASCARA_DEFAULT } = useQuery({
    queryKey: ["mascara-classificacao", tenantId, companyId],
    queryFn: () => getMascaraConfig({ tenantId, companyId }),
  });

  const { data: pendencias, isLoading, error: erroFila, isFetching } = useQuery({
    queryKey: ["depara-pendencias", companyId],
    placeholderData: keepPreviousData,
    retry: 1,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("depara_pendencias", {
        _company_id: companyId,
        _limite: LIMITE_FILA,
      });
      if (error) throw error;
      return (data ?? []) as Pendencia[];
    },
  });

  const { data: jaFeitos } = useQuery({
    queryKey: ["depara-feitos", companyId, "com-nome"],
    queryFn: async () => {
      const rows = await lerTudo<{
        conta_codigo: string;
        conta_padrao_codigo: string | null;
        ignorada: boolean;
        observacao: string | null;
      }>(
        (de, ate) => supabase
          .from("depara_contas")
          .select("conta_codigo, conta_padrao_codigo, ignorada, observacao", countNaPrimeira(de))
          .eq("company_id", companyId)
          .order("conta_codigo")
          .range(de, ate),
        "depara_contas",
      );
      const porCod = await nomesDasOrigens(companyId, rows.map((r) => r.conta_codigo));
      return rows.map((r): Feito => {
        const o = porCod.get(r.conta_codigo);
        return {
          ...r,
          classificacao: o?.classificacao ?? "",
          descricao: o?.descricao ?? r.conta_codigo,
          tipo: o?.tipo ?? "",
          movimento: 0,
        };
      });
    },
  });

  const { data: contasPadrao, isLoading: carregandoDestinos } = useContasDestino(tenantId);

  const destinosPorClassif = useMemo(() => {
    const m = new Map<string, ContaDestino>();
    for (const d of contasPadrao ?? []) {
      const k = (d.classificacao ?? "").trim();
      if (k && !m.has(k)) m.set(k, d);
    }
    return m;
  }, [contasPadrao]);

  const destinosPorCodigo = useMemo(() => {
    const m = new Map<string, ContaDestino>();
    for (const d of contasPadrao ?? []) m.set(d.codigo, d);
    return m;
  }, [contasPadrao]);

  interface LinhaPlano extends LinhaDepara {
    tipo: string;
    sugestao_codigo: string | null;
    sugestao_descricao: string | null;
  }

  const linhas = useMemo<LinhaPlano[]>(() => {
    const feitosPorCodigo = new Map((jaFeitos ?? []).map((f) => [f.conta_codigo, f]));
    const porCodigo = new Map<string, LinhaPlano>();

    const montar = (
      codigo: string,
      base: {
        classificacao: string;
        descricao: string;
        tipo: string;
        movimento: number;
        sugestao_codigo: string | null;
        sugestao_descricao: string | null;
      },
    ): LinhaPlano => {
      const esc = escolhas[codigo];
      const feito = feitosPorCodigo.get(codigo);
      const local = destinosPorClassif.get((base.classificacao ?? "").trim());
      const sugCodigo = base.sugestao_codigo || local?.codigo || null;
      const sugDesc = base.sugestao_descricao || local?.descricao || null;
      const ignorada = esc === IGNORAR || (!esc && !!feito?.ignorada);
      const destino = ignorada
        ? null
        : esc && esc !== ""
          ? esc
          : (feito?.conta_padrao_codigo ?? null);
      const temDecisao = ignorada || !!destino;
      return {
        codigo,
        descricao: base.descricao,
        classificacao: base.classificacao,
        movimento: Number(base.movimento) || 0,
        destino,
        ignorada,
        sugerido: !!sugCodigo && !temDecisao,
        tipo: base.tipo,
        sugestao_codigo: sugCodigo,
        sugestao_descricao: sugDesc,
      };
    };

    for (const p of pendencias ?? []) {
      porCodigo.set(p.codigo, montar(p.codigo, p));
    }
    for (const f of jaFeitos ?? []) {
      if (porCodigo.has(f.conta_codigo)) continue;
      porCodigo.set(f.conta_codigo, montar(f.conta_codigo, {
        classificacao: f.classificacao,
        descricao: f.descricao,
        tipo: f.tipo,
        movimento: f.movimento,
        sugestao_codigo: null,
        sugestao_descricao: null,
      }));
    }
    return [...porCodigo.values()];
  }, [pendencias, jaFeitos, escolhas, destinosPorClassif]);

  const contagem = useMemo(() => contarEstados(linhas), [linhas]);
  const visiveis = useMemo(
    () => filtrarLinhas(linhas, { estado: filtro, busca }),
    [linhas, filtro, busca],
  );
  const naTela = visiveis.slice(0, limite);
  const niveis = useMemo(() => niveisDisponiveis(linhas, mascara), [linhas, mascara]);
  const opcoesGrupo = useMemo(() => {
    const mask = opcoesLotePorMascara(mascara, niveis);
    const temTipo = linhas.some((l) => (l.tipo ?? "").trim());
    return [
      ...mask,
      ...(temTipo ? [{ valor: GRUPO_TIPO, rotulo: "Ativo / Passivo / DRE" }] : []),
    ];
  }, [mascara, niveis, linhas]);

  const nivelPadrao = useMemo(() => {
    if (opcoesGrupo.some((o) => o.valor === 2)) return 2;
    if (opcoesGrupo.some((o) => o.valor === 1)) return 1;
    if (opcoesGrupo.some((o) => o.valor === GRUPO_TIPO)) return GRUPO_TIPO;
    return 0;
  }, [opcoesGrupo]);
  const nivelUsado = useMemo(() => {
    const n = nivelGrupo ?? nivelPadrao;
    if (n === 0) return 0;
    if (opcoesGrupo.some((o) => o.valor === n)) return n;
    return nivelPadrao;
  }, [nivelGrupo, nivelPadrao, opcoesGrupo]);

  const escolherNivel = (n: number) => {
    setNivelGrupo(n);
    setLimite(150);
    gravarNivelGrupo(companyId, n);
  };

  const grupos = useMemo(() => {
    if (nivelUsado <= 0) return null;
    const todos = nivelUsado === GRUPO_TIPO
      ? agruparPorTipo(visiveis)
      : agruparPorClassificacao(visiveis, nivelUsado, mascara);
    return cortarGrupos(todos, limite);
  }, [visiveis, nivelUsado, limite, mascara]);

  const rotuloGrupo = nivelUsado === GRUPO_TIPO
    ? "Tipo"
    : rotuloNivelMascara(mascara, nivelUsado);

  const definirLocal = (codigos: string[], valor: string | null) =>
    setEscolhas((s) => {
      const n = { ...s };
      for (const c of codigos) n[c] = valor ?? "";
      return n;
    });

  const aposGravar = () => {
    limparCacheDepara(companyId);
    // Não espera a fila: se o refetch atrasar ou der timeout, o vínculo
    // já está no banco e a lista local já tirou as contas gravadas.
    void qc.invalidateQueries({ queryKey: ["depara-feitos", companyId] });
    void qc.invalidateQueries({ queryKey: ["depara-feitos-status", companyId] });
    void qc.invalidateQueries({ queryKey: ["depara-pendencias", companyId] });
    void qc.invalidateQueries({ queryKey: ["indic-engine-data"] });
    void qc.invalidateQueries({ queryKey: ["indic-demo-dre"] });
    void qc.invalidateQueries({ queryKey: ["monthly-stmt"] });
  };

  const persistir = async (
    itens: { conta_codigo: string; conta_padrao_codigo: string | null; ignorada?: boolean }[],
    rotulo: string,
  ) => {
    if (readonly || itens.length === 0) return;
    setSalvando(true);
    for (const it of itens) {
      definirLocal(
        [it.conta_codigo],
        it.ignorada ? IGNORAR : (it.conta_padrao_codigo ?? ""),
      );
    }
    try {
      const r = await aplicarDeparaConfirmado(
        companyId,
        itens.map((it) => ({
          ...it,
          observacao: `Outro sistema: ${rotulo}`,
        })),
      );
      const partes = [
        r.gravadas > 0 ? `${r.gravadas} vínculo(s) gravado(s)` : null,
        r.limpas > 0 ? `${r.limpas} limpo(s)` : null,
      ].filter(Boolean);
      toast.success(
        partes.length > 0
          ? `${partes.join(" · ")}. Confirmado no banco.`
          : "Nada a gravar — essas contas já estavam pendentes.",
      );
      const gravados = new Set(itens.map((it) => it.conta_codigo));
      const porLinha = new Map(linhas.map((l) => [l.codigo, l]));
      qc.setQueryData(["depara-pendencias", companyId], (old: Pendencia[] | undefined) => {
        const resto = (old ?? []).filter((p) => !gravados.has(p.codigo));
        const voltando: Pendencia[] = [];
        for (const it of itens) {
          if (it.ignorada || it.conta_padrao_codigo) continue;
          const l = porLinha.get(it.conta_codigo);
          if (!l) continue;
          voltando.push({
            codigo: l.codigo,
            classificacao: l.classificacao ?? "",
            descricao: l.descricao ?? l.codigo,
            tipo: l.tipo,
            movimento: l.movimento,
            sugestao_codigo: l.sugestao_codigo,
            sugestao_descricao: l.sugestao_descricao,
          });
        }
        return [...resto, ...voltando];
      });
      qc.setQueryData(["depara-feitos", companyId, "com-nome"], (old: Feito[] | undefined) => {
        const resto = (old ?? []).filter((d) => !gravados.has(d.conta_codigo));
        const novos: Feito[] = itens
          .filter((it) => it.ignorada || it.conta_padrao_codigo)
          .map((it) => {
            const l = porLinha.get(it.conta_codigo);
            return {
              conta_codigo: it.conta_codigo,
              conta_padrao_codigo: it.conta_padrao_codigo,
              ignorada: !!it.ignorada,
              observacao: `Outro sistema: ${rotulo}`,
              classificacao: l?.classificacao ?? "",
              descricao: l?.descricao ?? it.conta_codigo,
              tipo: l?.tipo ?? "",
              movimento: l?.movimento ?? 0,
            };
          });
        return [...novos, ...resto];
      });
      setEscolhas((s) => {
        const n = { ...s };
        for (const it of itens) delete n[it.conta_codigo];
        return n;
      });
      setMarcadas((s) => {
        const n = new Set(s);
        for (const it of itens) n.delete(it.conta_codigo);
        return n;
      });
      aposGravar();
    } catch (e: any) {
      for (const it of itens) definirLocal([it.conta_codigo], null);
      toast.error(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const vincularCodigos = (codigos: string[], destino: string | null, ignorar = false) =>
    persistir(
      codigos.map((conta_codigo) => ({
        conta_codigo,
        conta_padrao_codigo: ignorar ? null : destino,
        ignorada: ignorar,
      })),
      ignorar ? "ignorada" : destino ? "vínculo" : "limpo",
    );

  const alternarMarcada = (codigo: string) =>
    setMarcadas((s) => {
      const n = new Set(s);
      if (n.has(codigo)) n.delete(codigo); else n.add(codigo);
      return n;
    });

  const linhaDaConta = (p: LinhaPlano) => {
    const estado = estadoDe(p);
    const marcada = marcadas.has(p.codigo);
    return (
      <tr key={p.codigo}
        className={`border-t ${marcada ? "bg-primary/5" :
          estado === "pendente" ? "bg-amber-500/5" : ""}`}>
        <td className="pl-3 py-2">
          <Checkbox
            checked={marcada}
            onCheckedChange={() => alternarMarcada(p.codigo)}
            aria-label={`Selecionar ${p.codigo}`}
          />
        </td>
        <td className="px-3 py-2">
          <div className="font-medium">
            {p.descricao && p.descricao !== p.codigo
              ? p.descricao
              : <span className="italic text-muted-foreground">sem nome no arquivo</span>}
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {p.codigo}{p.classificacao && p.classificacao !== p.codigo ? ` · ${p.classificacao}` : ""}
          </div>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{formatBRL(Number(p.movimento))}</td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            {p.ignorada ? (
              <>
                <span className="text-xs text-muted-foreground italic flex-1">
                  não usada em demonstrações
                </span>
                <Button size="sm" variant="ghost" className="h-7 text-xs"
                  disabled={readonly || salvando}
                  onClick={() => vincularCodigos([p.codigo], null)}>
                  desfazer
                </Button>
              </>
            ) : (
              <DestinoDaLinha
                linha={p}
                destinos={contasPadrao ?? []}
                destinosPorCodigo={destinosPorCodigo}
                carregando={carregandoDestinos}
                disabled={readonly || salvando}
                onEscolher={(c) => vincularCodigos([p.codigo], c)}
                onIgnorar={() => vincularCodigos([p.codigo], null, true)}
              />
            )}
            {estado === "sugerido" && p.sugestao_codigo && (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 shrink-0 gap-1 text-[10px] px-2"
                disabled={readonly || salvando}
                title="Grava a sugestão agora"
                onClick={() => vincularCodigos([p.codigo], p.sugestao_codigo)}
              >
                <Sparkles className="h-2.5 w-2.5" />
                {p.sugestao_descricao || p.sugestao_codigo}
              </Button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  const alternarGrupo = (codigos: string[]) =>
    setMarcadas((s) => {
      const n = new Set(s);
      const todas = codigos.every((c) => n.has(c));
      for (const c of codigos) { if (todas) n.delete(c); else n.add(c); }
      return n;
    });

  const aceitarSugestoes = () => {
    const itens = visiveis
      .filter((l) => l.sugerido && l.sugestao_codigo)
      .map((l) => ({
        conta_codigo: l.codigo,
        conta_padrao_codigo: l.sugestao_codigo,
        ignorada: false,
      }));
    return persistir(itens, "sugestão aceita");
  };

  const pendentes = pendencias?.length ?? 0;
  const feitos = jaFeitos?.length ?? 0;
  const filaVazia = pendentes === 0 && feitos === 0;
  const completo = pendentes === 0 && feitos > 0;
  const sugestoesVisiveis = visiveis.filter((l) => l.sugerido && l.sugestao_codigo).length;

  return (
    <div className="space-y-4">
      <DeParaArquivoCard tenantId={tenantId} companyId={companyId} sistemaId={sistemaId ?? null} />
      <Card className={`p-4 ${completo ? "border-emerald-500/40 bg-emerald-500/5" : filaVazia ? "border-border" : "border-amber-500/40 bg-amber-500/5"}`}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            {completo
              ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              : <AlertTriangle className={`h-5 w-5 ${filaVazia ? "text-muted-foreground" : "text-amber-600"}`} />}
            <div>
              <div className="font-semibold">
                {completo
                  ? "De-para completo"
                  : filaVazia
                    ? "Fila vazia"
                    : `${pendentes} conta(s) sem vínculo com o Plano Padrão`}
              </div>
              <div className="text-xs text-muted-foreground">
                {completo
                  ? `${feitos} conta(s) gravada(s). Para corrigir um erro, abra Vinculadas, busque a conta e troque o destino — grava na hora.`
                  : filaVazia
                    ? "Importe o diário desta empresa ou carregue o arquivo do sistema acima — a fila usa o movimento e a origem do ERP, não o Plano Padrão."
                    : `${feitos} já gravada(s). Escolher ou trocar o destino grava na hora.`}
              </div>
            </div>
          </div>
          {(salvando || isFetching) && (
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {salvando ? "Gravando e conferindo…" : "Atualizando a fila…"}
            </div>
          )}
        </div>
      </Card>

      {erroFila && (pendencias?.length ?? 0) === 0 && (
        <p className="text-sm text-destructive">
          Não deu para montar a fila: {(erroFila as Error).message}
        </p>
      )}

      {(pendentes > 0 || feitos > 0) && (
        <>
          <BarraDepara
            contagem={contagem}
            estado={filtro}
            onEstado={(e) => { setFiltro(e); setLimite(150); }}
            busca={busca}
            onBusca={(b) => { setBusca(b); setLimite(150); }}
            visiveis={visiveis.length}
            selecionadas={marcadas}
            onSelecionarVisiveis={() => {
              const codigos = grupos
                ? grupos.mostrando.flatMap((g) => g.linhas.map((l) => l.codigo))
                : naTela.map((l) => l.codigo);
              setMarcadas(new Set(codigos));
            }}
            onLimparSelecao={() => setMarcadas(new Set())}
              destinos={contasPadrao ?? []}
              origensSelecionadas={[...marcadas].map((codigo) => {
                const l = linhas.find((x) => x.codigo === codigo);
                return { codigo, descricao: l?.descricao };
              })}
              onVincularLote={(codigo) => vincularCodigos([...marcadas], codigo)}
            onIgnorarLote={() => vincularCodigos([...marcadas], null, true)}
            onLimparLote={() => vincularCodigos([...marcadas], null)}
            sugestoesVisiveis={sugestoesVisiveis}
            onAceitarSugestoes={aceitarSugestoes}
            nivelGrupo={nivelUsado}
            onNivelGrupo={escolherNivel}
            niveisDisponiveis={niveis}
            opcoesGrupo={opcoesGrupo}
            disabled={readonly || salvando}
          />

          {(pendencias?.length ?? 0) >= LIMITE_FILA && (
            <div className="text-xs text-amber-600">
              A fila está no teto de {LIMITE_FILA} contas — pode haver mais atrás.
              Grave estas e recarregue para ver o resto.
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {contagem.sugerido > 0 && (
              <Badge variant="outline" className="gap-1">
                <Sparkles className="h-3 w-3" />
                {contagem.sugerido} sugestão(ões) — aceite para gravar, ou troque o destino
              </Badge>
            )}
            {contagem.pendente > 0 && (
              <span>{contagem.pendente} sem sugestão, precisam de escolha</span>
            )}
            {contagem.vinculado > 0 && (
              <span>{contagem.vinculado} já vinculadas — abra o destino para corrigir</span>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : (
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="w-[34px]" />
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Conta da empresa</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">Movimento</th>
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground w-[380px]">Conta no Plano Padrão</th>
                  </tr>
                </thead>
                <tbody>
                  {grupos
                    ? grupos.mostrando.map((g) => (
                        <Fragment key={g.prefixo || "(sem)"}>
                          <CabecalhoGrupo
                            prefixo={g.prefixo}
                            rotuloNivel={rotuloGrupo}
                            quantidade={g.linhas.length}
                            pendentes={g.pendentes}
                            movimento={g.movimento}
                            marcado={g.linhas.every((l) => marcadas.has(l.codigo))}
                            onAlternar={() => alternarGrupo(g.linhas.map((l) => l.codigo))}
                            destinos={contasPadrao ?? []}
                            carregandoDestinos={carregandoDestinos}
                            tipo={tipoUnico(g.linhas)}
                            sugestaoGrupo={grupoMaisFrequente(g.linhas)}
                            origens={g.linhas.map((l) => ({ codigo: l.codigo, descricao: l.descricao }))}
                            onVincularGrupo={(cod) => vincularCodigos(g.linhas.map((l) => l.codigo), cod)}
                            onIgnorarGrupo={() => vincularCodigos(g.linhas.map((l) => l.codigo), null, true)}
                            disabled={readonly || salvando}
                            colSpan={3}
                          />
                          {g.linhas.map(linhaDaConta)}
                        </Fragment>
                      ))
                    : naTela.map(linhaDaConta)}
                  {naTela.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">
                        {completo && filtro === "pendente"
                          ? "Nada pendente. Abra Vinculadas se precisar corrigir um destino já gravado."
                          : "Nenhuma conta neste filtro."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {visiveis.length > naTela.length && (
                <button type="button"
                  className="w-full border-t py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  onClick={() => setLimite((l) => l + 300)}>
                  Mostrar mais {Math.min(300, visiveis.length - naTela.length)} de{" "}
                  {visiveis.length - naTela.length} restantes
                </button>
              )}
            </Card>
          )}
        </>
      )}

    </div>
  );
}

