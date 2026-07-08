// Painel de configuração do Orçamento Gerencial (Etapa 2 do módulo Orçamento).
// Permite ao contador criar/editar orçamentos, montar os itens (agrupando
// contas estruturais do plano) e duplicar a estrutura de outro orçamento.
// NÃO trata do preenchimento de valores orçados (Etapa 3), do realizado nem
// da análise de variação.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Check,
  Search,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------

type TipoBase = "zero" | "historico";
type RealizadoVisao = "contabil" | "gerencial";
type StatusOrc = "rascunho" | "ativo" | "fechado";
type TipoConta = "receita" | "despesa" | "custo" | "ativo" | "passivo";

interface Orcamento {
  id: string;
  tenant_id: string;
  company_id: string;
  nome: string;
  ano: number;
  tipo_base: TipoBase;
  periodo_base_inicio: string | null;
  periodo_base_fim: string | null;
  realizado_visao: RealizadoVisao;
  status: StatusOrc;
  updated_at: string;
}

interface OrcamentoItem {
  id: string;
  orcamento_id: string;
  rotulo: string;
  contas: string[];
  tipo_conta: TipoConta | null;
  ordem: number | null;
}

interface PlanoConta {
  codigo: string;
  descricao: string;
  classificacao: string;
  natureza: string | null;
  nivel: number | null;
  tipo: string | null;
}

interface Props {
  tenantId: string;
  companyId: string;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function inferirTipoConta(classificacao: string): TipoConta | null {
  const primeiro = classificacao.trim().charAt(0);
  switch (primeiro) {
    case "1":
      return "ativo";
    case "2":
      return "passivo";
    case "3":
      return "despesa";
    case "4":
      return "receita";
    case "5":
      return "custo";
    default:
      return null;
  }
}

const TIPO_LABEL: Record<TipoConta, string> = {
  receita: "Receita",
  despesa: "Despesa",
  custo: "Custo",
  ativo: "Ativo",
  passivo: "Passivo",
};

const STATUS_LABEL: Record<StatusOrc, string> = {
  rascunho: "Rascunho",
  ativo: "Ativo",
  fechado: "Fechado",
};

// ---------------------------------------------------------------------
// Painel raiz
// ---------------------------------------------------------------------

export function OrcamentoConfigPanel({ tenantId, companyId }: Props) {
  const qc = useQueryClient();
  const { userId } = useAuth();

  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [openNovo, setOpenNovo] = useState(false);
  const [openEditarHeader, setOpenEditarHeader] = useState(false);
  const [openItem, setOpenItem] = useState(false);
  const [editandoItem, setEditandoItem] = useState<OrcamentoItem | null>(null);
  const [openDuplicar, setOpenDuplicar] = useState(false);

  const { data: orcamentos, isLoading: loadingOrcs } = useQuery({
    queryKey: ["orcamentos", companyId],
    queryFn: async (): Promise<Orcamento[]> => {
      const { data, error } = await supabase
        .from("orcamentos")
        .select(
          "id, tenant_id, company_id, nome, ano, tipo_base, periodo_base_inicio, periodo_base_fim, realizado_visao, status, updated_at",
        )
        .eq("company_id", companyId)
        .order("ano", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Orcamento[];
    },
  });

  // Seleciona o mais recente por padrão
  useEffect(() => {
    if (!selecionadoId && orcamentos && orcamentos.length > 0) {
      setSelecionadoId(orcamentos[0].id);
    }
    if (selecionadoId && orcamentos && !orcamentos.find((o) => o.id === selecionadoId)) {
      setSelecionadoId(orcamentos[0]?.id ?? null);
    }
  }, [orcamentos, selecionadoId]);

  const orcamento = orcamentos?.find((o) => o.id === selecionadoId) ?? null;

  const { data: itens, isLoading: loadingItens } = useQuery({
    queryKey: ["orcamento-itens", selecionadoId],
    enabled: !!selecionadoId,
    queryFn: async (): Promise<OrcamentoItem[]> => {
      const { data, error } = await supabase
        .from("orcamento_itens")
        .select("id, orcamento_id, rotulo, contas, tipo_conta, ordem")
        .eq("orcamento_id", selecionadoId!)
        .order("ordem", { ascending: true, nullsFirst: false })
        .order("rotulo", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        contas: Array.isArray(r.contas) ? (r.contas as string[]) : [],
      })) as OrcamentoItem[];
    },
  });

