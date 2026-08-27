// Contas novas detectadas no DIÁRIO — com cadastro EM LOTE.
//
// O caso real é volume: todo mês entram dezenas de clientes e
// fornecedores novos. Duas coisas tornam isso rápido:
//
//   1. O nome vem do próprio diário (o parser passou a ler a coluna de
//      nome da conta, que antes era descartada). Você não digita nada.
//   2. Cliente/fornecedor sempre entra sob a mesma sintética pai, então
//      dá para selecionar todas, escolher o pai UMA vez, e o banco
//      numera as filhas em sequência (continuando de onde parou).
//
// Casos fora do padrão continuam editáveis linha a linha.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Loader2, Search, Trash2, Layers } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";

interface ContaNova {
  codigo: string;
  nome_sugerido: string | null;
  movimento: number;
  lancamentos: number;
  historico_exemplo: string | null;
  empresas: string | null;
  primeira_competencia: string | null;
  ultima_competencia: string | null;
}

interface Sintetica {
  codigo: string;
  classificacao: string;
  descricao: string;
  tipo: string;
  filhos: number;
}

const TIPOS = [
  "4-Cli. Nac.", "5-For. Nac.", "6-Cli. Ex.", "7-For. Ex.",
  "1-Ativo", "2-Passivo", "3-DRE",
];

