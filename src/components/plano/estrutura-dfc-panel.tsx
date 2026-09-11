// Estrutura da DRE/Balanço e alocação da DFC — editáveis no Plano Padrão.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Loader2, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lerTudo, countNaPrimeira } from "@/lib/supabase-paginado";
import { tituloConta } from "@/lib/format";
import { PlanilhaDfcBotoes } from "@/components/dfc/planilha-dfc-botoes";
import {
  getEstruturaPadrao, limparCacheEstrutura, type PapelEstrutura, type TipoLinha,
  type DemonstracaoEstrutura,
} from "@/lib/plano/estrutura";

const TIPOS_LINHA: { id: TipoLinha; rotulo: string }[] = [
  { id: "detalhe", rotulo: "Detalhe (soma o que está abaixo)" },
  { id: "bloco", rotulo: "Bloco (fecha o próprio grupo)" },
  { id: "corrido", rotulo: "Corrido (acumula tudo até aqui)" },
  { id: "tag", rotulo: "Tag (só indicadores, não é linha)" },
];

const DEMOS: { id: DemonstracaoEstrutura; rotulo: string }[] = [
  { id: "DRE", rotulo: "DRE" },
  { id: "BP_ATIVO", rotulo: "Balanço — Ativo" },
  { id: "BP_PASSIVO", rotulo: "Balanço — Passivo" },
];

function ehApuracao(c: string) {
  const segs = c.split(".");
  return segs.some((s) => s === "98" || s === "99");
}