  const { data: plano } = useQuery({
    queryKey: ["orcamento-plano", tenantId, companyId],
    queryFn: async (): Promise<PlanoConta[]> => {
      const { data, error } = await supabase
        .from("plano_contas")
        .select("codigo, descricao, classificacao, natureza, nivel, tipo")
        .eq("tenant_id", tenantId)
        .eq("company_id", companyId)
        .eq("is_participante", false)
        .order("classificacao", { ascending: true })
        .range(0, 9999);
      if (error) throw error;
      return (data ?? []) as PlanoConta[];
    },
  });

  const excluirOrcamento = async (o: Orcamento) => {
    if (!confirm(`Excluir "${o.nome}"? Itens e valores orçados serão apagados.`)) return;
    const { error } = await supabase.from("orcamentos").delete().eq("id", o.id);
    if (error) return toast.error(error.message);
    toast.success("Orçamento excluído");
    qc.invalidateQueries({ queryKey: ["orcamentos", companyId] });
  };

  const excluirItem = async (item: OrcamentoItem) => {
    if (!confirm(`Excluir o item "${item.rotulo}"?`)) return;
    const { error } = await supabase.from("orcamento_itens").delete().eq("id", item.id);
    if (error) return toast.error(error.message);
    toast.success("Item excluído");
    qc.invalidateQueries({ queryKey: ["orcamento-itens", selecionadoId] });
  };

  const reordenar = async (item: OrcamentoItem, dir: -1 | 1) => {
    if (!itens) return;
    const lista = [...itens];
    const idx = lista.findIndex((x) => x.id === item.id);
    const alvo = idx + dir;
    if (idx < 0 || alvo < 0 || alvo >= lista.length) return;
    [lista[idx], lista[alvo]] = [lista[alvo], lista[idx]];
    // Renumera todos (1..N) para manter estável.
    const updates = lista.map((it, i) => ({ id: it.id, ordem: i + 1 }));
    try {
      // Envia updates em paralelo (poucos por orçamento).
      await Promise.all(
        updates.map((u) =>
          supabase.from("orcamento_itens").update({ ordem: u.ordem }).eq("id", u.id),
        ),
      );
      qc.invalidateQueries({ queryKey: ["orcamento-itens", selecionadoId] });
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    }
  };