export function ContasNovasEmpresaPanel({
  tenantId, companyId, podeEditar = true,
}: { tenantId: string; companyId?: string; podeEditar?: boolean }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [paiLote, setPaiLote] = useState("");
  const [tipoLote, setTipoLote] = useState("");
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const { data: novas, isLoading } = useQuery({
    queryKey: ["contas-novas-empresa", tenantId, companyId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("contas_novas_do_diario", {
        _tenant_id: tenantId, _limite: 500,
      });
      if (error) throw error;
      return (data ?? []) as ContaNova[];
    },
  });

  const { data: sinteticas } = useQuery({
    queryKey: ["sinteticas-plano-padrao", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("sinteticas_do_plano_padrao", {
        _tenant_id: tenantId,
      });
      if (error) throw error;
      return (data ?? []) as Sintetica[];
    },
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["contas-novas-empresa", tenantId, companyId] });
    qc.invalidateQueries({ queryKey: ["plano-padrao-resumo", tenantId] });
    qc.invalidateQueries({ queryKey: ["sinteticas-plano-padrao", tenantId] });
  };

  const filtradas = useMemo(() => {
    const s = busca.trim().toLowerCase();
    const base = novas ?? [];
    if (!s) return base;
    return base.filter((c) =>
      [c.codigo, c.nome_sugerido, c.historico_exemplo].some((v) => v?.toLowerCase().includes(s)),
    );
  }, [novas, busca]);

  const toggle = (codigo: string) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(codigo) ? n.delete(codigo) : n.add(codigo);
      return n;
    });

  const toggleTodas = () =>
    setSel((s) => (s.size === filtradas.length ? new Set() : new Set(filtradas.map((c) => c.codigo))));

  const nomeDe = (c: ContaNova) => nomes[c.codigo] ?? c.nome_sugerido ?? c.codigo;

  const semNome = useMemo(
    () => filtradas.filter((c) => sel.has(c.codigo) && !c.nome_sugerido && !nomes[c.codigo]).length,
    [filtradas, sel, nomes],
  );

  const aplicarLote = async () => {
    if (!paiLote || !tipoLote) {
      toast.error("Escolha a conta pai e o tipo.");
      return;
    }
    const itens = (novas ?? [])
      .filter((c) => sel.has(c.codigo))
      .map((c) => ({
        codigo: c.codigo,
        descricao: nomeDe(c),
        tipo: tipoLote,
        classificacao_pai: paiLote,
      }));
    if (itens.length === 0) return;
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("aprovar_contas_novas_lote", {
        _tenant_id: tenantId, _itens: itens as any,
      });
      if (error) throw error;
      const r = data as any;
      toast.success(
        `${r.inseridas} conta(s) cadastrada(s) sob ${paiLote}` +
          (r.puladas > 0 ? ` · ${r.puladas} já existia(m)` : ""),
      );
      setSel(new Set());
      setNomes({});
      invalidar();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const descartarSelecionadas = async () => {
    const codigos = Array.from(sel);
    if (codigos.length === 0) return;
    if (!confirm(`Descartar ${codigos.length} conta(s)? Elas não entram no Plano Padrão.`)) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("descartar_contas_novas", {
        _tenant_id: tenantId, _codigos: codigos, _motivo: null as any,
      });
      if (error) throw error;
      toast.success(`${codigos.length} conta(s) descartada(s).`);
      setSel(new Set());
      invalidar();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  if (isLoading) return null;

  if ((novas ?? []).length === 0) {
    return (
      <Card className="p-4 mb-4 border-emerald-500/40 bg-emerald-500/5 text-sm">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span>Todas as contas dos diários existem no Plano Padrão.</span>
        </div>
      </Card>
    );
  }

  // sugere como pai as sintéticas do mesmo grupo do tipo escolhido
  const paisSugeridos = (sinteticas ?? []).filter((s) => {
    if (!tipoLote) return true;
    if (tipoLote.startsWith("4-") || tipoLote.startsWith("6-") || tipoLote === "1-Ativo")
      return s.tipo === "1-Ativo";
    if (tipoLote.startsWith("5-") || tipoLote.startsWith("7-") || tipoLote === "2-Passivo")
      return s.tipo === "2-Passivo";
    return s.tipo === "3-DRE";
  });

  return (
    <Card className="p-4 mb-4 border-amber-500/40 bg-amber-500/5">
      <div className="flex items-start gap-3 mb-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <strong className="text-sm">
            {novas!.length} conta(s) do diário não existem no Plano Padrão
          </strong>
          <p className="text-xs text-muted-foreground mt-1">
            Os lançamentos dessas contas ficam fora das demonstrações até serem incorporados. O
            nome já vem preenchido do próprio arquivo de diário — selecione as contas, escolha a
            conta pai uma vez e a numeração é gerada em sequência.
          </p>
        </div>
      </div>

      {/* ---- barra de lote ---- */}
      <div className="rounded-md border bg-card p-3 mb-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex items-center gap-2 pr-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <Badge variant={sel.size ? "default" : "secondary"}>{sel.size} selecionada(s)</Badge>
          </div>
          <div className="min-w-[170px]">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipoLote} onValueChange={(v) => { setTipoLote(v); setPaiLote(""); }}
              disabled={!podeEditar}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {TIPOS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[280px] flex-1">
            <Label className="text-xs">Cadastrar sob a conta pai</Label>
            <Select value={paiLote} onValueChange={setPaiLote} disabled={!podeEditar || !tipoLote}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder={tipoLote ? "Selecione a sintética" : "Escolha o tipo primeiro"} />
              </SelectTrigger>
              <SelectContent className="max-h-[320px]">
                {paisSugeridos.map((s) => (
                  <SelectItem key={s.classificacao} value={s.classificacao}>
                    {s.classificacao} · {s.descricao}
                    {s.filhos > 0 && <span className="opacity-60"> ({s.filhos})</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={aplicarLote}
            disabled={busy || !podeEditar || sel.size === 0 || !paiLote || !tipoLote}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Cadastrar {sel.size}
          </Button>
          <Button size="sm" variant="outline" onClick={descartarSelecionadas}
            disabled={busy || !podeEditar || sel.size === 0}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Descartar
          </Button>
        </div>
        {semNome > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-500 mt-2">
            {semNome} conta(s) selecionada(s) sem nome no diário — o código será usado como
            descrição. Edite na linha se quiser outro nome.
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 mb-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9 h-8" placeholder="Buscar por código ou nome…"
            value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Button size="sm" variant="ghost" onClick={toggleTodas} disabled={!podeEditar}>
          {sel.size === filtradas.length && filtradas.length > 0
            ? "Desmarcar todas" : `Selecionar todas (${filtradas.length})`}
        </Button>
      </div>

      <div className="rounded-md border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="w-9 px-2 py-2"></th>
              <th className="text-left px-2 py-2 text-xs uppercase tracking-wider text-muted-foreground">Conta no diário</th>
              <th className="text-left px-2 py-2 text-xs uppercase tracking-wider text-muted-foreground">Nome (vindo do arquivo)</th>
              <th className="text-right px-2 py-2 text-xs uppercase tracking-wider text-muted-foreground">Movimento</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((c) => (
              <tr key={c.codigo} className={sel.has(c.codigo) ? "border-t bg-accent/40" : "border-t"}>
                <td className="px-2 py-2 align-top">
                  <Checkbox checked={sel.has(c.codigo)} disabled={!podeEditar}
                    onCheckedChange={() => toggle(c.codigo)} />
                </td>
                <td className="px-2 py-2">
                  <div className="font-mono font-medium">{c.codigo}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {c.lancamentos} lançamento(s) · {c.primeira_competencia} → {c.ultima_competencia}
                    {c.historico_exemplo && <> · <span className="italic">“{c.historico_exemplo}”</span></>}
                  </div>
                </td>
                <td className="px-2 py-2">
                  <Input
                    className="h-8"
                    value={nomes[c.codigo] ?? c.nome_sugerido ?? ""}
                    placeholder={c.nome_sugerido ? "" : "sem nome no diário — digite"}
                    disabled={!podeEditar}
                    onChange={(e) => setNomes((s) => ({ ...s, [c.codigo]: e.target.value }))}
                  />
                </td>
                <td className="px-2 py-2 text-right tabular-nums align-top">
                  {formatBRL(Number(c.movimento))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
