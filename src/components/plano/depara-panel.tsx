// DE-PARA — plano de terceiro -> Plano Padrão do escritório.
//
// Configuração única por empresa. Entram na fila apenas as contas que
// TÊM MOVIMENTO, ordenadas pelo valor (maior primeiro), com sugestão
// automática vinda do banco. O fluxo esperado é: conferir as
// sugestões, aceitar tudo de uma vez, ajustar as poucas que sobraram.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { lerTudo } from "@/lib/supabase-paginado";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, CheckCircle2, Loader2, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";
import { useContasDestino } from "@/hooks/use-contas-destino";
import type { ContaDestino } from "@/lib/contas/busca";
import { SeletorConta } from "@/components/contas/seletor-conta";
import { BarraDepara } from "@/components/contas/barra-depara";
import { CabecalhoGrupo } from "@/components/contas/grupo-depara";
import {
  filtrarLinhas, contarEstados, estadoDe,
  agruparPorClassificacao, niveisDisponiveis,
  type FiltroEstado, type LinhaDepara,
} from "@/lib/contas/filtro-depara";
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

const IGNORAR = "__IGNORAR__";
/** Teto da fila. Alto de propósito, e a tela avisa se for atingido. */
const LIMITE_FILA = 3000;

export function DeParaPanel({ tenantId, companyId, sistemaId, readonly }: Props) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [filtro, setFiltro] = useState<FiltroEstado>("todas");
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  // Plano de terceiro grande não cabe todo na tela de uma vez.
  const [limite, setLimite] = useState(150);
  const [nivelGrupo, setNivelGrupo] = useState(0);

  const { data: pendencias, isLoading } = useQuery({
    queryKey: ["depara-pendencias", companyId],
    queryFn: async () => {
      // Era 500 e cortava em silêncio: um plano maior que isso ficava
      // com contas fora da fila sem ninguém saber. Agora o teto é alto e
      // a tela avisa quando encosta nele.
      const { data, error } = await supabase.rpc("depara_pendencias", {
        _company_id: companyId,
        _limite: LIMITE_FILA,
      });
      if (error) throw error;
      return (data ?? []) as Pendencia[];
    },
  });

  const { data: jaFeitos } = useQuery({
    queryKey: ["depara-feitos", companyId],
    queryFn: async () => {
      // Paginado: acima de 1.000 vínculos, as contas que ficavam de fora
      // voltavam a aparecer como pendentes mesmo já resolvidas.
      return await lerTudo<any>(
        (de, ate) => supabase
          .from("depara_contas")
          .select("conta_codigo, conta_padrao_codigo, ignorada, observacao")
          .eq("company_id", companyId)
          .order("conta_codigo")
          .range(de, ate),
        "depara_contas",
      );
    },
  });

  // Contas de destino do Plano Padrão — mesma consulta (e mesmo cache)
  // que o painel do ECD usa. Trazia TODAS as analíticas: num plano de
  // escritório são 135.000 linhas (99% clientes e fornecedores), o que
  // dava 136 idas ao servidor e um seletor impossível de usar. O destino
  // de um de-para é sempre uma conta da ESTRUTURA; cliente e fornecedor
  // entram pela conta agregadora, via regra em volume.
  const { data: contasPadrao, isLoading: carregandoDestinos } = useContasDestino(tenantId);

  // Pré-carrega as sugestões como escolha inicial (o usuário revisa e confirma).
  useEffect(() => {
    if (!pendencias) return;
    setEscolhas((prev) => {
      const next = { ...prev };
      for (const p of pendencias) {
        if (next[p.codigo] === undefined && p.sugestao_codigo) {
          next[p.codigo] = p.sugestao_codigo;
        }
      }
      return next;
    });
  }, [pendencias]);

  // A fila vira linhas de de-para: o "destino" é a escolha local ainda
  // não salva, e "sugerido" marca as que continuam com a sugestão
  // automática — é isso que separa o que você conferiu do que veio
  // pronto do banco.
  interface LinhaPlano extends LinhaDepara { tipo: string; sugestao_codigo: string | null }

  const linhas = useMemo<LinhaPlano[]>(() => {
    return (pendencias ?? []).map((p) => {
      const esc = escolhas[p.codigo];
      return {
        codigo: p.codigo,
        descricao: p.descricao,
        classificacao: p.classificacao,
        movimento: Number(p.movimento) || 0,
        destino: esc && esc !== IGNORAR ? esc : null,
        ignorada: esc === IGNORAR,
        sugerido: !!p.sugestao_codigo && esc === p.sugestao_codigo,
        tipo: p.tipo,
        sugestao_codigo: p.sugestao_codigo,
      };
    });
  }, [pendencias, escolhas]);

  const contagem = useMemo(() => contarEstados(linhas), [linhas]);
  const visiveis = useMemo(
    () => filtrarLinhas(linhas, { estado: filtro, busca }),
    [linhas, filtro, busca],
  );
  const naTela = visiveis.slice(0, limite);
  const niveis = useMemo(() => niveisDisponiveis(linhas), [linhas]);
  // A janela conta LINHAS mesmo quando agrupado — um galho grande não
  // entra inteiro só por ser um grupo só.
  const grupos = useMemo(() => {
    if (nivelGrupo <= 0) return null;
    const todos = agruparPorClassificacao(visiveis, nivelGrupo);
    const out: typeof todos = [];
    let n = 0;
    for (const g of todos) { if (n >= limite) break; out.push(g); n += g.linhas.length; }
    return { mostrando: out, total: todos.length, linhas: n };
  }, [visiveis, nivelGrupo, limite]);

  // Limpar grava "" em vez de apagar a chave, de propósito: a chave
  // ausente é o sinal que o pré-preenchimento usa para injetar a
  // sugestão. Apagando, a sugestão voltava sozinha no próximo refetch e
  // desfazia a decisão de quem acabou de limpar.
  const definir = (codigos: string[], valor: string | null) =>
    setEscolhas((s) => {
      const n = { ...s };
      for (const c of codigos) n[c] = valor ?? "";
      return n;
    });

  const alternarMarcada = (codigo: string) =>
    setMarcadas((s) => {
      const n = new Set(s);
      if (n.has(codigo)) n.delete(codigo); else n.add(codigo);
      return n;
    });

  // Desenhada na lista simples e dentro de cada grupo — por isso fora do JSX.
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
          <div className="font-medium">{p.descricao}</div>
          <div className="text-xs text-muted-foreground font-mono">
            {p.codigo} · {p.classificacao}
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
                  disabled={readonly}
                  onClick={() => definir([p.codigo], null)}>
                  desfazer
                </Button>
              </>
            ) : (
              <SeletorConta
                destinos={contasPadrao ?? []}
                carregando={carregandoDestinos}
                valor={p.destino}
                tipo={p.tipo}
                onEscolher={(c) => definir([p.codigo], c)}
                onIgnorar={() => definir([p.codigo], IGNORAR)}
                permitirIgnorar
                disabled={readonly}
                compacto
                className="flex-1"
                placeholder="Selecione a conta destino"
              />
            )}
            {estado === "sugerido" && (
              <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
                <Sparkles className="h-2.5 w-2.5" /> sugerido
              </Badge>
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

  const totalEscolhido = useMemo(
    () => (pendencias ?? []).filter((p) => !!escolhas[p.codigo]).length,
    [pendencias, escolhas],
  );

  const salvar = async () => {
    const itens = (pendencias ?? [])
      .filter((p) => !!escolhas[p.codigo])
      .map((p) => {
        const v = escolhas[p.codigo];
        return v === IGNORAR
          ? { conta_codigo: p.codigo, ignorada: true, conta_padrao_codigo: null }
          : { conta_codigo: p.codigo, conta_padrao_codigo: v, ignorada: false };
      });
    if (itens.length === 0) {
      toast.error("Nenhuma conta selecionada.");
      return;
    }
    setSalvando(true);
    try {
      const { data, error } = await supabase.rpc("aplicar_depara_em_lote", {
        _company_id: companyId,
        _itens: itens as any,
      });
      if (error) throw error;
      toast.success(`${(data as any)?.gravadas ?? itens.length} conta(s) vinculada(s).`);
      setEscolhas({});
      qc.invalidateQueries({ queryKey: ["depara-pendencias", companyId] });
      qc.invalidateQueries({ queryKey: ["depara-feitos", companyId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const pendentes = pendencias?.length ?? 0;

  return (
    <div className="space-y-4">
      <DeParaArquivoCard tenantId={tenantId} companyId={companyId} sistemaId={sistemaId ?? null} />
      <RegrasEmVolume tenantId={tenantId} companyId={companyId} contasPadrao={contasPadrao ?? []} readonly={readonly} />
      <Card className={`p-4 ${pendentes === 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            {pendentes === 0
              ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              : <AlertTriangle className="h-5 w-5 text-amber-600" />}
            <div>
              <div className="font-semibold">
                {pendentes === 0
                  ? "De-para completo"
                  : `${pendentes} conta(s) sem vínculo com o Plano Padrão`}
              </div>
              <div className="text-xs text-muted-foreground">
                {jaFeitos?.length ?? 0} conta(s) já configurada(s). Só entram na fila contas com movimento.
              </div>
            </div>
          </div>
          {pendentes > 0 && (
            <Button className="ml-auto" size="sm" disabled={readonly || salvando || totalEscolhido === 0}
              onClick={salvar}>
              {salvando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Salvar {totalEscolhido} vínculo(s)
            </Button>
          )}
        </div>
      </Card>

      {pendentes > 0 && (
        <>
          <BarraDepara
            contagem={contagem}
            estado={filtro}
            onEstado={(e) => { setFiltro(e); setLimite(150); }}
            busca={busca}
            onBusca={(b) => { setBusca(b); setLimite(150); }}
            visiveis={visiveis.length}
            selecionadas={marcadas}
            onSelecionarVisiveis={() => setMarcadas(new Set(visiveis.map((l) => l.codigo)))}
            onLimparSelecao={() => setMarcadas(new Set())}
            destinos={contasPadrao ?? []}
            onVincularLote={(codigo) => { definir([...marcadas], codigo); setMarcadas(new Set()); }}
            onIgnorarLote={() => { definir([...marcadas], IGNORAR); setMarcadas(new Set()); }}
            onLimparLote={() => { definir([...marcadas], null); setMarcadas(new Set()); }}
            nivelGrupo={nivelGrupo}
            onNivelGrupo={(n) => { setNivelGrupo(n); setLimite(150); }}
            niveisDisponiveis={niveis}
            disabled={readonly || salvando}
          />

          {(pendencias?.length ?? 0) >= LIMITE_FILA && (
            <div className="text-xs text-amber-600">
              A fila está no teto de {LIMITE_FILA} contas — pode haver mais atrás.
              Salve estas e recarregue para ver o resto.
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="gap-1">
              <Sparkles className="h-3 w-3" />
              {contagem.sugerido} sugestão(ões) preenchida(s) — revise e salve
            </Badge>
            {contagem.pendente > 0 && (
              <span>{contagem.pendente} sem sugestão, precisam de escolha</span>
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
                            quantidade={g.linhas.length}
                            pendentes={g.pendentes}
                            movimento={g.movimento}
                            marcado={g.linhas.every((l) => marcadas.has(l.codigo))}
                            onAlternar={() => alternarGrupo(g.linhas.map((l) => l.codigo))}
                            destinos={contasPadrao ?? []}
                            carregandoDestinos={carregandoDestinos}
                            onVincularGrupo={(cod) => definir(g.linhas.map((l) => l.codigo), cod)}
                            onIgnorarGrupo={() => definir(g.linhas.map((l) => l.codigo), IGNORAR)}
                            disabled={readonly}
                            colSpan={3}
                          />
                          {g.linhas.map(linhaDaConta)}
                        </Fragment>
                      ))
                    : naTela.map(linhaDaConta)}
                  {naTela.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">
                        Nenhuma conta neste filtro.
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

      {(jaFeitos?.length ?? 0) > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Ver {jaFeitos!.length} vínculo(s) já configurado(s)
          </summary>
          <Card className="mt-2 overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {(jaFeitos ?? []).map((d: any) => (
                  <tr key={d.conta_codigo} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{d.conta_codigo}</td>
                    <td className="px-3 py-2">
                      {d.ignorada
                        ? <span className="text-muted-foreground italic">não usada em demonstrações</span>
                        : <span className="font-mono text-xs">→ {d.conta_padrao_codigo}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{d.observacao}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </details>
      )}
    </div>
  );
}

// ============================================================
// Regras em volume
//
// O de-para conta a conta resolve a estrutura — algumas centenas de
// linhas. Não resolve clientes e fornecedores: um plano de terceiro traz
// dezenas de milhares deles, e ninguém vincula um a um.
//
// A regra diz "toda conta deste TIPO cai nesta conta do Padrão". O
// vínculo conta a conta continua valendo e tem precedência, para as
// exceções.
// ============================================================
const TIPOS_EM_VOLUME = [
  { valor: "4-Cli. Nac.", rotulo: "Clientes nacionais" },
  { valor: "5-For. Nac.", rotulo: "Fornecedores nacionais" },
  { valor: "6-Cli. Ex.", rotulo: "Clientes no exterior" },
  { valor: "7-For. Ex.", rotulo: "Fornecedores no exterior" },
];

function RegrasEmVolume({
  tenantId,
  companyId,
  contasPadrao,
  readonly,
}: {
  tenantId: string;
  companyId: string;
  contasPadrao: ContaDestino[];
  readonly?: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data: regras } = useQuery({
    queryKey: ["depara-regras", companyId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("depara_regras")
        .select("id, tipo_conta, classificacao_prefixo, conta_padrao_codigo")
        .eq("company_id", companyId);
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        tipo_conta: string | null;
        classificacao_prefixo: string | null;
        conta_padrao_codigo: string;
      }[];
    },
  });

  // As agregadoras vêm primeiro: são o destino natural de uma regra.
  const destinos = [
    ...contasPadrao.filter((c) => c.codigo.startsWith("AGG-")),
    ...contasPadrao.filter((c) => !c.codigo.startsWith("AGG-")),
  ];

  const definir = async (tipo: string, codigoDestino: string | null) => {
    setBusy(tipo);
    try {
      const atual = (regras ?? []).find((r) => r.tipo_conta === tipo);
      if (atual) {
        const { error } = await (supabase as any)
          .from("depara_regras").delete().eq("id", atual.id);
        if (error) throw error;
      }
      if (codigoDestino) {
        const { error } = await (supabase as any).from("depara_regras").insert({
          tenant_id: tenantId,
          company_id: companyId,
          tipo_conta: tipo,
          conta_padrao_codigo: codigoDestino,
        });
        if (error) throw error;
      }
      qc.invalidateQueries({ queryKey: ["depara-regras", companyId] });
      qc.invalidateQueries({ queryKey: ["depara-pendencias", companyId] });
      toast.success("Regra atualizada.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-2">
        <div className="font-semibold text-sm">Vínculo em volume</div>
        <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
          Clientes e fornecedores não se vinculam um a um — são dezenas de
          milhares. Aponte a classe inteira para a conta consolidada do Plano
          Padrão. O vínculo conta a conta abaixo continua valendo e tem
          precedência, para as exceções.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {TIPOS_EM_VOLUME.map((t) => {
          const atual = (regras ?? []).find((r) => r.tipo_conta === t.valor);
          return (
            <label key={t.valor} className="flex items-center gap-2 text-xs">
              <span className="w-44 shrink-0 text-muted-foreground">{t.rotulo}</span>
              <select
                className="h-8 flex-1 min-w-0 px-2 rounded-md border border-border bg-background text-foreground"
                value={atual?.conta_padrao_codigo ?? ""}
                disabled={readonly || busy === t.valor}
                onChange={(e) => definir(t.valor, e.target.value || null)}
              >
                <option value="">— sem regra —</option>
                {destinos.map((c) => (
                  <option key={c.codigo} value={c.codigo}>
                    {c.classificacao} · {c.descricao}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    </Card>
  );
}