  return (
    <div className="space-y-4">
      {/* Cabeçalho: seletor + ações */}
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[260px]">
          <Label className="text-xs">Orçamento</Label>
          <Select
            value={selecionadoId ?? ""}
            onValueChange={(v) => setSelecionadoId(v)}
            disabled={loadingOrcs || (orcamentos ?? []).length === 0}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Nenhum orçamento cadastrado" />
            </SelectTrigger>
            <SelectContent>
              {(orcamentos ?? []).map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.nome} · {o.ano} · {STATUS_LABEL[o.status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {orcamento && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">Ano {orcamento.ano}</Badge>
            <Badge variant="outline">
              Base {orcamento.tipo_base === "zero" ? "Zero" : "Histórica"}
            </Badge>
            <Badge variant="outline">
              Realizado: {orcamento.realizado_visao === "gerencial" ? "Gerencial" : "Contábil"}
            </Badge>
            <Badge
              variant={orcamento.status === "ativo" ? "default" : "secondary"}
              className="capitalize"
            >
              {STATUS_LABEL[orcamento.status]}
            </Badge>
          </div>
        )}
        <div className="ml-auto flex gap-2">
          {orcamento && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpenEditarHeader(true)}
              >
                <Pencil className="h-4 w-4 mr-1" /> Editar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => excluirOrcamento(orcamento)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={() => setOpenDuplicar(true)}>
            <Copy className="h-4 w-4 mr-1" /> Duplicar
          </Button>
          <Button size="sm" onClick={() => setOpenNovo(true)}>
            <Plus className="h-4 w-4 mr-1" /> Novo Orçamento
          </Button>
        </div>
      </Card>

      {/* Lista de Itens */}
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <div className="text-sm font-medium">
            {orcamento ? `Itens de ${orcamento.nome}` : "Itens do orçamento"}
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground">
              {loadingItens ? "carregando…" : `${itens?.length ?? 0} item(ns)`}
            </div>
            <Button
              size="sm"
              disabled={!orcamento}
              onClick={() => {
                setEditandoItem(null);
                setOpenItem(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Adicionar Item
            </Button>
          </div>
        </div>
        {!orcamento ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Crie um orçamento para começar a montar os itens.
          </div>
        ) : loadingItens ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="inline h-4 w-4 animate-spin mr-1" /> Carregando…
          </div>
        ) : (itens?.length ?? 0) === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum item configurado. Use <strong>Adicionar Item</strong> para escolher
            contas do plano.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {itens!.map((it, i) => (
              <div
                key={it.id}
                className="p-3 grid grid-cols-12 gap-3 items-center text-sm hover:bg-accent/30"
              >
                <div className="col-span-12 md:col-span-5">
                  <div className="font-medium">{it.rotulo}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {it.contas.map((c) => (
                      <span
                        key={c}
                        className="font-mono text-[10px] px-1.5 py-0.5 bg-muted rounded"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="col-span-6 md:col-span-3 text-xs">
                  {it.tipo_conta ? (
                    <Badge variant="outline">{TIPO_LABEL[it.tipo_conta]}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
                <div className="col-span-6 md:col-span-2 text-xs text-muted-foreground">
                  Ordem {it.ordem ?? i + 1}
                </div>
                <div className="col-span-12 md:col-span-2 flex justify-end gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={i === 0}
                    onClick={() => reordenar(it, -1)}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={i === (itens?.length ?? 0) - 1}
                    onClick={() => reordenar(it, 1)}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => {
                      setEditandoItem(it);
                      setOpenItem(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={() => excluirItem(it)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Diálogos */}
      <OrcamentoHeaderDialog
        open={openNovo}
        onOpenChange={setOpenNovo}
        tenantId={tenantId}
        companyId={companyId}
        userId={userId}
        editando={null}
        onSaved={(id) => {
          qc.invalidateQueries({ queryKey: ["orcamentos", companyId] });
          setSelecionadoId(id);
        }}
      />

      <OrcamentoHeaderDialog
        open={openEditarHeader}
        onOpenChange={setOpenEditarHeader}
        tenantId={tenantId}
        companyId={companyId}
        userId={userId}
        editando={orcamento}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["orcamentos", companyId] });
        }}
      />

      <ItemDialog
        open={openItem}
        onOpenChange={setOpenItem}
        tenantId={tenantId}
        companyId={companyId}
        orcamentoId={selecionadoId}
        editando={editandoItem}
        plano={plano ?? []}
        proximaOrdem={(itens?.length ?? 0) + 1}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["orcamento-itens", selecionadoId] });
        }}
      />

      <DuplicarDialog
        open={openDuplicar}
        onOpenChange={setOpenDuplicar}
        tenantId={tenantId}
        companyId={companyId}
        userId={userId}
        planoAtual={plano ?? []}
        onDone={(novoId) => {
          qc.invalidateQueries({ queryKey: ["orcamentos", companyId] });
          if (novoId) setSelecionadoId(novoId);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// Dialog: Novo / Editar Orçamento (cabeçalho)
// ---------------------------------------------------------------------

function OrcamentoHeaderDialog({
  open,
  onOpenChange,
  tenantId,
  companyId,
  userId,
  editando,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  companyId: string;
  userId: string | null;
  editando: Orcamento | null;
  onSaved: (id: string) => void;
}) {
  const anoAtual = new Date().getFullYear();
  const [nome, setNome] = useState("");
  const [ano, setAno] = useState<number>(anoAtual);
  const [tipoBase, setTipoBase] = useState<TipoBase>("zero");
  const [inicio, setInicio] = useState<string>(""); // YYYY-MM
  const [fim, setFim] = useState<string>("");
  const [realizado, setRealizado] = useState<RealizadoVisao>("gerencial");
  const [status, setStatus] = useState<StatusOrc>("rascunho");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editando) {
      setNome(editando.nome);
      setAno(editando.ano);
      setTipoBase(editando.tipo_base);
      setInicio(editando.periodo_base_inicio?.slice(0, 7) ?? "");
      setFim(editando.periodo_base_fim?.slice(0, 7) ?? "");
      setRealizado(editando.realizado_visao);
      setStatus(editando.status);
    } else {
      setNome(`Orçamento ${anoAtual}`);
      setAno(anoAtual);
      setTipoBase("zero");
      setInicio("");
      setFim("");
      setRealizado("gerencial");
      setStatus("rascunho");
    }
  }, [open, editando, anoAtual]);

  const podeSalvar =
    nome.trim().length > 0 &&
    Number.isFinite(ano) &&
    ano >= 1900 &&
    ano <= 2999 &&
    (tipoBase === "zero" || (inicio && fim));

  const salvar = async () => {
    if (!podeSalvar) return;
    setBusy(true);
    try {
      const payload = {
        nome: nome.trim(),
        ano: Number(ano),
        tipo_base: tipoBase,
        periodo_base_inicio: tipoBase === "historico" ? `${inicio}-01` : null,
        periodo_base_fim: tipoBase === "historico" ? `${fim}-01` : null,
        realizado_visao: realizado,
        status,
      };
      if (editando) {
        const { error } = await supabase
          .from("orcamentos")
          .update(payload)
          .eq("id", editando.id);
        if (error) throw error;
        toast.success("Orçamento atualizado");
        onSaved(editando.id);
      } else {
        const { data, error } = await supabase
          .from("orcamentos")
          .insert({
            tenant_id: tenantId,
            company_id: companyId,
            criado_por: userId,
            ...payload,
          })
          .select("id")
          .single();
        if (error) throw error;
        toast.success("Orçamento criado");
        onSaved((data as any).id);
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar orçamento" : "Novo orçamento"}</DialogTitle>
          <DialogDescription>
            Configure o cabeçalho. Os itens (contas a controlar) são adicionados
            depois de salvar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Ano</Label>
              <Input
                type="number"
                min={1900}
                max={2999}
                value={ano}
                onChange={(e) => setAno(Number(e.target.value))}
              />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusOrc)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rascunho">Rascunho</SelectItem>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="fechado">Fechado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tipo de base</Label>
              <Select value={tipoBase} onValueChange={(v) => setTipoBase(v as TipoBase)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zero">Base Zero</SelectItem>
                  <SelectItem value="historico">Base Histórica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Realizado a comparar</Label>
              <Select
                value={realizado}
                onValueChange={(v) => setRealizado(v as RealizadoVisao)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gerencial">Gerencial</SelectItem>
                  <SelectItem value="contabil">Contábil</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {tipoBase === "historico" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Período base — início (mês/ano)</Label>
                <Input type="month" value={inicio} onChange={(e) => setInicio(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Período base — fim (mês/ano)</Label>
                <Input type="month" value={fim} onChange={(e) => setFim(e.target.value)} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={!podeSalvar || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {editando ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Dialog: Novo / Editar Item
// ---------------------------------------------------------------------

function ItemDialog({
  open,
  onOpenChange,
  tenantId,
  companyId,
  orcamentoId,
  editando,
  plano,
  proximaOrdem,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  companyId: string;
  orcamentoId: string | null;
  editando: OrcamentoItem | null;
  plano: PlanoConta[];
  proximaOrdem: number;
  onSaved: () => void;
}) {
  const [rotulo, setRotulo] = useState("");
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [tipoConta, setTipoConta] = useState<TipoConta | "auto">("auto");
  const [busca, setBusca] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editando) {
      setRotulo(editando.rotulo);
      setSelecionadas(editando.contas);
      setTipoConta(editando.tipo_conta ?? "auto");
    } else {
      setRotulo("");
      setSelecionadas([]);
      setTipoConta("auto");
    }
    setBusca("");
  }, [open, editando]);

  const filtrado = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return plano
      .filter((c) => {
        if (!b) return true;
        return (
          c.codigo.toLowerCase().includes(b) ||
          c.classificacao.toLowerCase().includes(b) ||
          c.descricao.toLowerCase().includes(b)
        );
      })
      .slice(0, 400);
  }, [plano, busca]);

  const toggle = (codigo: string) => {
    setSelecionadas((prev) =>
      prev.includes(codigo) ? prev.filter((c) => c !== codigo) : [...prev, codigo],
    );
  };

  const tipoInferido = useMemo<TipoConta | null>(() => {
    for (const codigo of selecionadas) {
      const c = plano.find((p) => p.codigo === codigo);
      if (c) {
        const t = inferirTipoConta(c.classificacao);
        if (t) return t;
      }
    }
    return null;
  }, [selecionadas, plano]);

  const tipoFinal: TipoConta | null = tipoConta === "auto" ? tipoInferido : tipoConta;
  const podeSalvar = rotulo.trim().length > 0 && selecionadas.length > 0 && !!orcamentoId;

  const salvar = async () => {
    if (!podeSalvar || !orcamentoId) return;
    setBusy(true);
    try {
      if (editando) {
        const { error } = await supabase
          .from("orcamento_itens")
          .update({
            rotulo: rotulo.trim(),
            contas: selecionadas,
            tipo_conta: tipoFinal,
          })
          .eq("id", editando.id);
        if (error) throw error;
        toast.success("Item atualizado");
      } else {
        const { error } = await supabase.from("orcamento_itens").insert({
          tenant_id: tenantId,
          company_id: companyId,
          orcamento_id: orcamentoId,
          rotulo: rotulo.trim(),
          contas: selecionadas,
          tipo_conta: tipoFinal,
          ordem: proximaOrdem,
        });
        if (error) throw error;
        toast.success("Item criado");
      }
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar item" : "Novo item"}</DialogTitle>
          <DialogDescription>
            Escolha uma ou mais contas do plano. Uma conta sintética representa a soma
            das analíticas abaixo dela.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Coluna 1 — dados do item */}
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Rótulo</Label>
              <Input
                value={rotulo}
                onChange={(e) => setRotulo(e.target.value)}
                placeholder="Ex.: Folha de Pagamento"
              />
            </div>
            <div>
              <Label className="text-xs">Tipo do item</Label>
              <Select
                value={tipoConta}
                onValueChange={(v) => setTipoConta(v as TipoConta | "auto")}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    Automático{tipoInferido ? ` (${TIPO_LABEL[tipoInferido]})` : ""}
                  </SelectItem>
                  <SelectItem value="receita">Receita</SelectItem>
                  <SelectItem value="despesa">Despesa</SelectItem>
                  <SelectItem value="custo">Custo</SelectItem>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="passivo">Passivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">
                Contas selecionadas ({selecionadas.length})
              </Label>
              {selecionadas.length === 0 ? (
                <div className="text-xs text-muted-foreground border border-dashed rounded p-3 text-center">
                  Nenhuma conta selecionada. Escolha na coluna ao lado.
                </div>
              ) : (
                <div className="max-h-52 overflow-y-auto border rounded divide-y divide-border">
                  {selecionadas.map((codigo) => {
                    const c = plano.find((p) => p.codigo === codigo);
                    return (
                      <div
                        key={codigo}
                        className="flex items-center gap-2 p-1.5 text-xs"
                      >
                        <span className="font-mono w-16 shrink-0">{codigo}</span>
                        <span className="truncate flex-1">
                          {c?.descricao ?? "(conta removida do plano)"}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {c?.classificacao}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => toggle(codigo)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Coluna 2 — plano de contas */}
          <div className="space-y-2">
            <Label className="text-xs">Plano de contas (estruturais)</Label>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-2.5 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por código, classificação ou descrição…"
                className="h-9 pl-7"
              />
            </div>
            <div className="max-h-[360px] overflow-y-auto border rounded divide-y divide-border">
              {filtrado.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground text-center">
                  Nenhuma conta.
                </div>
              )}
              {filtrado.map((c) => {
                const marcada = selecionadas.includes(c.codigo);
                return (
                  <button
                    key={c.codigo}
                    type="button"
                    onClick={() => toggle(c.codigo)}
                    className={cn(
                      "w-full text-left px-2 py-1.5 text-xs hover:bg-accent flex items-center gap-2",
                      marcada && "bg-primary/5",
                    )}
                  >
                    <Checkbox checked={marcada} className="pointer-events-none" />
                    <span className="font-mono w-16 shrink-0">{c.codigo}</span>
                    <span className="truncate flex-1">{c.descricao}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {c.classificacao}
                    </span>
                    {marcada && <Check className="h-3 w-3 text-primary" />}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {plano.length} contas estruturais. Selecione uma sintética para agrupar
              todas as filhas.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={!podeSalvar || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {editando ? "Salvar" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Dialog: Duplicar orçamento
// ---------------------------------------------------------------------

function DuplicarDialog({
  open,
  onOpenChange,
  tenantId,
  companyId,
  userId,
  planoAtual,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  companyId: string;
  userId: string | null;
  planoAtual: PlanoConta[];
  onDone: (novoId: string | null) => void;
}) {
  const [origemId, setOrigemId] = useState<string>("");
  const [novoNome, setNovoNome] = useState("");
  const [novoAno, setNovoAno] = useState<number>(new Date().getFullYear());
  const [busy, setBusy] = useState(false);

  // Carrega orçamentos das empresas do mesmo tenant (evita cruzar tenants — RLS
  // já bloqueia de qualquer forma, mas o filtro reduz a lista mostrada).
  const { data: candidatos } = useQuery({
    queryKey: ["orcamentos-candidatos-duplicar", tenantId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orcamentos")
        .select("id, nome, ano, company_id, companies:company_id(name)")
        .eq("tenant_id", tenantId)
        .order("ano", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  useEffect(() => {
    if (!open) {
      setOrigemId("");
      setNovoNome("");
      setNovoAno(new Date().getFullYear());
    }
  }, [open]);

  const origem = candidatos?.find((o) => o.id === origemId);
  useEffect(() => {
    if (origem && !novoNome) {
      setNovoNome(`${origem.nome} (cópia)`);
    }
  }, [origem, novoNome]);

  const codigosPlano = useMemo(
    () => new Set(planoAtual.map((p) => p.codigo)),
    [planoAtual],
  );

  const duplicar = async () => {
    if (!origemId || !novoNome.trim() || !Number.isFinite(novoAno)) return;
    setBusy(true);
    try {
      // Busca cabeçalho da origem
      const { data: orig, error: e1 } = await supabase
        .from("orcamentos")
        .select("*")
        .eq("id", origemId)
        .single();
      if (e1) throw e1;

      // Cria novo cabeçalho
      const { data: novo, error: e2 } = await supabase
        .from("orcamentos")
        .insert({
          tenant_id: tenantId,
          company_id: companyId,
          criado_por: userId,
          nome: novoNome.trim(),
          ano: Number(novoAno),
          tipo_base: (orig as any).tipo_base,
          periodo_base_inicio: (orig as any).periodo_base_inicio,
          periodo_base_fim: (orig as any).periodo_base_fim,
          realizado_visao: (orig as any).realizado_visao,
          status: "rascunho",
        })
        .select("id")
        .single();
      if (e2) throw e2;
      const novoId = (novo as any).id as string;

      // Copia itens
      const { data: itensOrig, error: e3 } = await supabase
        .from("orcamento_itens")
        .select("rotulo, contas, tipo_conta, ordem")
        .eq("orcamento_id", origemId)
        .order("ordem", { ascending: true, nullsFirst: false });
      if (e3) throw e3;

      let faltando = 0;
      if ((itensOrig ?? []).length > 0) {
        const linhas = (itensOrig as any[]).map((it) => {
          const contas: string[] = Array.isArray(it.contas) ? it.contas : [];
          const semCorrespondencia = contas.filter((c) => !codigosPlano.has(c));
          if (semCorrespondencia.length > 0) faltando += semCorrespondencia.length;
          return {
            tenant_id: tenantId,
            company_id: companyId,
            orcamento_id: novoId,
            rotulo:
              semCorrespondencia.length > 0 ? `${it.rotulo} [revisar]` : it.rotulo,
            contas,
            tipo_conta: it.tipo_conta,
            ordem: it.ordem,
          };
        });
        const { error: e4 } = await supabase.from("orcamento_itens").insert(linhas);
        if (e4) throw e4;
      }

      toast.success(
        faltando > 0
          ? `Orçamento duplicado — ${faltando} conta(s) não existem no plano desta empresa; itens marcados como [revisar].`
          : "Orçamento duplicado",
      );
      onDone(novoId);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Duplicar orçamento</DialogTitle>
          <DialogDescription>
            Copia a estrutura (itens e contas selecionadas) de outro orçamento do
            escritório. Não copia os valores orçados.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Orçamento de origem</Label>
            <Select value={origemId} onValueChange={setOrigemId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Escolha um orçamento…" />
              </SelectTrigger>
              <SelectContent>
                {(candidatos ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.companies?.name ?? "?"} · {o.nome} · {o.ano}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nome do novo orçamento</Label>
              <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Ano</Label>
              <Input
                type="number"
                min={1900}
                max={2999}
                value={novoAno}
                onChange={(e) => setNovoAno(Number(e.target.value))}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Contas que não existirem no plano desta empresa serão mantidas nas listas
            dos itens, mas o rótulo receberá a marcação <strong>[revisar]</strong>.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={duplicar}
            disabled={!origemId || !novoNome.trim() || busy}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Duplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
