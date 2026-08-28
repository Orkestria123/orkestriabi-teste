// Painel de Ajustes Gerenciais (Etapa 2 do módulo Visão Gerencial).
// Grava em `ajustes_gerenciais` e `contas_gerenciais`. Não altera
// nenhuma tabela contábil. Partida dobrada: um único valor aplicado
// a débito e crédito. As demonstrações continuam inalteradas — o
// motor gerencial e o seletor de visão são etapas seguintes.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, Sparkles } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { escoparPlano, getEscopoConsulta } from "@/lib/plano/consulta";
import { useAuth } from "@/hooks/use-auth";
import { formatBRL } from "@/lib/format";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

type ContaOpt = {
  codigo: string;
  descricao: string;
  classificacao: string;
  origem: "plano" | "gerencial" | "participante";
};

interface AjusteRow {
  id: string;
  competencia: string;          // YYYY-MM-DD
  descricao: string;
  justificativa: string | null;
  conta_debito: string;
  conta_credito: string;
  valor: number;
  criado_por: string | null;
  created_at: string;
  autor_nome?: string | null;
}

interface Props {
  tenantId: string;
  companyId: string;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function primeiroDiaDoMes(ym: string): string {
  // ym = "2025-01"
  return `${ym}-01`;
}
function ymDeCompetencia(d: string): string {
  return d.slice(0, 7);
}
function labelMes(ym: string): string {
  const [y, m] = ym.split("-");
  const nomes = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${nomes[Number(m) - 1] ?? m}/${y.slice(2)}`;
}

function papelParticipante(classificacao: string): "cliente" | "fornecedor" {
  return classificacao.trim().startsWith("2") ? "fornecedor" : "cliente";
}

/** Digitação em centavos → "20.000.000,00" */
function formatarValorDigitado(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 15);
  if (!d) return "";
  return (Number(d) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseValorBR(s: string): number {
  const t = s.replace(/[R$\s]/g, "").trim();
  if (!t) return NaN;
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(t.replace(/\./g, ""));
}

function termoBuscaSeguro(q: string): string {
  return q.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
}

function invalidarDemonstracoes(qc: ReturnType<typeof useQueryClient>, companyId: string) {
  qc.invalidateQueries({ queryKey: ["ajustes-gerenciais", companyId] });
  qc.invalidateQueries({ queryKey: ["monthly-stmt"] });
  qc.invalidateQueries({ queryKey: ["indic-engine-data"] });
  qc.invalidateQueries({ queryKey: ["indic-demo-dre"] });
}

// ---------------------------------------------------------------------
// Painel raiz
// ---------------------------------------------------------------------

export function AjustesGerenciaisPanel({ tenantId, companyId }: Props) {
  const qc = useQueryClient();
  const { userId } = useAuth();

  const hojeYM = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [competencia, setCompetencia] = useState<string>(hojeYM);

  const [openAjuste, setOpenAjuste] = useState(false);
  const [editando, setEditando] = useState<AjusteRow | null>(null);
  const [openConta, setOpenConta] = useState(false);

  // ------- Contas do plano (estruturais) + contas gerenciais -------
  const { data: contas, isLoading: loadingContas } = useQuery({
    queryKey: ["gerencial-contas", tenantId, companyId],
    queryFn: async (): Promise<ContaOpt[]> => {
      // escopo do plano resolvido em um lugar só (Plano Padrão x próprio)
      const escopo = await getEscopoConsulta(companyId);
      const [planoR, gerR] = await Promise.all([
        escoparPlano(
          supabase.from("plano_contas").select("codigo, descricao, classificacao, is_participante"),
          companyId,
          escopo,
        )
            .eq("is_participante", false)
            .order("classificacao", { ascending: true })
            .range(0, 9999),
        supabase
          .from("contas_gerenciais")
          .select("codigo, descricao, classificacao")
          .eq("tenant_id", tenantId)
          .eq("company_id", companyId)
          .order("codigo", { ascending: true }),
      ]);
      if (planoR.error) throw planoR.error;
      if (gerR.error) throw gerR.error;
      const plano: ContaOpt[] = (planoR.data ?? []).map((r: any) => ({
        codigo: r.codigo,
        descricao: r.descricao,
        classificacao: r.classificacao,
        origem: "plano" as const,
      }));
      const ger: ContaOpt[] = (gerR.data ?? []).map((r: any) => ({
        codigo: r.codigo,
        descricao: r.descricao,
        classificacao: r.classificacao,
        origem: "gerencial" as const,
      }));
      return [...ger, ...plano];
    },
  });

  // ------- Ajustes da competência selecionada -------
  const { data: ajustes, isLoading: loadingAjustes } = useQuery({
    queryKey: ["ajustes-gerenciais", companyId, competencia],
    queryFn: async (): Promise<AjusteRow[]> => {
      const comp = primeiroDiaDoMes(competencia);
      const { data, error } = await supabase
        .from("ajustes_gerenciais")
        .select("id, competencia, descricao, justificativa, conta_debito, conta_credito, valor, criado_por, created_at")
        .eq("company_id", companyId)
        .eq("competencia", comp)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const autores = Array.from(new Set(rows.map((r) => r.criado_por).filter(Boolean)));
      let autoresMap = new Map<string, string>();
      if (autores.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", autores);
        autoresMap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name ?? p.email ?? ""]));
      }
      return rows.map((r) => ({ ...r, valor: Number(r.valor), autor_nome: autoresMap.get(r.criado_por) ?? null }));
    },
  });

  const { data: labelsExtra } = useQuery({
    queryKey: [
      "gerencial-conta-refs",
      companyId,
      (ajustes ?? []).map((a) => `${a.conta_debito}|${a.conta_credito}`).join(","),
    ],
    enabled: (ajustes?.length ?? 0) > 0,
    queryFn: async (): Promise<ContaOpt[]> => {
      const conhecidos = new Set((contas ?? []).map((c) => c.codigo));
      const codes = Array.from(
        new Set((ajustes ?? []).flatMap((a) => [a.conta_debito, a.conta_credito])),
      ).filter((c) => !conhecidos.has(c));
      if (codes.length === 0) return [];
      const escopo = await getEscopoConsulta(companyId);
      const { data, error } = await escoparPlano(
        supabase.from("plano_contas").select("codigo, descricao, classificacao, is_participante"),
        companyId,
        escopo,
      ).in("codigo", codes);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        codigo: r.codigo,
        descricao: r.descricao,
        classificacao: r.classificacao,
        origem: r.is_participante ? ("participante" as const) : ("plano" as const),
      }));
    },
  });

  const contaPorCodigo = useMemo(() => {
    const m = new Map<string, ContaOpt>();
    for (const c of [...(contas ?? []), ...(labelsExtra ?? [])]) m.set(c.codigo, c);
    return m;
  }, [contas, labelsExtra]);

  const contaLabel = (codigo: string): { descricao: string; origem: ContaOpt["origem"] | "?" } => {
    const c = contaPorCodigo.get(codigo);
    if (!c) return { descricao: codigo, origem: "?" };
    return { descricao: c.descricao, origem: c.origem };
  };

  const excluir = async (id: string) => {
    if (!confirm("Excluir este ajuste?")) return;
    const { error } = await supabase.from("ajustes_gerenciais").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Ajuste excluído");
    invalidarDemonstracoes(qc, companyId);
  };

  return (
    <div className="space-y-4">
      {/* Cabeçalho: competência + ações */}
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">Competência</Label>
          <CompetenciaPicker value={competencia} onChange={setCompetencia} />
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpenConta(true)}>
            <Sparkles className="h-4 w-4 mr-1" /> Nova Conta Gerencial
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditando(null);
              setOpenAjuste(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> Novo Ajuste
          </Button>
        </div>
      </Card>

      {/* Lista */}
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <div className="text-sm font-medium">Ajustes de {labelMes(competencia)}</div>
          <div className="text-xs text-muted-foreground">
            {loadingAjustes ? "carregando…" : `${ajustes?.length ?? 0} lançamento(s)`}
          </div>
        </div>
        {loadingAjustes ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="inline h-4 w-4 animate-spin mr-1" /> Carregando…
          </div>
        ) : (ajustes?.length ?? 0) === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum ajuste nesta competência. Use <strong>Novo Ajuste</strong> para lançar.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {ajustes!.map((a) => {
              const d = contaLabel(a.conta_debito);
              const c = contaLabel(a.conta_credito);
              const clsD = contaPorCodigo.get(a.conta_debito)?.classificacao ?? "";
              const clsC = contaPorCodigo.get(a.conta_credito)?.classificacao ?? "";
              return (
                <div key={a.id} className="p-3 grid grid-cols-12 gap-3 items-center text-sm hover:bg-accent/30">
                  <div className="col-span-12 md:col-span-4">
                    <div className="font-medium">{a.descricao}</div>
                    {a.justificativa && (
                      <div className="text-xs text-muted-foreground line-clamp-1">{a.justificativa}</div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {a.autor_nome ?? "—"} · {new Date(a.created_at).toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                  <div className="col-span-6 md:col-span-3 text-xs">
                    <div className="text-muted-foreground">Débito</div>
                    <div className="flex items-center gap-1">
                      <span className="font-mono">{a.conta_debito}</span>
                      <span className="truncate">{d.descricao}</span>
                      {d.origem === "gerencial" && <GerencialBadge />}
                      {d.origem === "participante" && <ParticipanteBadge classificacao={clsD} />}
                    </div>
                  </div>
                  <div className="col-span-6 md:col-span-3 text-xs">
                    <div className="text-muted-foreground">Crédito</div>
                    <div className="flex items-center gap-1">
                      <span className="font-mono">{a.conta_credito}</span>
                      <span className="truncate">{c.descricao}</span>
                      {c.origem === "gerencial" && <GerencialBadge />}
                      {c.origem === "participante" && <ParticipanteBadge classificacao={clsC} />}
                    </div>
                  </div>
                  <div className="col-span-8 md:col-span-1 text-right font-medium">
                    {formatBRL(a.valor)}
                  </div>
                  <div className="col-span-4 md:col-span-1 flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => {
                        setEditando(a);
                        setOpenAjuste(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      onClick={() => excluir(a.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Dialogs */}
      <AjusteDialog
        open={openAjuste}
        onOpenChange={setOpenAjuste}
        competenciaPadrao={competencia}
        contas={contas ?? []}
        loadingContas={loadingContas}
        tenantId={tenantId}
        companyId={companyId}
        userId={userId}
        editando={editando}
        onNovaConta={() => setOpenConta(true)}
        onSaved={() => {
          invalidarDemonstracoes(qc, companyId);
        }}
      />

      <ContaGerencialDialog
        open={openConta}
        onOpenChange={setOpenConta}
        tenantId={tenantId}
        companyId={companyId}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["gerencial-contas", tenantId, companyId] });
        }}
      />
    </div>
  );
}

function GerencialBadge() {
  return (
    <Badge variant="outline" className="text-[9px] border-violet-500/40 text-violet-700 dark:text-violet-300">
      Gerencial
    </Badge>
  );
}

function ParticipanteBadge({ classificacao }: { classificacao: string }) {
  const papel = papelParticipante(classificacao);
  return (
    <Badge variant="outline" className="text-[9px] border-sky-500/40 text-sky-700 dark:text-sky-300">
      {papel === "fornecedor" ? "Fornecedor" : "Cliente"}
    </Badge>
  );
}

// ---------------------------------------------------------------------
// Seletor de conta (plano estrutural + contas gerenciais)
// ---------------------------------------------------------------------

function ContaSelect({
  contas,
  value,
  onChange,
  placeholder,
  onNovaConta,
  companyId,
}: {
  contas: ContaOpt[];
  value: string;
  onChange: (codigo: string, conta?: ContaOpt) => void;
  placeholder: string;
  onNovaConta?: () => void;
  companyId: string;
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const termo = termoBuscaSeguro(busca);

  const { data: participantes } = useQuery({
    queryKey: ["gerencial-conta-part", companyId, termo],
    enabled: open && termo.length >= 2,
    queryFn: async (): Promise<ContaOpt[]> => {
      const escopo = await getEscopoConsulta(companyId);
      const like = `%${termo}%`;
      const { data, error } = await escoparPlano(
        supabase.from("plano_contas").select("codigo, descricao, classificacao, is_participante"),
        companyId,
        escopo,
      )
        .eq("is_participante", true)
        .or(`codigo.ilike."${like}",descricao.ilike."${like}",classificacao.ilike."${like}"`)
        .order("classificacao", { ascending: true })
        .limit(80);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        codigo: r.codigo,
        descricao: r.descricao,
        classificacao: r.classificacao,
        origem: "participante" as const,
      }));
    },
  });

  const { data: selecionadaExtra } = useQuery({
    queryKey: ["gerencial-conta-uma", companyId, value],
    enabled: !!value && !contas.some((c) => c.codigo === value),
    queryFn: async (): Promise<ContaOpt | null> => {
      const escopo = await getEscopoConsulta(companyId);
      const { data, error } = await escoparPlano(
        supabase.from("plano_contas").select("codigo, descricao, classificacao, is_participante"),
        companyId,
        escopo,
      )
        .eq("codigo", value)
        .limit(1);
      if (error) throw error;
      const row = (data ?? [])[0] as any;
      if (!row) return null;
      return {
        codigo: row.codigo,
        descricao: row.descricao,
        classificacao: row.classificacao,
        origem: row.is_participante ? "participante" : "plano",
      };
    },
  });

  // Ao resolver uma conta que não está na lista base (cliente/fornecedor,
  // ou conta de um ajuste em edição), avisa o pai para que a prévia da
  // partida e a validação enxerguem a conta vinculada.
  useEffect(() => {
    if (selecionadaExtra && selecionadaExtra.codigo === value) {
      onChange(selecionadaExtra.codigo, selecionadaExtra);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionadaExtra?.codigo]);


  const pool = useMemo(() => {
    const m = new Map<string, ContaOpt>();
    for (const c of contas) m.set(c.codigo, c);
    for (const c of participantes ?? []) m.set(c.codigo, c);
    if (selecionadaExtra) m.set(selecionadaExtra.codigo, selecionadaExtra);
    return Array.from(m.values());
  }, [contas, participantes, selecionadaExtra]);

  const selecionada = pool.find((c) => c.codigo === value);
  const filtered = useMemo(() => {
    const b = busca.trim().toLowerCase();
    const base = pool.filter((c) => {
      if (c.origem === "participante" && termo.length < 2 && c.codigo !== value) return false;
      if (!b) return c.origem !== "participante" || c.codigo === value;
      return (
        c.codigo.toLowerCase().includes(b) ||
        c.descricao.toLowerCase().includes(b) ||
        c.classificacao.toLowerCase().includes(b)
      );
    });
    const ger = base.filter((c) => c.origem === "gerencial");
    const plano = base.filter((c) => c.origem === "plano");
    const part = base.filter((c) => c.origem === "participante");
    return [...ger, ...plano.slice(0, 400), ...part].slice(0, 500);
  }, [pool, busca, termo, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("w-full justify-start font-normal text-left h-9", !selecionada && "text-muted-foreground")}
        >
          {selecionada ? (
            <span className="flex items-center gap-2 truncate">
              <span className="font-mono text-xs">{selecionada.codigo}</span>
              <span className="truncate">{selecionada.descricao}</span>
              {selecionada.origem === "gerencial" && <GerencialBadge />}
              {selecionada.origem === "participante" && (
                <ParticipanteBadge classificacao={selecionada.classificacao} />
              )}
            </span>
          ) : (
            placeholder
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[520px] p-0" align="start">
        <div className="p-2 border-b border-border flex gap-2">
          <Input
            placeholder="Buscar estrutural, cliente ou fornecedor…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-8 text-xs"
            autoFocus
          />
          {onNovaConta && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs whitespace-nowrap"
              onClick={() => {
                setOpen(false);
                onNovaConta();
              }}
            >
              <Plus className="h-3 w-3 mr-1" /> Gerencial
            </Button>
          )}
        </div>
        <div className="max-h-[320px] overflow-y-auto pointer-events-auto">
          {filtered.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground text-center">
              {termo.length < 2
                ? "Digite pelo menos 2 caracteres para buscar clientes e fornecedores."
                : "Nenhuma conta."}
            </div>
          )}
          {filtered.map((c) => (
            <button
              key={`${c.origem}:${c.codigo}`}
              type="button"
              onClick={() => {
                onChange(c.codigo, c);
                setOpen(false);
              }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2",
                value === c.codigo && "bg-primary/5",
              )}
            >
              <span className="font-mono text-muted-foreground w-16">{c.codigo}</span>
              <span className="truncate flex-1">{c.descricao}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{c.classificacao}</span>
              {c.origem === "gerencial" && <GerencialBadge />}
              {c.origem === "participante" && <ParticipanteBadge classificacao={c.classificacao} />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------
// Dialog: Novo/Editar Ajuste
// ---------------------------------------------------------------------

function AjusteDialog({
  open,
  onOpenChange,
  competenciaPadrao,
  contas,
  loadingContas,
  tenantId,
  companyId,
  userId,
  editando,
  onNovaConta,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  competenciaPadrao: string;   // "YYYY-MM"
  contas: ContaOpt[];
  loadingContas: boolean;
  tenantId: string;
  companyId: string;
  userId: string | null;
  editando: AjusteRow | null;
  onNovaConta: () => void;
  onSaved: () => void;
}) {
  const [competencia, setCompetencia] = useState<string>(competenciaPadrao);
  const [descricao, setDescricao] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [contaDebito, setContaDebito] = useState("");
  const [contaCredito, setContaCredito] = useState("");
  const [valor, setValor] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Reset quando abrir
  useMemo(() => {
    if (!open) return;
    if (editando) {
      setCompetencia(ymDeCompetencia(editando.competencia));
      setDescricao(editando.descricao);
      setJustificativa(editando.justificativa ?? "");
      setContaDebito(editando.conta_debito);
      setContaCredito(editando.conta_credito);
      setValor(formatarValorDigitado(String(Math.round(editando.valor * 100))));
    } else {
      setCompetencia(competenciaPadrao);
      setDescricao("");
      setJustificativa("");
      setContaDebito("");
      setContaCredito("");
      setValor("");
    }
  }, [open, editando, competenciaPadrao]);

  const valorNum = parseValorBR(valor);
  const contasIguais = contaDebito && contaCredito && contaDebito === contaCredito;
  const valorInvalido = !Number.isFinite(valorNum) || valorNum <= 0;
  const podeSalvar =
    !!competencia &&
    descricao.trim().length > 0 &&
    contaDebito.length > 0 &&
    contaCredito.length > 0 &&
    !contasIguais &&
    !valorInvalido;

  const dInfo = contas.find((c) => c.codigo === contaDebito);
  const cInfo = contas.find((c) => c.codigo === contaCredito);

  const salvar = async () => {
    if (!podeSalvar) return;
    setBusy(true);
    try {
      const payload = {
        tenant_id: tenantId,
        company_id: companyId,
        competencia: primeiroDiaDoMes(competencia),
        descricao: descricao.trim(),
        justificativa: justificativa.trim() || null,
        conta_debito: contaDebito,
        conta_credito: contaCredito,
        valor: valorNum,
      };
      if (editando) {
        const { error } = await supabase.from("ajustes_gerenciais").update(payload).eq("id", editando.id);
        if (error) throw error;
        toast.success("Ajuste atualizado");
      } else {
        const { error } = await supabase
          .from("ajustes_gerenciais")
          .insert({ ...payload, criado_por: userId });
        if (error) throw error;
        toast.success("Ajuste lançado");
      }
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar ajuste gerencial" : "Novo ajuste gerencial"}</DialogTitle>
          <DialogDescription>
            Partida dobrada: o mesmo valor é aplicado a débito e a crédito. Não altera a contabilidade — grava apenas em ajustes gerenciais.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Competência *</Label>
              <CompetenciaPicker value={competencia} onChange={setCompetencia} />
            </div>
            <div>
              <Label className="text-xs">Valor (R$) *</Label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
                <Input
                  inputMode="numeric"
                  value={valor}
                  onChange={(e) => setValor(formatarValorDigitado(e.target.value))}
                  className="h-9 pl-8"
                  placeholder="0,00"
                />
              </div>
              {valor && valorInvalido && (
                <p className="text-[10px] text-destructive mt-0.5">Informe um valor maior que zero.</p>
              )}
            </div>
          </div>

          <div>
            <Label className="text-xs">Descrição *</Label>
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={200}
              className="h-9"
              placeholder='Ex: "Retirada real do sócio acima do pró-labore"'
            />
          </div>

          <div>
            <Label className="text-xs">Justificativa (opcional)</Label>
            <Textarea
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="Memória/auditoria interna do ajuste"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Conta a DÉBITO *</Label>
              <ContaSelect
                contas={contas}
                value={contaDebito}
                onChange={setContaDebito}
                placeholder={loadingContas ? "Carregando…" : "Escolher conta"}
                onNovaConta={onNovaConta}
                companyId={companyId}
              />
            </div>
            <div>
              <Label className="text-xs">Conta a CRÉDITO *</Label>
              <ContaSelect
                contas={contas}
                value={contaCredito}
                onChange={setContaCredito}
                placeholder={loadingContas ? "Carregando…" : "Escolher conta"}
                onNovaConta={onNovaConta}
                companyId={companyId}
              />
            </div>
          </div>
          {contasIguais && (
            <p className="text-[11px] text-destructive">Conta de débito e crédito devem ser diferentes.</p>
          )}

          {/* Resumo da partida */}
          {(dInfo || cInfo) && Number.isFinite(valorNum) && valorNum > 0 && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Prévia da partida</div>
              <div className="flex justify-between gap-3">
                <span>
                  <strong>Débito:</strong>{" "}
                  {dInfo ? `${dInfo.descricao} (${dInfo.codigo})` : "—"}
                </span>
                <span className="font-mono">{formatBRL(valorNum)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>
                  <strong>Crédito:</strong>{" "}
                  {cInfo ? `${cInfo.descricao} (${cInfo.codigo})` : "—"}
                </span>
                <span className="font-mono">{formatBRL(valorNum)}</span>
              </div>
              <div className="text-[10px] text-emerald-600 dark:text-emerald-400 pt-1">
                ✓ Partida equilibrada (D = C).
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={!podeSalvar || busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {editando ? "Salvar alterações" : "Lançar ajuste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Dialog: Nova Conta Gerencial
// ---------------------------------------------------------------------

function ContaGerencialDialog({
  open,
  onOpenChange,
  tenantId,
  companyId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  companyId: string;
  onCreated: () => void;
}) {
  const [descricao, setDescricao] = useState("");
  const [classificacao, setClassificacao] = useState("");
  const [busy, setBusy] = useState(false);

  // Contas estruturais para o seletor de classificação (grupos do plano)
  const { data: gruposPlano } = useQuery({
    queryKey: ["plano-estruturais", tenantId, companyId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await escoparPlano(
        supabase.from("plano_contas").select("classificacao, descricao, nivel"),
        companyId,
        await getEscopoConsulta(companyId),
      )
        .eq("is_participante", false)
        .lte("nivel", 4)
        .order("classificacao", { ascending: true })
        .range(0, 4999);
      if (error) throw error;
      return (data ?? []) as Array<{ classificacao: string; descricao: string; nivel: number }>;
    },
  });

  useMemo(() => {
    if (!open) {
      setDescricao("");
      setClassificacao("");
    }
  }, [open]);

  const [busca, setBusca] = useState("");
  const [openClass, setOpenClass] = useState(false);
  const classSel = gruposPlano?.find((g) => g.classificacao === classificacao);
  const filtered = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (gruposPlano ?? [])
      .filter((g) => {
        if (!b) return true;
        return g.classificacao.toLowerCase().includes(b) || g.descricao.toLowerCase().includes(b);
      })
      .slice(0, 500);
  }, [gruposPlano, busca]);

  const podeSalvar = descricao.trim().length > 0 && classificacao.length > 0;

  const gerarCodigo = async (): Promise<string> => {
    const { data, error } = await supabase
      .from("contas_gerenciais")
      .select("codigo")
      .eq("company_id", companyId)
      .like("codigo", "G%")
      .order("codigo", { ascending: false })
      .limit(1);
    if (error) throw error;
    const ultimo = (data ?? [])[0]?.codigo as string | undefined;
    let n = 0;
    if (ultimo && /^G\d+$/.test(ultimo)) n = Number(ultimo.slice(1));
    return `G${String(n + 1).padStart(4, "0")}`;
  };

  const salvar = async () => {
    if (!podeSalvar) return;
    setBusy(true);
    try {
      const codigo = await gerarCodigo();
      const { error } = await supabase.from("contas_gerenciais").insert({
        tenant_id: tenantId,
        company_id: companyId,
        codigo,
        descricao: descricao.trim(),
        classificacao: classificacao.trim(),
      });
      if (error) throw error;
      toast.success(`Conta ${codigo} criada`);
      onCreated();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova conta gerencial</DialogTitle>
          <DialogDescription>
            Cria uma conta que não existe no plano contábil (ex.: <em>Conta Corrente Sócios</em>). O código é gerado automaticamente (G0001, G0002…). A classificação define em qual grupo do plano a conta se encaixa (hierarquia e sinal).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Descrição *</Label>
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={200}
              className="h-9"
              placeholder="Ex: Conta Corrente Sócios"
            />
          </div>
          <div>
            <Label className="text-xs">Classificação (grupo do plano) *</Label>
            <Popover open={openClass} onOpenChange={setOpenClass}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn("w-full justify-start font-normal text-left h-9", !classSel && "text-muted-foreground")}
                >
                  {classSel ? (
                    <span className="flex items-center gap-2 truncate">
                      <span className="font-mono text-xs">{classSel.classificacao}</span>
                      <span className="truncate">{classSel.descricao}</span>
                    </span>
                  ) : (
                    "Escolher grupo (ex: 2.01 Passivo Circulante)"
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[460px] p-0" align="start">
                <div className="p-2 border-b border-border">
                  <Input
                    placeholder="Buscar…"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    className="h-8 text-xs"
                    autoFocus
                  />
                </div>
                <div className="max-h-[320px] overflow-y-auto pointer-events-auto">
                  {filtered.map((g) => (
                    <button
                      key={g.classificacao}
                      type="button"
                      onClick={() => {
                        setClassificacao(g.classificacao);
                        setOpenClass(false);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2",
                        classSel?.classificacao === g.classificacao && "bg-primary/5",
                      )}
                      style={{ paddingLeft: `${Math.min(g.nivel ?? 1, 6) * 8 + 12}px` }}
                    >
                      <span className="font-mono text-muted-foreground">{g.classificacao}</span>
                      <span className="truncate">{g.descricao}</span>
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <div className="p-3 text-xs text-muted-foreground text-center">Nenhuma classificação.</div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <p className="text-[10px] text-muted-foreground mt-1">
              A conta gerencial herda o grupo, a hierarquia e o sinal desta classificação.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={!podeSalvar || busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Criar conta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// CompetenciaPicker: dois selects (mês + ano). Substitui o input
// type="month" nativo, que era inacessível em alguns browsers/temas.
// value/onChange usam o formato "YYYY-MM".
// ---------------------------------------------------------------------

const MESES_LABEL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function CompetenciaPicker({
  value,
  onChange,
}: {
  value: string;                       // "YYYY-MM"
  onChange: (v: string) => void;
}) {
  const [ano, mes] = value.split("-");
  const anoNum = Number(ano) || new Date().getFullYear();
  const mesNum = Number(mes) || 1;
  const anoAtual = new Date().getFullYear();
  // 10 anos passados até 2 anos futuros
  const anos: number[] = [];
  for (let a = anoAtual - 10; a <= anoAtual + 2; a++) anos.push(a);

  const setMes = (m: string) => onChange(`${anoNum}-${String(Number(m)).padStart(2, "0")}`);
  const setAno = (a: string) => onChange(`${a}-${String(mesNum).padStart(2, "0")}`);

  return (
    <div className="flex gap-2">
      <Select value={String(mesNum)} onValueChange={setMes}>
        <SelectTrigger className="h-9 w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MESES_LABEL.map((label, i) => (
            <SelectItem key={i + 1} value={String(i + 1)}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={String(anoNum)} onValueChange={setAno}>
        <SelectTrigger className="h-9 w-[100px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {anos.map((a) => (
            <SelectItem key={a} value={String(a)}>{a}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
