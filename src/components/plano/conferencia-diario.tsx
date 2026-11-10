import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { validarAlocacao } from "@/lib/diario/validacao-contas";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SeletorConta } from "@/components/contas/seletor-conta";
import { useContasDestino } from "@/hooks/use-contas-destino";
import { limparCacheDepara } from "@/lib/plano/depara";
import { limparCachePlano } from "@/lib/diario/build-statements";
import { limparCacheDemonstracoes } from "@/lib/cache-demonstracoes";
import { toast } from "sonner";

export function ConferenciaDiario({ companyId, tenantId, podeEditar }: { companyId: string; tenantId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState("");
  const [divergentes, setDivergentes] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [aberto, setAberto] = useState(false);
  const destinos = useContasDestino(aberto ? tenantId : null, companyId);
  const periodoInvalido = !!inicio && !!fim && inicio > fim;
  const q = useQuery({
    queryKey: ["conferencia-diario", companyId, inicio, fim, busca, pagina, tipo, divergentes],
    enabled: aberto && !periodoInvalido,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("filtrar_contas_diario", {
        _company_id: companyId, _inicio: inicio ? `${inicio}-01` : undefined,
        _fim: fim ? `${fim}-01` : undefined, _busca: busca, _offset: pagina * 100,
        _tipo: tipo, _divergentes: divergentes,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const mudar = (set: (v: string) => void, v: string) => { set(v); setPagina(0); };
  const total = Number(q.data?.[0]?.total ?? 0);
  const alocar = async (codigo: string, destino: string | null) => {
    if (!destino || !podeEditar) return;
    setSalvando(codigo);
    try {
      const { error } = await supabase.rpc("alocar_conta_diario", { _company_id: companyId, _codigo: codigo, _destino: destino });
      if (error) throw error;
      limparCacheDepara(companyId); limparCachePlano();
      await limparCacheDemonstracoes();
      await qc.invalidateQueries({ queryKey: ["conferencia-diario", companyId] });
      await qc.invalidateQueries({ queryKey: ["bi"] });
      toast.success("Alocação salva para esta empresa");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível salvar a alocação"); }
    finally { setSalvando(null); }
  };
  return <section className="border-b border-border pb-5 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">Contas do diário · Clientes e Fornecedores</h3>
      <Button variant="outline" onClick={() => setAberto(!aberto)}>{aberto ? "Fechar conferência" : "Conferir contas do diário"}</Button>
    </div>
    {aberto && <>
      <div className="flex flex-wrap items-end gap-3">
        <div><Label htmlFor="diario-de">De</Label><Input id="diario-de" type="month" value={inicio} onChange={e => mudar(setInicio, e.target.value)} /></div>
        <div><Label htmlFor="diario-ate">Até</Label><Input id="diario-ate" type="month" value={fim} onChange={e => mudar(setFim, e.target.value)} /></div>
        <div className="flex-1 min-w-48"><Label htmlFor="diario-busca">Conta ou nome</Label><Input id="diario-busca" value={busca} onChange={e => mudar(setBusca, e.target.value)} /></div>
        <div><Label>Tipo de conta</Label><Select value={tipo || "todos"} onValueChange={v => mudar(setTipo, v === "todos" ? "" : v)}><SelectTrigger aria-label="Tipo de conta" className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todas as contas</SelectItem><SelectItem value="cliente">Clientes</SelectItem><SelectItem value="fornecedor">Fornecedores</SelectItem></SelectContent></Select></div>
        <Label className="flex items-center gap-2 pb-2"><Checkbox checked={divergentes} onCheckedChange={v => { setDivergentes(v === true); setPagina(0); }} />Somente clientes/fornecedores divergentes</Label>
        <Button variant="outline" size="icon" aria-label="Atualizar conferência" title="Atualizar conferência" onClick={() => q.refetch()} disabled={q.isFetching || periodoInvalido}><RefreshCw className="size-4" /></Button>
      </div>
      {periodoInvalido ? <p className="text-destructive">A data final deve ser igual ou posterior à inicial.</p> : q.isError ? <p className="text-destructive">Não foi possível conferir: {q.error.message}</p> : q.isPending ? <p className="text-muted-foreground">Conferindo contas…</p> : <>
        <div className="overflow-auto max-h-[65vh] border border-border rounded-md">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="sticky top-0 bg-background"><tr className="border-b border-border">{["Conta / Nome no diário", "Tipo pela faixa", "Conta de destino / Sintética", "Débitos", "Créditos", "Movimento D−C", "Validação"].map(h => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr></thead>
            <tbody>{q.data?.map(r => {
              const status = validarAlocacao(r.codigo, r.destino_classificacao, r.ignorada);
              return <tr key={r.codigo} className="border-b border-border">
                <td className="p-3"><span className="font-mono">{r.codigo}</span><div>{r.nome}</div><small className="text-muted-foreground">{r.lancamentos} partidas</small></td>
                <td className="p-3">{r.tipo_esperado?.startsWith("4-") ? "Cliente" : r.tipo_esperado ? "Fornecedor" : "—"}</td>
                <td className="p-3"><div>{r.destino_codigo ?? "—"} · {r.destino_nome ?? "Sem destino"}</div><div className="font-mono text-xs text-muted-foreground">{r.destino_classificacao}</div>{podeEditar && r.tipo_esperado && <SeletorConta destinos={destinos.data ?? []} carregando={destinos.isPending} valor={r.destino_codigo} onEscolher={v => alocar(r.codigo, v)} disabled={salvando !== null} compacto placeholder="Alterar alocação" />}</td>
                <td className="p-3 text-right tabular-nums whitespace-nowrap">{formatBRL(Number(r.debitos))}</td>
                <td className="p-3 text-right tabular-nums whitespace-nowrap">{formatBRL(Number(r.creditos))}</td>
                <td className="p-3 text-right tabular-nums whitespace-nowrap">{formatBRL(Number(r.debitos) - Number(r.creditos))}</td>
                <td className="p-3"><Badge variant={status === "Grupo divergente" || status === "Sem alocação" ? "destructive" : "secondary"}>{status}</Badge></td>
              </tr>;
            })}{!q.data?.length && <tr><td colSpan={7} className="p-5 text-center text-muted-foreground">Nenhuma conta neste período ou busca.</td></tr>}</tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-2 text-sm"><span>{total} contas · página {pagina + 1}</span><div className="flex gap-2"><Button variant="outline" size="icon" title="Página anterior" aria-label="Página anterior" disabled={!pagina} onClick={() => setPagina(pagina - 1)}><ChevronLeft className="size-4" /></Button><Button variant="outline" size="icon" title="Próxima página" aria-label="Próxima página" disabled={(pagina + 1) * 100 >= total} onClick={() => setPagina(pagina + 1)}><ChevronRight className="size-4" /></Button></div></div>
      </>}
    </>}
  </section>;
}