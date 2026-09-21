// Painel do escritório: criar/editar análises com a mesma lógica de
// fórmulas dos indicadores (FormulaBuilder) e escolher onde aparecem.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
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
import { FormulaBuilder } from "@/components/indicadores/formula-builder";
import { type ContaPlanoItem } from "@/components/indicadores/conta-picker";
import { lerTudo } from "@/lib/supabase-paginado";
import {
  FORMATOS_ANALISE,
  GRAFICOS_ANALISE,
  SECOES_ANALISE,
  secaoLabel,
  useAnaliseConfigs,
  type AnaliseConfigRow,
  type FormatoAnalise,
  type GraficoAnalise,
  type SecaoAnalise,
} from "@/lib/analise-configs";
import { tokensDaFormula, type Token } from "@/lib/indicadores/engine";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

interface Props {
  tenantId: string;
}

export function AnalisesConfigPanel({ tenantId }: Props) {
  const { data: configs = [], isLoading, refetch } = useAnaliseConfigs(tenantId, false);
  const [editando, setEditando] = useState<AnaliseConfigRow | null>(null);
  const [criando, setCriando] = useState(false);

  const porSecao = useMemo(() => {
    const m = new Map<string, AnaliseConfigRow[]>();
    for (const s of SECOES_ANALISE) m.set(s.id, []);
    for (const c of configs) {
      if (!m.has(c.secao)) m.set(c.secao, []);
      m.get(c.secao)!.push(c);
    }
    return m;
  }, [configs]);

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium text-sm">Análises configuráveis</div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Monte fórmulas com a mesma lógica dos indicadores (linhas da DRE/Balanço e
            contas do plano padrão). Defina o formato, o gráfico e onde cada análise aparece.
          </p>
        </div>
        <Button size="sm" onClick={() => setCriando(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Nova análise
        </Button>
      </Card>

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando…</Card>
      ) : (
        SECOES_ANALISE.map((s) => {
          const lista = porSecao.get(s.id) ?? [];
          return (
            <Card key={s.id} className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold">{s.label}</h3>
                  <p className="text-xs text-muted-foreground">{s.descricao}</p>
                </div>
                <Badge variant="outline">{lista.length}</Badge>
              </div>
              {lista.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma análise nesta seção.</p>
              ) : (
                <div className="space-y-2">
                  {lista.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{c.nome}</span>
                          {!c.visivel && (
                            <Badge variant="outline" className="text-[10px]">
                              oculta
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {secaoLabel(c.secao)} · {c.formato} · gráfico {c.grafico}
                          {c.descricao ? ` — ${c.descricao}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon" variant="ghost" onClick={() => setEditando(c)} aria-label="Editar">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <ExcluirBotao
                          id={c.id}
                          nome={c.nome}
                          onDone={() => refetch()}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })
      )}

      <AnaliseEditorDialog
        tenantId={tenantId}
        config={editando}
        open={criando || !!editando}
        onClose={() => {
          setCriando(false);
          setEditando(null);
        }}
        onSaved={() => {
          setCriando(false);
          setEditando(null);
          refetch();
        }}
      />
    </div>
  );
}

function ExcluirBotao({ id, nome, onDone }: { id: string; nome: string; onDone: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  return (
    <Button
      size="icon"
      variant="ghost"
      disabled={ocupado}
      onClick={async () => {
        if (!confirm(`Excluir a análise "${nome}"?`)) return;
        setOcupado(true);
        await supabase.from("analise_configs").delete().eq("id", id);
        setOcupado(false);
        onDone();
      }}
      aria-label="Excluir"
    >
      {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </Button>
  );
}

// ============================================================
// Editor
// ============================================================

function AnaliseEditorDialog({
  tenantId,
  config,
  open,
  onClose,
  onSaved,
}: {
  tenantId: string;
  config: AnaliseConfigRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nome, setNome] = useState("");
  const [secao, setSecao] = useState<SecaoAnalise>("geral");
  const [descricao, setDescricao] = useState("");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [formato, setFormato] = useState<FormatoAnalise>("reais");
  const [grafico, setGrafico] = useState<GraficoAnalise>("linha");
  const [visivel, setVisivel] = useState(true);
  const [ordem, setOrdem] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Plano padrão (estrutural, todas as classes) para o FormulaBuilder.
  const { data: plano = [], isLoading: loadPlano } = useQuery({
    queryKey: ["analises-plano", tenantId],
    enabled: open,
    staleTime: 10 * 60_000,
    queryFn: () =>
      lerTudo<ContaPlanoItem>(
        (de, ate) =>
          supabase
            .from("plano_contas")
            .select("codigo, classificacao, descricao, is_sintetica, is_participante, nivel")
            .eq("tenant_id", tenantId)
            .is("company_id", null)
            .eq("is_participante", false)
            .order("classificacao")
            .range(de, ate),
        "plano_contas (análises)",
      ),
  });

  useEffect(() => {
    if (!open) return;
    setNome(config?.nome ?? "");
    setSecao(config?.secao ?? "geral");
    setDescricao(config?.descricao ?? "");
    setTokens(tokensDaFormula(config?.formula));
    setFormato(config?.formato ?? "reais");
    setGrafico(config?.grafico ?? "linha");
    setVisivel(config?.visivel ?? true);
    setOrdem(config?.ordem ?? 0);
    setErro(null);
  }, [open, config]);

  const salvar = async () => {
    if (!nome.trim()) {
      setErro("Informe o nome da análise.");
      return;
    }
    const temTermo = tokens.some((t) => t.tipo === "termo");
    if (!temTermo) {
      setErro("A fórmula precisa de ao menos uma linha ou conta.");
      return;
    }
    setSalvando(true);
    setErro(null);
    const payload = {
      tenant_id: tenantId,
      secao,
      nome: nome.trim(),
      descricao: descricao.trim() || null,
      formula: { expressao: tokens },
      formato,
      grafico,
      visivel,
      ordem,
      updated_at: new Date().toISOString(),
    };
    const { error } = config
      ? await supabase.from("analise_configs").update(payload).eq("id", config.id)
      : await supabase.from("analise_configs").insert(payload);
    setSalvando(false);
    if (error) {
      setErro(error.message);
      return;
    }
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{config ? "Editar análise" : "Nova análise"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Necessidade de Capital de Giro" />
            </div>
            <div className="space-y-1.5">
              <Label>Seção</Label>
              <Select value={secao} onValueChange={(v) => setSecao(v as SecaoAnalise)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SECOES_ANALISE.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Formato</Label>
              <Select value={formato} onValueChange={(v) => setFormato(v as FormatoAnalise)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FORMATOS_ANALISE.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Gráfico</Label>
              <Select value={grafico} onValueChange={(v) => setGrafico(v as GraficoAnalise)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GRAFICOS_ANALISE.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Descrição (opcional)</Label>
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Explica para o cliente o que a análise mostra" />
          </div>

          <div className="space-y-1.5">
            <Label>Fórmula</Label>
            {loadPlano ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-4 border rounded-md">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando plano padrão…
              </div>
            ) : (
              <FormulaBuilder plano={plano} tokens={tokens} onChange={setTokens} />
            )}
            <p className="text-[11px] text-muted-foreground">
              Use linhas prontas (Receita Líquida, Custos Fixos…) ou contas do plano padrão,
              igual aos indicadores.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <Label htmlFor="visivel-analise">Visível no dashboard</Label>
              <p className="text-[11px] text-muted-foreground">
                Oculto fica só para uso interno / edição posterior.
              </p>
            </div>
            <Switch id="visivel-analise" checked={visivel} onCheckedChange={setVisivel} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label>Ordem</Label>
              <Input
                type="number"
                value={ordem}
                onChange={(e) => setOrdem(parseInt(e.target.value || "0", 10))}
              />
            </div>
            <div className="col-span-2 md:col-span-2 flex items-end">
              {(() => {
                const n = tokens.flatMap((t) => (t.tipo === "termo" ? t.contas ?? [] : [])).length;
                return n > 0 ? (
                  <p className="text-[11px] text-muted-foreground">{n} conta(s) citada(s) na fórmula.</p>
                ) : null;
              })()}
            </div>
          </div>

          {erro && <p className="text-xs text-destructive">{erro}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando} className="gap-2">
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
              {config ? "Salvar alterações" : "Criar análise"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

