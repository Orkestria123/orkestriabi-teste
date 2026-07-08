// Grade de planejamento (Etapa 3 do módulo Orçamento).
// Mostra os itens do orçamento nas linhas e os 12 meses do ano nas colunas.
// Cada célula é editável; salva incrementalmente em `orcamento_valores`.
// Ferramentas: Puxar do histórico, Distribuir total anual, Aplicar reajuste,
// Copiar valor para todos os meses.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  Download,
  Percent,
  Copy,
  Wand2,
  Save,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/format";
import { computeRealizadoPorItem } from "@/lib/orcamento/realizado";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface OrcamentoHeader {
  id: string;
  tenant_id: string;
  company_id: string;
  ano: number;
  tipo_base: "zero" | "historico";
  periodo_base_inicio: string | null;
  periodo_base_fim: string | null;
  realizado_visao: "contabil" | "gerencial";
}

interface OrcamentoItem {
  id: string;
  rotulo: string;
  contas: string[];
  tipo_conta: string | null;
  ordem: number | null;
}

interface Valor {
  item_id: string;
  competencia: string; // YYYY-MM-DD
  valor_orcado: number;
}

interface Props {
  orcamento: OrcamentoHeader;
  itens: OrcamentoItem[];
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

const NOMES_MES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

function mesesDoAno(ano: number): string[] {
  return NOMES_MES.map((_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`);
}

function parseBRL(raw: string): number {
  if (!raw) return 0;
  // aceita "1.234,56" e "1234.56"
  const s = raw.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmtInput(n: number): string {
  if (!n) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------

export function OrcamentoPlanejamentoGrid({ orcamento, itens }: Props) {
  const qc = useQueryClient();
  const meses = useMemo(() => mesesDoAno(orcamento.ano), [orcamento.ano]);

  const { data: valoresRaw, isLoading } = useQuery({
    queryKey: ["orcamento-valores", orcamento.id],
    queryFn: async (): Promise<Valor[]> => {
      const { data, error } = await supabase
        .from("orcamento_valores")
        .select("item_id, competencia, valor_orcado")
        .eq("orcamento_id", orcamento.id)
        .range(0, 9999);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        item_id: r.item_id,
        competencia: r.competencia,
        valor_orcado: Number(r.valor_orcado),
      }));
    },
  });

  // Estado local em edição — chave "item|YYYY-MM" → number
  const [local, setLocal] = useState<Record<string, number>>({});
  // Rascunho de texto por célula (para preservar edição enquanto digita)
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [savingMap, setSavingMap] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!valoresRaw) return;
    const m: Record<string, number> = {};
    for (const v of valoresRaw) {
      const ym = v.competencia.slice(0, 7);
      m[`${v.item_id}|${ym}`] = v.valor_orcado;
    }
    setLocal(m);
    setDrafts({});
    setDirty(new Set());
  }, [valoresRaw]);

  const getVal = (itemId: string, ym: string): number => local[`${itemId}|${ym}`] ?? 0;

  const setVal = (itemId: string, ym: string, valor: number) => {
    const key = `${itemId}|${ym}`;
    setLocal((prev) => ({ ...prev, [key]: valor }));
    setDirty((prev) => new Set(prev).add(key));
  };

  const saveCell = async (itemId: string, ym: string, valor: number) => {
    const key = `${itemId}|${ym}`;
    setSavingMap((prev) => new Set(prev).add(key));
    try {
      const { error } = await supabase
        .from("orcamento_valores")
        .upsert(
          {
            tenant_id: orcamento.tenant_id,
            company_id: orcamento.company_id,
            orcamento_id: orcamento.id,
            item_id: itemId,
            competencia: `${ym}-01`,
            valor_orcado: valor,
          },
          { onConflict: "item_id,competencia" },
        );
      if (error) throw error;
      setDirty((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    } catch (e: any) {
      toast.error(`Erro ao salvar: ${e.message ?? e}`);
    } finally {
      setSavingMap((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // Salvar todas as células sujas
  const salvarTudo = async () => {
    const keys = Array.from(dirty);
    if (keys.length === 0) return;
    const rows = keys.map((k) => {
      const [itemId, ym] = k.split("|");
      return {
        tenant_id: orcamento.tenant_id,
        company_id: orcamento.company_id,
        orcamento_id: orcamento.id,
        item_id: itemId,
        competencia: `${ym}-01`,
        valor_orcado: local[k] ?? 0,
      };
    });
    setSavingMap(new Set(keys));
    try {
      const { error } = await supabase
        .from("orcamento_valores")
        .upsert(rows, { onConflict: "item_id,competencia" });
      if (error) throw error;
      setDirty(new Set());
      toast.success(`${rows.length} valor(es) salvos`);
      qc.invalidateQueries({ queryKey: ["orcamento-valores", orcamento.id] });
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setSavingMap(new Set());
    }
  };

  const totalItem = (itemId: string) =>
    meses.reduce((s, m) => s + getVal(itemId, m), 0);
  const totalMes = (ym: string) =>
    itens.reduce((s, it) => s + getVal(it.id, ym), 0);
  const totalGeral = itens.reduce((s, it) => s + totalItem(it.id), 0);

  // ---------- Ferramentas ----------
  const [openHist, setOpenHist] = useState(false);
  const [openReajuste, setOpenReajuste] = useState(false);
  const [openDistribuir, setOpenDistribuir] = useState<{ itemId: string } | null>(
    null,
  );
  const [openCopiar, setOpenCopiar] = useState(false);

  const podeHistorico =
    orcamento.tipo_base === "historico" &&
    !!orcamento.periodo_base_inicio &&
    !!orcamento.periodo_base_fim;

  const aplicarValores = async (
    valores: Array<{ itemId: string; ym: string; valor: number }>,
    msg: string,
  ) => {
    // Atualiza local + persiste em bloco
    const next = { ...local };
    for (const v of valores) next[`${v.itemId}|${v.ym}`] = v.valor;
    setLocal(next);
    const rows = valores.map((v) => ({
      tenant_id: orcamento.tenant_id,
      company_id: orcamento.company_id,
      orcamento_id: orcamento.id,
      item_id: v.itemId,
      competencia: `${v.ym}-01`,
      valor_orcado: v.valor,
    }));
    try {
      const { error } = await supabase
        .from("orcamento_valores")
        .upsert(rows, { onConflict: "item_id,competencia" });
      if (error) throw error;
      setDirty(new Set());
      qc.invalidateQueries({ queryKey: ["orcamento-valores", orcamento.id] });
      toast.success(msg);
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    }
  };

  const copiarParaTodos = async (itemId: string, ymOrigem: string) => {
    const valor = getVal(itemId, ymOrigem);
    const updates = meses.map((m) => ({ itemId, ym: m, valor }));
    await aplicarValores(updates, `Valor copiado para todos os meses`);
  };

  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-3 border-b border-border flex flex-wrap items-center gap-2 justify-between">
        <div className="text-sm font-medium">Planejamento {orcamento.ano}</div>
        <div className="flex flex-wrap gap-2">
          {podeHistorico && (
            <Button size="sm" variant="outline" onClick={() => setOpenHist(true)}>
              <Download className="h-4 w-4 mr-1" /> Puxar do histórico
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setOpenDistribuir({ itemId: itens[0]?.id ?? "" })
            }
            disabled={itens.length === 0}
          >
            <Wand2 className="h-4 w-4 mr-1" /> Distribuir
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpenCopiar(true)}
            disabled={itens.length === 0}
          >
            <Copy className="h-4 w-4 mr-1" /> Copiar p/ todos
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpenReajuste(true)}
            disabled={itens.length === 0}
          >
            <Percent className="h-4 w-4 mr-1" /> Aplicar reajuste
          </Button>
          <Button
            size="sm"
            onClick={salvarTudo}
            disabled={dirty.size === 0 || savingMap.size > 0}
          >
            {savingMap.size > 0 ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Salvar ({dirty.size})
          </Button>
        </div>
      </div>


      {isLoading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="inline h-4 w-4 animate-spin mr-1" /> Carregando…
        </div>
      ) : itens.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Cadastre pelo menos um item para começar a planejar.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left p-2 sticky left-0 bg-muted/50 z-10 min-w-[200px]">
                  Item
                </th>
                {meses.map((m, i) => (
                  <th key={m} className="text-right p-2 min-w-[100px]">
                    {NOMES_MES[i]}
                  </th>
                ))}
                <th className="text-right p-2 min-w-[120px] bg-primary/5">
                  Total Ano
                </th>
                <th className="p-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {itens.map((it) => {
                const tot = totalItem(it.id);
                return (
                  <tr key={it.id} className="border-t border-border hover:bg-accent/20">
                    <td className="p-2 sticky left-0 bg-background z-10 border-r border-border">
                      <div className="font-medium">{it.rotulo}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {it.tipo_conta ?? "—"} · {it.contas.length} conta(s)
                      </div>
                    </td>
                    {meses.map((m) => {
                      const key = `${it.id}|${m}`;
                      const isDirty = dirty.has(key);
                      const isSaving = savingMap.has(key);
                      const rawDraft = drafts[key];
                      const displayed =
                        rawDraft !== undefined ? rawDraft : fmtInput(getVal(it.id, m));
                      return (
                        <td key={m} className="p-1 text-right relative group">
                          <Input
                            value={displayed}
                            onChange={(e) => {
                              setDrafts((prev) => ({ ...prev, [key]: e.target.value }));
                            }}
                            onBlur={() => {
                              const val = parseBRL(drafts[key] ?? "");
                              setDrafts((prev) => {
                                const next = { ...prev };
                                delete next[key];
                                return next;
                              });
                              const atual = getVal(it.id, m);
                              if (val !== atual) {
                                setVal(it.id, m, val);
                                void saveCell(it.id, m, val);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                            className={cn(
                              "h-8 text-right text-xs tabular-nums px-2 border-transparent hover:border-border focus:border-primary",
                              isDirty && "border-amber-500/60 bg-amber-50/30 dark:bg-amber-500/5",
                              isSaving && "opacity-60",
                            )}
                          />
                        </td>
                      );
                    })}
                    <td className="p-2 text-right font-semibold tabular-nums bg-primary/5">
                      <button
                        type="button"
                        className="hover:underline"
                        title="Distribuir total anual"
                        onClick={() => setOpenDistribuir({ itemId: it.id })}
                      >
                        {formatBRL(tot)}
                      </button>
                    </td>
                    <td className="p-1 text-center">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100"
                        title="Copiar Jan para todos os meses"
                        onClick={() => copiarParaTodos(it.id, meses[0])}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {/* Totais por mês */}
              <tr className="bg-muted/40 border-t-2 border-border font-semibold">
                <td className="p-2 sticky left-0 bg-muted/40 z-10">Total geral</td>
                {meses.map((m) => (
                  <td key={m} className="p-2 text-right tabular-nums">
                    {formatBRL(totalMes(m))}
                  </td>
                ))}
                <td className="p-2 text-right tabular-nums bg-primary/10">
                  {formatBRL(totalGeral)}
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Dialogs */}
      <PuxarHistoricoDialog
        open={openHist}
        onOpenChange={setOpenHist}
        orcamento={orcamento}
        itens={itens}
        onAplicar={aplicarValores}
      />
      <ReajusteDialog
        open={openReajuste}
        onOpenChange={setOpenReajuste}
        itens={itens}
        local={local}
        meses={meses}
        onAplicar={aplicarValores}
      />
      {openDistribuir && itens.length > 0 && (
        <DistribuirDialog
          open={!!openDistribuir}
          onOpenChange={(v) => !v && setOpenDistribuir(null)}
          itens={itens}
          itemIdInicial={openDistribuir.itemId || itens[0].id}
          orcamento={orcamento}
          meses={meses}
          totaisPorItem={Object.fromEntries(itens.map((i) => [i.id, totalItem(i.id)]))}
          onAplicar={aplicarValores}
        />
      )}
      {openCopiar && (
        <CopiarDialog
          open={openCopiar}
          onOpenChange={setOpenCopiar}
          itens={itens}
          meses={meses}
          local={local}
          onAplicar={aplicarValores}
        />
      )}
    </Card>
  );
}


// ---------------------------------------------------------------------
// Dialog: Puxar do histórico
// ---------------------------------------------------------------------

function PuxarHistoricoDialog({
  open,
  onOpenChange,
  orcamento,
  itens,
  onAplicar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orcamento: OrcamentoHeader;
  itens: OrcamentoItem[];
  onAplicar: (
    v: Array<{ itemId: string; ym: string; valor: number }>,
    msg: string,
  ) => Promise<void>;
}) {
  const [modo, setModo] = useState<"igual" | "sazonal">("sazonal");
  const [busy, setBusy] = useState(false);
  const [sobrescrever, setSobrescrever] = useState(true);

  const inicioBase = orcamento.periodo_base_inicio?.slice(0, 7) ?? "";
  const fimBase = orcamento.periodo_base_fim?.slice(0, 7) ?? "";

  const puxar = async () => {
    if (!inicioBase || !fimBase) return;
    setBusy(true);
    try {
      const res = await computeRealizadoPorItem({
        tenantId: orcamento.tenant_id,
        companyId: orcamento.company_id,
        visao: orcamento.realizado_visao,
        inicio: inicioBase,
        fim: fimBase,
        itens: itens.map((i) => ({ id: i.id, contas: i.contas })),
      });

      const mesesDestino = mesesDoAno(orcamento.ano);
      const updates: Array<{ itemId: string; ym: string; valor: number }> = [];

      for (const it of itens) {
        const r = res.porItem[it.id];
        if (!r) continue;
        if (modo === "igual" || res.meses.length !== 12) {
          const cada = r.total / 12;
          for (const m of mesesDestino) {
            updates.push({ itemId: it.id, ym: m, valor: Math.round(cada * 100) / 100 });
          }
        } else {
          // sazonal: casa mês a mês (jan hist → jan orçado, etc.)
          for (let i = 0; i < 12; i++) {
            const mesBase = res.meses[i];
            const valor = r.porMes[mesBase] ?? 0;
            updates.push({
              itemId: it.id,
              ym: mesesDestino[i],
              valor: Math.round(valor * 100) / 100,
            });
          }
        }
      }

      const filtrados = sobrescrever ? updates : updates.filter((u) => u.valor !== 0);
      await onAplicar(filtrados, `Histórico aplicado a ${itens.length} item(ns)`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Puxar do histórico</DialogTitle>
          <DialogDescription>
            Preenche os valores usando o realizado do período de referência (
            {inicioBase} a {fimBase}), na visão{" "}
            <strong>{orcamento.realizado_visao}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Distribuição</Label>
            <Select value={modo} onValueChange={(v) => setModo(v as any)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sazonal">
                  Seguindo a sazonalidade (mês a mês)
                </SelectItem>
                <SelectItem value="igual">Igualmente (total ÷ 12)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">
              "Sazonalidade" só funciona quando o período base tem exatamente 12 meses.
              Caso contrário, usa distribuição igual.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={sobrescrever}
              onChange={(e) => setSobrescrever(e.target.checked)}
            />
            Sobrescrever valores já preenchidos
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={puxar} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Dialog: Aplicar reajuste
// ---------------------------------------------------------------------

function ReajusteDialog({
  open,
  onOpenChange,
  itens,
  local,
  meses,
  onAplicar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  itens: OrcamentoItem[];
  local: Record<string, number>;
  meses: string[];
  onAplicar: (
    v: Array<{ itemId: string; ym: string; valor: number }>,
    msg: string,
  ) => Promise<void>;
}) {
  const [pct, setPct] = useState<string>("10");
  const [alvo, setAlvo] = useState<"todos" | string>("todos");
  const [escopo, setEscopo] = useState<"todos" | "apartir" | "apenas">("todos");
  const [mesRef, setMesRef] = useState<string>(meses[0]);
  const [busy, setBusy] = useState(false);

  const aplicar = async () => {
    const p = Number(String(pct).replace(",", "."));
    if (!Number.isFinite(p)) return toast.error("Percentual inválido");
    const fator = 1 + p / 100;
    setBusy(true);
    try {
      const idxRef = meses.indexOf(mesRef);
      const mesesAlvo =
        escopo === "todos"
          ? meses
          : escopo === "apartir"
            ? meses.slice(Math.max(0, idxRef))
            : [mesRef];
      const updates: Array<{ itemId: string; ym: string; valor: number }> = [];
      const alvoIds = alvo === "todos" ? itens.map((i) => i.id) : [alvo];
      for (const itemId of alvoIds) {
        for (const m of mesesAlvo) {
          const key = `${itemId}|${m}`;
          const atual = local[key] ?? 0;
          if (atual === 0) continue;
          updates.push({
            itemId,
            ym: m,
            valor: Math.round(atual * fator * 100) / 100,
          });
        }
      }
      const descEscopo =
        escopo === "todos"
          ? "todos os meses"
          : escopo === "apartir"
            ? `a partir de ${NOMES_MES[Math.max(0, idxRef)]}`
            : `apenas ${NOMES_MES[Math.max(0, idxRef)]}`;
      await onAplicar(
        updates,
        `Reajuste de ${p >= 0 ? "+" : ""}${p}% (${descEscopo}) aplicado a ${updates.length} valor(es)`,
      );
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Aplicar reajuste</DialogTitle>
          <DialogDescription>
            Aumenta ou diminui os valores existentes por um percentual (positivo ou
            negativo). Não afeta células zeradas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Aplicar a</Label>
            <Select value={alvo} onValueChange={setAlvo}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os itens</SelectItem>
                {itens.map((it) => (
                  <SelectItem key={it.id} value={it.id}>
                    {it.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Percentual (%)</Label>
            <Input
              type="text"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              placeholder="+10 ou -5"
            />
          </div>
          <div>
            <Label className="text-xs">Aplicar em</Label>
            <Select value={escopo} onValueChange={(v) => setEscopo(v as any)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os meses</SelectItem>
                <SelectItem value="apartir">A partir de…</SelectItem>
                <SelectItem value="apenas">Apenas o mês…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {escopo !== "todos" && (
            <div>
              <Label className="text-xs">Mês</Label>
              <Select value={mesRef} onValueChange={setMesRef}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {meses.map((m, i) => (
                    <SelectItem key={m} value={m}>
                      {NOMES_MES[i]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={aplicar} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

}

// ---------------------------------------------------------------------
// Dialog: Distribuir total anual
// ---------------------------------------------------------------------

function DistribuirDialog({
  open,
  onOpenChange,
  itens,
  itemIdInicial,
  orcamento,
  meses,
  totaisPorItem,
  onAplicar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  itens: OrcamentoItem[];
  itemIdInicial: string;
  orcamento: OrcamentoHeader;
  meses: string[];
  totaisPorItem: Record<string, number>;
  onAplicar: (
    v: Array<{ itemId: string; ym: string; valor: number }>,
    msg: string,
  ) => Promise<void>;
}) {
  const [itemId, setItemId] = useState<string>(itemIdInicial);
  const item = itens.find((i) => i.id === itemId) ?? itens[0];
  const totalAtual = totaisPorItem[itemId] ?? 0;
  const [totalStr, setTotalStr] = useState<string>(fmtInput(totalAtual));
  const [modo, setModo] = useState<"igual" | "sazonal">("igual");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setItemId(itemIdInicial);
    }
  }, [open, itemIdInicial]);

  useEffect(() => {
    setTotalStr(fmtInput(totaisPorItem[itemId] ?? 0));
  }, [itemId, totaisPorItem]);

  const podeSazonal =
    orcamento.tipo_base === "historico" &&
    !!orcamento.periodo_base_inicio &&
    !!orcamento.periodo_base_fim;

  const distribuir = async () => {
    if (!item) return;
    const total = parseBRL(totalStr);
    setBusy(true);
    try {
      const updates: Array<{ itemId: string; ym: string; valor: number }> = [];
      if (modo === "igual" || !podeSazonal) {
        const cada = total / 12;
        for (const m of meses) {
          updates.push({ itemId: item.id, ym: m, valor: Math.round(cada * 100) / 100 });
        }
      } else {
        const res = await computeRealizadoPorItem({
          tenantId: orcamento.tenant_id,
          companyId: orcamento.company_id,
          visao: orcamento.realizado_visao,
          inicio: orcamento.periodo_base_inicio!.slice(0, 7),
          fim: orcamento.periodo_base_fim!.slice(0, 7),
          itens: [{ id: item.id, contas: item.contas }],
        });
        const r = res.porItem[item.id];
        const totalHist = r?.total ?? 0;
        if (totalHist === 0 || res.meses.length !== 12) {
          const cada = total / 12;
          for (const m of meses) {
            updates.push({ itemId: item.id, ym: m, valor: Math.round(cada * 100) / 100 });
          }
        } else {
          for (let i = 0; i < 12; i++) {
            const peso = (r!.porMes[res.meses[i]] ?? 0) / totalHist;
            const valor = total * peso;
            updates.push({
              itemId: item.id,
              ym: meses[i],
              valor: Math.round(valor * 100) / 100,
            });
          }
        }
      }
      await onAplicar(updates, `Distribuição aplicada a "${item.rotulo}"`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Distribuir total anual</DialogTitle>
          <DialogDescription>
            Informe o total do ano; o sistema divide entre os 12 meses.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {itens.map((it) => (
                  <SelectItem key={it.id} value={it.id}>
                    {it.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Total do ano</Label>
            <Input
              value={totalStr}
              onChange={(e) => setTotalStr(e.target.value)}
              className="text-right tabular-nums"
            />
          </div>
          <div>
            <Label className="text-xs">Distribuição</Label>
            <Select value={modo} onValueChange={(v) => setModo(v as any)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="igual">Igualmente (÷ 12)</SelectItem>
                <SelectItem value="sazonal" disabled={!podeSazonal}>
                  Sazonalidade do histórico{!podeSazonal && " (não disponível)"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={distribuir} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Distribuir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Dialog: Copiar valor para todos os meses
// ---------------------------------------------------------------------

function CopiarDialog({
  open,
  onOpenChange,
  itens,
  meses,
  local,
  onAplicar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  itens: OrcamentoItem[];
  meses: string[];
  local: Record<string, number>;
  onAplicar: (
    v: Array<{ itemId: string; ym: string; valor: number }>,
    msg: string,
  ) => Promise<void>;
}) {
  const [itemId, setItemId] = useState<string>(itens[0]?.id ?? "");
  const [mesOrigem, setMesOrigem] = useState<string>(meses[0]);
  const [valorStr, setValorStr] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const atual = local[`${itemId}|${mesOrigem}`] ?? 0;
    setValorStr(fmtInput(atual));
  }, [open, itemId, mesOrigem, local]);

  const aplicar = async () => {
    if (!itemId) return;
    const valor = parseBRL(valorStr);
    setBusy(true);
    try {
      const updates = meses.map((m) => ({ itemId, ym: m, valor }));
      const rot = itens.find((i) => i.id === itemId)?.rotulo ?? "";
      await onAplicar(updates, `Valor replicado em todos os meses de "${rot}"`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copiar para todos os meses</DialogTitle>
          <DialogDescription>
            Preenche todos os 12 meses do item com o mesmo valor. Útil para despesas
            fixas (aluguel, mensalidades, etc.).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {itens.map((it) => (
                  <SelectItem key={it.id} value={it.id}>
                    {it.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Valor</Label>
            <Input
              value={valorStr}
              onChange={(e) => setValorStr(e.target.value)}
              className="text-right tabular-nums"
              placeholder="0,00"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Sugestão pré-preenchida com o valor atual de{" "}
              {NOMES_MES[Math.max(0, meses.indexOf(mesOrigem))]}. Pode editar.
            </p>
          </div>
          <div>
            <Label className="text-xs">Referência (mês para pré-preencher)</Label>
            <Select value={mesOrigem} onValueChange={setMesOrigem}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {meses.map((m, i) => (
                  <SelectItem key={m} value={m}>
                    {NOMES_MES[i]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={aplicar} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