export function EstruturaDemonstracaoPanel({
  tenantId, podeEditar,
}: {
  tenantId: string;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<"todas" | DemonstracaoEstrutura>("todas");
  const [busca, setBusca] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [draft, setDraft] = useState({
    classificacao: "", papel: "", demonstracao: "DRE" as DemonstracaoEstrutura,
    tipo_linha: "bloco" as TipoLinha, rotulo: "", ordem: 0,
  });

  const { data: linhas, isLoading } = useQuery({
    queryKey: ["estrutura-editor"],
    queryFn: () => getEstruturaPadrao(),
  });

  const { data: nomes, isLoading: carregandoNomes } = useQuery({
    queryKey: ["estrutura-nomes-plano", tenantId],
    queryFn: async () => {
      const rows = await lerTudo<{ classificacao: string; descricao: string }>(
        (from, to) =>
          supabase
            .from("plano_contas")
            .select("classificacao, descricao", countNaPrimeira(from))
            .eq("tenant_id", tenantId)
            .is("company_id", null)
            .eq("is_participante", false)
            .order("classificacao")
            .order("codigo")
            .range(from, to),
        "contas do plano na estrutura",
      );
      const mapa = new Map<string, string>();
      for (const r of rows) {
        if (!mapa.has(r.classificacao)) mapa.set(r.classificacao, r.descricao);
      }
      return mapa;
    },
  });

  const { data: semPapel } = useQuery({
    queryKey: ["estrutura-sem-papel", tenantId],
    queryFn: async () => {
      const [rows, est] = await Promise.all([
        lerTudo<{ classificacao: string; descricao: string }>(
          (from, to) =>
            supabase
              .from("plano_contas")
              .select("classificacao, descricao", countNaPrimeira(from))
              .eq("tenant_id", tenantId)
              .is("company_id", null)
              .eq("is_sintetica", true)
              .eq("is_participante", false)
              .like("classificacao", "3.%")
              .order("classificacao")
              .order("codigo")
              .range(from, to),
          "sintéticas DRE sem papel",
        ),
        getEstruturaPadrao(),
      ]);
      const tem = new Set(est.map((e) => e.classificacao));
      return rows
        .filter((c) => ehApuracao(c.classificacao) && !tem.has(c.classificacao))
        .map((c) => ({ classificacao: c.classificacao, descricao: c.descricao }));
    },
  });

  const papeis = useMemo(() => {
    const s = new Set((linhas ?? []).map((e) => e.papel));
    return Array.from(s).sort();
  }, [linhas]);

  const { visiveis, foraDoPlano } = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const bate = (e: PapelEstrutura) => {
      if (filtro !== "todas" && e.demonstracao !== filtro) return false;
      if (!q) return true;
      const nome = nomes?.get(e.classificacao) ?? "";
      return (
        e.classificacao.toLowerCase().includes(q) ||
        e.papel.toLowerCase().includes(q) ||
        (e.rotulo ?? "").toLowerCase().includes(q) ||
        nome.toLowerCase().includes(q)
      );
    };
    const filtradas = (linhas ?? []).filter(bate);
    if (!nomes) return { visiveis: filtradas, foraDoPlano: [] as PapelEstrutura[] };
    return {
      visiveis: filtradas.filter((e) => nomes.has(e.classificacao)),
      foraDoPlano: filtradas.filter((e) => !nomes.has(e.classificacao)),
    };
  }, [linhas, filtro, busca, nomes]);

  const invalidar = async () => {
    limparCacheEstrutura();
    await qc.invalidateQueries({ queryKey: ["estrutura-editor"] });
    await qc.invalidateQueries({ queryKey: ["estrutura-padrao"] });
    await qc.invalidateQueries({ queryKey: ["estrutura-sem-papel", tenantId] });
    await qc.invalidateQueries({ queryKey: ["estrutura-nomes-plano", tenantId] });
    await qc.invalidateQueries({ queryKey: ["plano-padrao-resumo", tenantId] });
  };

  const salvar = async (row: {
    classificacao: string; papel: string; demonstracao: string | null;
    tipo_linha: TipoLinha; rotulo: string | null; ordem: number;
    papelAnterior?: string;
  }) => {
    const chave = `${row.classificacao}|${row.papelAnterior ?? row.papel}`;
    setBusy(chave);
    try {
      const { error } = await (supabase as any).rpc("salvar_estrutura_padrao", {
        _classificacao: row.classificacao,
        _papel: row.papel,
        _demonstracao: row.demonstracao,
        _tipo_linha: row.tipo_linha,
        _rotulo: row.rotulo,
        _ordem: row.ordem,
        _papel_anterior: row.papelAnterior ?? null,
      });
      if (error) throw error;
      await invalidar();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const apagar = async (classificacao: string, papel: string) => {
    if (!confirm(`Remover ${papel} de ${classificacao}? Indicadores que usam este papel deixam de achar a linha.`)) return;
    setBusy(`${classificacao}|${papel}`);
    try {
      const { error } = await (supabase as any).rpc("apagar_estrutura_padrao", {
        _classificacao: classificacao, _papel: papel,
      });
      if (error) throw error;
      toast.success("Removido da estrutura.");
      await invalidar();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const incluirApuracao = async (classificacao: string, descricao: string) => {
    await salvar({
      classificacao,
      papel: classificacao.replace(/\./g, "_"),
      demonstracao: "DRE",
      tipo_linha: "bloco",
      rotulo: descricao,
      ordem: ((linhas ?? []).reduce((m, e) => Math.max(m, e.ordem), 0) + 10),
    });
    toast.success(`${classificacao} entrou na estrutura. Ajuste o papel se for o caso.`);
  };

  if (isLoading || carregandoNomes) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
      <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
    </div>;
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 text-sm bg-muted/30">
        <p className="text-muted-foreground text-xs leading-relaxed">
          Papéis das contas <strong>deste</strong> Plano Padrão: detalhe, subtotal de bloco,
          acumulado corrido, ou tag para indicador. O <strong>papel</strong> é o nome
          estável que os indicadores procuram (Receita Bruta, Lucro Líquido, Ativo Circulante…).
        </p>
      </Card>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar classificação, papel ou nome…"
            value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Select value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
          <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as demonstrações</SelectItem>
            {DEMOS.map((d) => <SelectItem key={d.id} value={d.id}>{d.rotulo}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={!podeEditar} onClick={() => setNovo((v) => !v)}>
          <Plus className="h-4 w-4 mr-1.5" /> Nova linha
        </Button>
      </div>

      {novo && (
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Incluir na estrutura</div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <div className="md:col-span-2">
              <Label className="text-xs">Classificação</Label>
              <Input value={draft.classificacao} placeholder="3.05.99"
                onChange={(e) => setDraft({ ...draft, classificacao: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Papel</Label>
              <Input list="papeis-estrutura" value={draft.papel} placeholder="LUCRO_BRUTO"
                onChange={(e) => setDraft({ ...draft, papel: e.target.value.toUpperCase().replace(/\s+/g, "_") })} />
            </div>
            <div>
              <Label className="text-xs">Demonstração</Label>
              <Select value={draft.demonstracao}
                onValueChange={(v) => setDraft({ ...draft, demonstracao: v as DemonstracaoEstrutura })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEMOS.map((d) => <SelectItem key={d.id} value={d.id}>{d.rotulo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={draft.tipo_linha}
                onValueChange={(v) => setDraft({ ...draft, tipo_linha: v as TipoLinha })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS_LINHA.map((t) => <SelectItem key={t.id} value={t.id}>{t.rotulo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-4">
              <Label className="text-xs">Rótulo na demonstração</Label>
              <Input value={draft.rotulo} placeholder="(=) Lucro Bruto"
                onChange={(e) => setDraft({ ...draft, rotulo: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Ordem</Label>
              <Input type="number" value={draft.ordem}
                onChange={(e) => setDraft({ ...draft, ordem: Number(e.target.value) })} />
            </div>
            <div className="flex items-end gap-2">
              <Button size="sm" disabled={!podeEditar || !draft.classificacao || !draft.papel}
                onClick={async () => {
                  await salvar({ ...draft, demonstracao: draft.demonstracao, rotulo: draft.rotulo || null });
                  setNovo(false);
                  setDraft({ classificacao: "", papel: "", demonstracao: "DRE", tipo_linha: "bloco", rotulo: "", ordem: 0 });
                  toast.success("Linha gravada.");
                }}>
                Gravar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNovo(false)}>Cancelar</Button>
            </div>
          </div>
        </Card>
      )}

      <datalist id="papeis-estrutura">
        {papeis.map((p) => <option key={p} value={p} />)}
      </datalist>

      {(semPapel?.length ?? 0) > 0 && (
        <Card className="p-4 border-amber-500/40 bg-amber-500/5">
          <div className="text-sm font-medium mb-1">
            Subtotais do plano sem papel ({semPapel!.length})
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Contas .98/.99 da DRE que o plano declara, mas a estrutura ainda não nomeia.
            Sem papel, a linha aparece na DRE só pela hierarquia — indicadores não a encontram.
          </p>
          <ul className="space-y-1.5">
            {semPapel!.slice(0, 30).map((c) => (
              <li key={c.classificacao} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-mono text-xs text-muted-foreground mr-2">{c.classificacao}</span>
                  {tituloConta(c.descricao)}
                </span>
                <Button size="sm" variant="outline" disabled={!podeEditar || busy !== null}
                  onClick={() => incluirApuracao(c.classificacao, c.descricao)}>
                  Incluir
                </Button>
              </li>
            ))}
          </ul>
          {semPapel!.length > 30 && (
            <div className="text-xs text-muted-foreground mt-2">Mostrando 30 de {semPapel!.length}.</div>
          )}
        </Card>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="px-3 py-2 font-medium">Classificação</th>
              <th className="px-3 py-2 font-medium">Conta</th>
              <th className="px-3 py-2 font-medium">Papel</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Demonstração</th>
              <th className="px-3 py-2 font-medium">Rótulo</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((e) => (
              <LinhaEstrutura
                key={`${e.classificacao}|${e.papel}`}
                row={e}
                nomePlano={nomes?.get(e.classificacao) ?? e.rotulo ?? e.papel}
                podeEditar={podeEditar}
                busy={busy === `${e.classificacao}|${e.papel}`}
                onSave={(next) => salvar({ ...next, papelAnterior: e.papel })}
                onDelete={() => apagar(e.classificacao, e.papel)}
              />
            ))}
            {visiveis.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  Nenhuma linha neste filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {foraDoPlano.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-medium mb-1">
            Classificações antigas do modelo ({foraDoPlano.length})
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            O modelo global ainda cita estas classificações, mas elas não existem
            neste Plano Padrão. Indicadores usam as contas atuais do mesmo papel.
            Não entram na demonstração daqui.
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {foraDoPlano.map((e) => (
              <li key={`${e.classificacao}|${e.papel}`}>
                <span className="font-mono mr-2">{e.classificacao}</span>
                {e.papel}
                {e.rotulo ? ` · ${e.rotulo}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function LinhaEstrutura({
  row, nomePlano, podeEditar, busy, onSave, onDelete,
}: {
  row: PapelEstrutura;
  nomePlano: string;
  podeEditar: boolean;
  busy: boolean;
  onSave: (next: {
    classificacao: string; papel: string; demonstracao: string | null;
    tipo_linha: TipoLinha; rotulo: string | null; ordem: number;
  }) => void;
  onDelete: () => void;
}) {
  const [papel, setPapel] = useState(row.papel);
  const [rotulo, setRotulo] = useState(row.rotulo ?? "");
  useEffect(() => {
    setPapel(row.papel);
    setRotulo(row.rotulo ?? "");
  }, [row.papel, row.rotulo]);

  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{row.classificacao}</td>
      <td className="px-3 py-2">
        <span className="text-xs">{tituloConta(nomePlano)}</span>
      </td>
      <td className="px-3 py-2 w-[180px]">
        <Input list="papeis-estrutura" className="h-8 text-xs" value={papel} disabled={!podeEditar || busy}
          onChange={(e) => setPapel(e.target.value.toUpperCase().replace(/\s+/g, "_"))}
          onBlur={() => { if (papel && papel !== row.papel) onSave({ ...row, papel, rotulo: rotulo || null }); }}
        />
      </td>
      <td className="px-3 py-2 w-[170px]">
        <Select disabled={!podeEditar || busy} value={row.tipo_linha}
          onValueChange={(v) => onSave({ ...row, tipo_linha: v as TipoLinha, rotulo: rotulo || null, papel })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TIPOS_LINHA.map((t) => <SelectItem key={t.id} value={t.id}>{t.rotulo}</SelectItem>)}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-2 w-[150px]">
        <Select disabled={!podeEditar || busy} value={row.demonstracao ?? "_none"}
          onValueChange={(v) => onSave({
            ...row, papel,
            demonstracao: v === "_none" ? null : v,
            rotulo: rotulo || null,
          })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">—</SelectItem>
            {DEMOS.map((d) => <SelectItem key={d.id} value={d.id}>{d.rotulo}</SelectItem>)}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-2">
        <Input className="h-8 text-xs" value={rotulo} disabled={!podeEditar || busy}
          onChange={(e) => setRotulo(e.target.value)}
          onBlur={() => { if (rotulo !== (row.rotulo ?? "")) onSave({ ...row, papel, rotulo: rotulo || null }); }}
        />
      </td>
      <td className="px-3 py-2">
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!podeEditar || busy}
          onClick={onDelete} title="Remover">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}

const BLOCOS_DFC: { chave: string; rotulo: string }[] = [
  { chave: "caixa", rotulo: "Caixa e Equivalentes" },
  { chave: "resultado", rotulo: "Bloco 1 — Atividades Operacionais" },
  { chave: "nao_caixa", rotulo: "Bloco 1 — Atividades Operacionais" },
  { chave: "operacional", rotulo: "Bloco 1 — Atividades Operacionais" },
  { chave: "investimento", rotulo: "Bloco 2 — Atividades de Investimento" },
  { chave: "financiamento", rotulo: "Bloco 3 — Atividades de Financiamento" },
];

function OpcoesDfcAgrupadas({
  opcoes,
}: {
  opcoes: { codigo: string; descricao: string; bloco: string; ordem: number }[];
}) {
  const vistos = new Set<string>();
  const grupos: { rotulo: string; itens: typeof opcoes }[] = [];
  for (const b of BLOCOS_DFC) {
    const itens = opcoes.filter((o) => o.bloco === b.chave);
    if (itens.length === 0) continue;
    const anterior = grupos[grupos.length - 1];
    if (anterior && anterior.rotulo === b.rotulo) anterior.itens.push(...itens);
    else grupos.push({ rotulo: b.rotulo, itens: [...itens] });
    vistos.add(b.chave);
  }
  const resto = opcoes.filter((o) => !vistos.has(o.bloco));
  if (resto.length > 0) grupos.push({ rotulo: "Outros", itens: resto });

  return (
    <>
      {grupos.map((g) => (
        <SelectGroup key={g.rotulo}>
          <SelectLabel>{g.rotulo}</SelectLabel>
          {g.itens.map((o) => (
            <SelectItem key={o.codigo} value={o.codigo}>
              {o.codigo} · {o.descricao}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  );
}

export function DfcAlocacaoPanel({
  tenantId, podeEditar,
}: {
  tenantId: string;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [buscaDfc, setBuscaDfc] = useState("");

  const { data: cobertura, isLoading } = useQuery({
    queryKey: ["dfc-cobertura", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("dfc_cobertura", {
        _tenant_id: tenantId, _company_id: null,
      });
      if (error) throw error;
      return data as {
        analiticas_balanco: number; sem_codigo: number;
        sinteticas_balanco: number; sinteticas_sem_codigo: number; total_plano: number;
      };
    },
  });

  const { data: sinteticas } = useQuery({
    queryKey: ["dfc-sinteticas-pendentes", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("dfc_sinteticas_pendentes", {
        _tenant_id: tenantId, _company_id: null, _limite: 150,
      });
      if (error) throw error;
      return (data ?? []) as {
        classificacao: string; descricao: string; tipo: string; nivel: number;
        dfc_codigo: string | null; analiticas_sem_codigo: number; analiticas_total: number;
      }[];
    },
  });

  const { data: catalogo } = useQuery({
    queryKey: ["dfc-catalogo"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("dfc_catalogo").select("codigo, descricao, bloco, ordem").order("ordem");
      if (error) throw error;
      return (data ?? []) as { codigo: string; descricao: string; bloco: string; ordem: number }[];
    },
    staleTime: 10 * 60_000,
  });

  const { data: vinculos } = useQuery({
    queryKey: ["dfc-vinculos-mapa", tenantId],
    queryFn: async () => {
      const [{ data: v, error: e1 }, { data: p, error: e2 }] = await Promise.all([
        (supabase as any).from("dfc_vinculo")
          .select("classificacao, codigo_dfc, origem")
          .eq("tenant_id", tenantId).is("company_id", null).order("classificacao"),
        (supabase as any).from("dfc_padrao").select("classificacao, descricao_referencia"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const nomesV = new Map((p ?? []).map((x: any) => [x.classificacao, x.descricao_referencia]));
      return ((v ?? []) as { classificacao: string; codigo_dfc: string; origem: string }[])
        .map((row) => ({ ...row, descricao: nomesV.get(row.classificacao) ?? "" }));
    },
  });

  const { data: semDfc } = useQuery({
    queryKey: ["dfc-analiticas-sem-codigo", tenantId, buscaDfc],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("dfc_analiticas_sem_codigo", {
        _tenant_id: tenantId, _company_id: null,
        _busca: buscaDfc.trim() || null, _limite: 200,
      });
      if (error) throw error;
      return (data ?? []) as {
        codigo: string; classificacao: string; descricao: string;
        tipo: string; conta_pai: string | null;
      }[];
    },
  });

  const invalidar = () => {
    for (const k of ["dfc-cobertura", "dfc-sinteticas-pendentes", "dfc-analiticas-sem-codigo",
                     "dfc-vinculos-mapa", "plano-padrao-resumo"]) {
      qc.invalidateQueries({ queryKey: [k, tenantId] });
      qc.invalidateQueries({ queryKey: [k] });
    }
  };

  const classificarSintetica = async (classificacao: string, codigo: string | null) => {
    setBusy(classificacao);
    try {
      const { data, error } = await (supabase as any).rpc("definir_dfc_classificacao", {
        _tenant_id: tenantId, _classificacao: classificacao,
        _dfc_codigo: codigo, _company_id: null,
      });
      if (error) throw error;
      if (codigo == null) toast.success("Vínculo removido.");
      else {
        const n = Number((data as any)?.contas_abrangidas ?? 0);
        toast.success(`${n.toLocaleString("pt-BR")} conta(s) abrangidas por este vínculo.`);
      }
      invalidar();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const classificarConta = async (codigo: string, dfcCodigo: string) => {
    setBusy(codigo);
    try {
      const { error } = await supabase.from("plano_contas")
        .update({ dfc_codigo: dfcCodigo } as any)
        .eq("tenant_id", tenantId).is("company_id", null).eq("codigo", codigo);
      if (error) throw error;
      invalidar();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
      <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
    </div>;
  }

  const faltam = cobertura?.sem_codigo ?? 0;
  const opcoesDfc = catalogo ?? [];

  return (
    <div className="space-y-5">
      <Card className="p-4 text-sm bg-muted/30">
        <p className="text-muted-foreground text-xs leading-relaxed">
          Como cada conta movimenta o <strong>caixa</strong>. O vínculo é por classificação
          (a sintética manda nas analíticas abaixo). Dá para corrigir o mapa em vigor —
          não só o que ainda está pendente.
        </p>
      </Card>

      <Card className={`p-4 ${faltam === 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {faltam === 0
              ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              : <AlertTriangle className="h-5 w-5 text-amber-600" />}
            <div>
              <div className="font-semibold text-sm">
                {faltam === 0
                  ? "DFC classificada por completo"
                  : `${faltam.toLocaleString("pt-BR")} conta(s) analíticas sem classificação de DFC`}
              </div>
              <div className="text-xs text-muted-foreground">
                de {(cobertura?.analiticas_balanco ?? 0).toLocaleString("pt-BR")} analíticas de
                Ativo e Passivo · plano com {(cobertura?.total_plano ?? 0).toLocaleString("pt-BR")} contas
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AlocarDfcButton tenantId={tenantId} onDone={invalidar} disabled={!podeEditar} />
            <PlanilhaDfcBotoes tenantId={tenantId} onDone={invalidar} disabled={!podeEditar}
              permitirImportar={podeEditar} />
            <CompletarEstruturaButton tenantId={tenantId} onDone={invalidar} disabled={!podeEditar} />
            <RevincularDfcButton tenantId={tenantId} onDone={invalidar} disabled={!podeEditar} />
          </div>
        </div>
      </Card>

      {(vinculos?.length ?? 0) > 0 && (
        <div>
          <h3 className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wider">
            Mapa em vigor ({vinculos!.length} vínculos) — edite o destino ou remova
          </h3>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground border-b">
                  <th className="px-3 py-1.5 font-medium">Classificação</th>
                  <th className="px-3 py-1.5 font-medium">Conta de referência</th>
                  <th className="px-3 py-1.5 font-medium">Destino na DFC</th>
                  <th className="px-3 py-1.5 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {vinculos!.map((v) => {
                  const descricaoTexto = String((v as any).descricao ?? "");
                  const caixaDuvidoso = v.codigo_dfc === "C" &&
                    !/caixa|banco|equivalen|aplicac|movimento|vinculad/i.test(descricaoTexto);
                  return (
                    <tr key={v.classificacao} className={`border-t ${caixaDuvidoso ? "bg-amber-500/10" : ""}`}>
                      <td className="px-3 py-1.5 font-mono text-xs">{v.classificacao}</td>
                      <td className="px-3 py-1.5">
                        {descricaoTexto || "—"}
                        {caixaDuvidoso && (
                          <div className="text-[11px] text-amber-700">
                            Marcada como Caixa, mas o nome não é caixa/banco — distorce a variação de caixa.
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 w-[280px]">
                        <Select
                          disabled={!podeEditar || busy === v.classificacao}
                          value={v.codigo_dfc}
                          onValueChange={(codigo) => classificarSintetica(v.classificacao, codigo)}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <OpcoesDfcAgrupadas opcoes={opcoesDfc} />
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-1.5">
                        <Button size="icon" variant="ghost" className="h-8 w-8"
                          disabled={!podeEditar || busy === v.classificacao}
                          title="Remover vínculo"
                          onClick={() => classificarSintetica(v.classificacao, null)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {(sinteticas?.length ?? 0) > 0 && (
        <div>
          <h3 className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wider">
            Classificar pela conta sintética
          </h3>
          <Card className="p-4 mb-2 text-sm bg-muted/30">
            <p className="text-muted-foreground text-xs leading-relaxed">
              Cada linha é uma sintética que ainda manda em analíticas sem classificação.
              A lista vem ordenada pelo que cada uma resolve de uma vez.
            </p>
          </Card>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {(sinteticas ?? []).map((s) => (
                  <tr key={s.classificacao} className="border-t first:border-t-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{tituloConta(s.descricao)}</div>
                      <div className="text-xs text-muted-foreground font-mono">{s.classificacao}</div>
                    </td>
                    <td className="px-3 py-2 w-[150px] text-right">
                      <span className="text-sm font-semibold tabular-nums">
                        {Number(s.analiticas_sem_codigo).toLocaleString("pt-BR")}
                      </span>
                      <div className="text-[11px] text-muted-foreground">contas abaixo</div>
                    </td>
                    <td className="px-3 py-2 w-[280px]">
                      <Select
                        disabled={!podeEditar || busy === s.classificacao}
                        value={s.dfc_codigo ?? undefined}
                        onValueChange={(v) => classificarSintetica(s.classificacao, v)}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="Selecione o destino na DFC" />
                        </SelectTrigger>
                        <SelectContent>
                          <OpcoesDfcAgrupadas opcoes={opcoesDfc} />
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      <div>
        <h3 className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wider">
          Conta a conta ({semDfc?.length ?? 0}{(semDfc?.length ?? 0) >= 200 ? "+ mostrando 200" : ""})
        </h3>
        <div className="relative max-w-md mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar conta…"
            value={buscaDfc} onChange={(e) => setBuscaDfc(e.target.value)} />
        </div>
        {(semDfc?.length ?? 0) === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 mx-auto mb-2" />
            Nenhuma conta analítica de Ativo/Passivo pendente.
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {(semDfc ?? []).map((c) => (
                  <tr key={c.codigo} className="border-t first:border-t-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{tituloConta(c.descricao)}</div>
                      <div className="text-xs text-muted-foreground font-mono">{c.classificacao}</div>
                    </td>
                    <td className="px-3 py-2 w-[280px]">
                      <Select disabled={!podeEditar || busy === c.codigo}
                        onValueChange={(v) => classificarConta(c.codigo, v)}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          <OpcoesDfcAgrupadas opcoes={opcoesDfc} />
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

function AlocarDfcButton({ tenantId, onDone, disabled }: {
  tenantId: string; onDone: () => void; disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const rodar = async () => {
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("dfc_alocar_automatico", {
        _tenant_id: tenantId, _company_id: null, _sobrescrever: false,
      });
      if (error) throw error;
      toast.success(
        `${data.vinculos_gravados} vínculo(s) de DFC gravado(s). ` +
        `${data.classificacoes_com_codigo} classificação(ões) com código, ` +
        `${data.classificacoes_sem_codigo} ainda sem. ` +
        "O que você definiu à mão não foi tocado.",
        { duration: 12000 },
      );
      onDone();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  return (
    <Button size="sm" disabled={busy || disabled} onClick={rodar}
      title="Cria os vínculos de DFC a partir do padrão, por classificação. Não sobrescreve o que foi definido à mão.">
      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            : <Sparkles className="h-4 w-4 mr-2" />}
      Alocar DFC automaticamente
    </Button>
  );
}

function CompletarEstruturaButton({ tenantId, onDone, disabled }: {
  tenantId: string; onDone: () => void; disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="outline" size="sm" disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        try {
          const { data, error } = await (supabase as any).rpc(
            "garantir_sinteticas_faltantes",
            { _tenant_id: tenantId, _company_id: null, _separador: "." },
          );
          if (error) throw error;
          const n = Number((data as any)?.sinteticas_criadas ?? 0);
          toast.success(
            n === 0
              ? "A árvore do plano já está completa."
              : `${n} conta(s) sintéticas criadas — os grupos que faltavam voltam a aparecer nas demonstrações.`,
          );
          onDone();
        } catch (e: any) { toast.error(e.message); }
        finally { setBusy(false); }
      }}>
      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
      Completar estrutura do plano
    </Button>
  );
}

function RevincularDfcButton({ tenantId, onDone, disabled }: {
  tenantId: string; onDone: () => void; disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy || disabled}
      onClick={async () => {
        if (!confirm(
          "Reaplicar a planilha de DFC em todo o Plano Padrão?\n\n" +
          "A classificação atual de DFC é descartada e refeita a partir da planilha. " +
          "Contas marcadas manualmente voltam ao padrão."
        )) return;
        setBusy(true);
        try {
          const { data, error } = await (supabase as any).rpc("revincular_dfc", {
            _tenant_id: tenantId, _company_id: null, _todos_escopos: true,
          });
          if (error) throw error;
          const r = data as { vinculadas: number; sem_codigo: number; analiticas_balanco: number };
          toast.success(
            `${r.vinculadas} conta(s) vinculadas. ` +
            (r.sem_codigo === 0
              ? "Todas as analíticas de Ativo/Passivo classificadas."
              : `${r.sem_codigo} de ${r.analiticas_balanco} analíticas de balanço ainda sem código.`),
          );
          onDone();
        } catch (e: any) { toast.error(e.message); }
        finally { setBusy(false); }
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
      Reaplicar planilha de DFC
    </Button>
  );
}
