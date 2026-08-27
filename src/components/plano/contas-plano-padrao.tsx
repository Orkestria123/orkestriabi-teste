// Consulta, edição e exclusão de contas do Plano Padrão do escritório.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Pencil, Eye, Trash2, AlertTriangle, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { tituloConta } from "@/lib/format";

const TIPOS = [
  "1-Ativo", "2-Passivo", "3-DRE",
  "4-Cli. Nac.", "5-For. Nac.", "6-Cli. Ex.", "7-For. Ex.",
];

const FRASE_TRAVA = "EXCLUIR PLANO PADRÃO";

interface Conta {
  id: string;
  codigo: string;
  classificacao: string;
  descricao: string;
  tipo: string;
  natureza: string | null;
  nivel: number | null;
  is_sintetica: boolean | null;
  is_participante: boolean | null;
}

const VAZIA: Omit<Conta, "id"> = {
  codigo: "", classificacao: "", descricao: "", tipo: "1-Ativo",
  natureza: "A", nivel: 1, is_sintetica: false, is_participante: false,
};

export function ContasPlanoPadrao({
  tenantId, podeEditar,
}: {
  tenantId: string;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [incluirPart, setIncluirPart] = useState(false);
  const [editor, setEditor] = useState<Conta | null>(null);
  const [novo, setNovo] = useState(false);
  const [leitura, setLeitura] = useState(false);
  const [draft, setDraft] = useState(VAZIA);
  const [salvando, setSalvando] = useState(false);
  const [trava, setTrava] = useState("");
  const [apagandoTudo, setApagandoTudo] = useState(false);

  const termo = busca.trim();
  const { data: contas, isLoading, isFetching } = useQuery({
    queryKey: ["plano-padrao-contas", tenantId, termo, incluirPart],
    queryFn: async () => {
      let q = supabase
        .from("plano_contas")
        .select("id, codigo, classificacao, descricao, tipo, natureza, nivel, is_sintetica, is_participante")
        .eq("tenant_id", tenantId)
        .is("company_id", null)
        .order("classificacao")
        .limit(200);
      if (!incluirPart) q = q.eq("is_participante", false);
      if (termo) {
        const t = termo.replace(/[,()%]/g, " ").trim();
        if (t) {
          q = q.or(
            `codigo.ilike.%${t}%,classificacao.ilike.%${t}%,descricao.ilike.%${t}%`,
          );
        }
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Conta[];
    },
  });

  const abrir = (c: Conta, soVer: boolean) => {
    setEditor(c);
    setNovo(false);
    setLeitura(soVer);
    setDraft({
      codigo: c.codigo, classificacao: c.classificacao, descricao: c.descricao,
      tipo: c.tipo, natureza: c.natureza, nivel: c.nivel,
      is_sintetica: c.is_sintetica, is_participante: c.is_participante,
    });
  };

  const abrirNovo = () => {
    setEditor(null);
    setNovo(true);
    setLeitura(false);
    setDraft({ ...VAZIA });
  };

  const fechar = () => { setEditor(null); setNovo(false); };

  const salvar = async () => {
    if (!draft.codigo.trim() || !draft.classificacao.trim() || !draft.descricao.trim()) {
      toast.error("Código, classificação e descrição são obrigatórios.");
      return;
    }
    setSalvando(true);
    try {
      const payload = {
        tenant_id: tenantId,
        company_id: null,
        codigo: draft.codigo.trim(),
        classificacao: draft.classificacao.trim(),
        descricao: draft.descricao.trim(),
        tipo: draft.tipo,
        natureza: draft.natureza,
        nivel: Number(draft.nivel) || 1,
        is_sintetica: !!draft.is_sintetica,
        is_participante: !!draft.is_participante,
      };
      if (editor?.id) {
        const { error } = await supabase.from("plano_contas").update(payload).eq("id", editor.id);
        if (error) throw error;
        toast.success("Conta atualizada.");
      } else {
        const { error } = await supabase.from("plano_contas").insert(payload);
        if (error) throw error;
        toast.success("Conta criada no Plano Padrão.");
      }
      fechar();
      qc.invalidateQueries({ queryKey: ["plano-padrao-contas", tenantId] });
      qc.invalidateQueries({ queryKey: ["plano-padrao-resumo", tenantId] });
    } catch (e: any) { toast.error(e.message); }
    finally { setSalvando(false); }
  };

  const excluirConta = async (c: Conta) => {
    if (!confirm(`Excluir a conta ${c.codigo} — ${c.descricao}?\n\nLançamentos ligados a este código podem falhar.`)) return;
    const { error } = await supabase.from("plano_contas").delete().eq("id", c.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Conta excluída.");
    qc.invalidateQueries({ queryKey: ["plano-padrao-contas", tenantId] });
    qc.invalidateQueries({ queryKey: ["plano-padrao-resumo", tenantId] });
  };

  const excluirPlanoInteiro = async () => {
    if (trava.trim() !== FRASE_TRAVA) {
      toast.error(`Digite exatamente: ${FRASE_TRAVA}`);
      return;
    }
    if (!confirm("Última confirmação: apagar TODAS as contas do Plano Padrão deste escritório?")) return;
    setApagandoTudo(true);
    try {
      const { error } = await supabase
        .from("plano_contas")
        .delete()
        .eq("tenant_id", tenantId)
        .is("company_id", null);
      if (error) throw error;
      toast.success("Plano Padrão apagado.");
      setTrava("");
      qc.invalidateQueries({ queryKey: ["plano-padrao-contas", tenantId] });
      qc.invalidateQueries({ queryKey: ["plano-padrao-resumo", tenantId] });
    } catch (e: any) { toast.error(e.message); }
    finally { setApagandoTudo(false); }
  };

  const aberto = novo || !!editor;
  const lista = contas ?? [];
  const hint = useMemo(
    () => incluirPart
      ? "Inclui clientes/fornecedores. Sem busca a lista corta em 200."
      : "Só contas estruturais. Marque participantes para buscar clientes/fornecedores.",
    [incluirPart],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="h-8 pl-7 text-xs" placeholder="Código, classificação ou nome…"
            value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={incluirPart} onChange={(e) => setIncluirPart(e.target.checked)} />
          incluir participantes
        </label>
        {podeEditar && (
          <Button size="sm" className="h-8 text-xs" onClick={abrirNovo}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Nova conta
          </Button>
        )}
        {(isLoading || isFetching) && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-[11px] text-muted-foreground">{hint}</p>

      <Card className="overflow-hidden">
        {lista.length === 0 && !isLoading ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {termo ? "Nenhuma conta com esse filtro." : "Nenhuma conta estrutural no Plano Padrão."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-3 py-2 font-medium">Código</th>
                <th className="text-left px-2 py-2 font-medium">Classificação</th>
                <th className="text-left px-2 py-2 font-medium">Descrição</th>
                <th className="text-left px-2 py-2 font-medium">Tipo</th>
                <th className="w-[160px]" />
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-1.5 font-mono text-xs">{c.codigo}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{c.classificacao}</td>
                  <td className="px-2 py-1.5">
                    {tituloConta(c.descricao)}
                    {c.is_sintetica && <Badge variant="outline" className="ml-1.5 text-[9px]">S</Badge>}
                    {c.is_participante && <Badge variant="outline" className="ml-1 text-[9px]">part.</Badge>}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">{c.tipo}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() => abrir(c, true)}>
                      <Eye className="h-3.5 w-3.5 mr-1" /> Ver
                    </Button>
                    {podeEditar && (
                      <>
                        <Button size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={() => abrir(c, false)}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive"
                          onClick={() => excluirConta(c)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {podeEditar && (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">Excluir o Plano Padrão inteiro</div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Apaga todas as contas do escritório (company_id nulo). Empresas que usam o Padrão
                ficam sem estrutura até um novo CSV. Para confirmar, digite{" "}
                <code className="px-1 rounded bg-muted text-[11px]">{FRASE_TRAVA}</code>.
              </p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Input className="h-8 text-xs max-w-xs font-mono" value={trava}
                  onChange={(e) => setTrava(e.target.value)} placeholder={FRASE_TRAVA} />
                <Button size="sm" variant="destructive" className="h-8 text-xs"
                  disabled={apagandoTudo || trava.trim() !== FRASE_TRAVA}
                  onClick={excluirPlanoInteiro}>
                  {apagandoTudo && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  Apagar plano
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Dialog open={aberto} onOpenChange={(v) => { if (!v) fechar(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {leitura ? "Visualizar conta" : novo ? "Nova conta" : "Editar conta"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Código</Label>
              <Input value={draft.codigo} disabled={leitura}
                onChange={(e) => setDraft({ ...draft, codigo: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Classificação</Label>
              <Input value={draft.classificacao} disabled={leitura}
                onChange={(e) => setDraft({ ...draft, classificacao: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Descrição</Label>
              <Input value={draft.descricao} disabled={leitura}
                onChange={(e) => setDraft({ ...draft, descricao: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={draft.tipo} disabled={leitura}
                onChange={(e) => setDraft({ ...draft, tipo: e.target.value })}>
                {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Natureza (S/A)</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={draft.natureza ?? "A"} disabled={leitura}
                onChange={(e) => setDraft({ ...draft, natureza: e.target.value })}>
                <option value="S">S — Sintética</option>
                <option value="A">A — Analítica</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Nível</Label>
              <Input type="number" value={draft.nivel ?? 1} disabled={leitura}
                onChange={(e) => setDraft({ ...draft, nivel: Number(e.target.value) })} />
            </div>
            <div className="flex flex-col justify-end gap-1 pb-1">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={!!draft.is_sintetica} disabled={leitura}
                  onChange={(e) => setDraft({ ...draft, is_sintetica: e.target.checked })} />
                Sintética
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={!!draft.is_participante} disabled={leitura}
                  onChange={(e) => setDraft({ ...draft, is_participante: e.target.checked })} />
                Participante (cli/for)
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={fechar}>{leitura ? "Fechar" : "Cancelar"}</Button>
            {!leitura && (
              <Button onClick={salvar} disabled={salvando}>
                {salvando && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Salvar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
