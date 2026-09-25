// Contas específicas de uma empresa, sempre penduradas numa conta SINTÉTICA
// do Plano Padrão. O código é automático: prefixo da empresa + número
// (ex.: MAC-0001), para nunca colidir com os códigos reduzidos do Padrão.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { limparCachePlano } from "@/lib/diario/build-statements";
import { limparCacheDemonstracoes } from "@/lib/cache-demonstracoes";
import { limparCacheDepara } from "@/lib/plano/depara";
import { ALOCACOES_GASTO, chaveAlocacao, ehContaDeCustoDespesa } from "@/lib/plano/tipo-custo";

const SEM = "__sem__";

export function ContasEspecificasEmpresa({ tenantId, podeEditar }: { tenantId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [filtro, setFiltro] = useState("");
  const [buscaSint, setBuscaSint] = useState("");
  const [sint, setSint] = useState("");
  const [descricao, setDescricao] = useState("");
  const [alocacao, setAlocacao] = useState<string>(SEM);
  const [dfc, setDfc] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: empresas } = useQuery({
    queryKey: ["empresas-tenant", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, name")
        .eq("tenant_id", tenantId).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: prefixo } = useQuery({
    queryKey: ["prefixo-empresa", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("prefixo_empresa", { _company_id: companyId });
      return (data as string) ?? "";
    },
  });

  const { data: sinteticas } = useQuery({
    queryKey: ["sinteticas-padrao", tenantId],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("plano_contas")
        .select("codigo, classificacao, descricao, dfc_codigo")
        .eq("tenant_id", tenantId).is("company_id", null).eq("is_sintetica", true)
        .order("classificacao").limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const sintFiltradas = useMemo(() => {
    const t = buscaSint.trim().toLowerCase();
    const l = sinteticas ?? [];
    return (t ? l.filter((s) => `${s.classificacao} ${s.descricao}`.toLowerCase().includes(t)) : l).slice(0, 200);
  }, [sinteticas, buscaSint]);
  const sintSel = (sinteticas ?? []).find((s) => s.codigo === sint);

  const { data: contas, isLoading } = useQuery({
    queryKey: ["contas-especificas", companyId, filtro, prefixo],
    enabled: !!companyId && prefixo !== undefined,
    queryFn: async () => {
      let q = supabase.from("plano_contas")
        .select("codigo, descricao, classificacao, conta_pai_classificacao, tipo, tipo_custo, classe_gasto, dfc_codigo")
        .eq("tenant_id", tenantId).eq("company_id", companyId)
        .like("codigo", `${prefixo}-%`)
        .order("codigo").limit(300);
      if (filtro.trim()) q = q.or(`codigo.ilike.%${filtro.trim()}%,descricao.ilike.%${filtro.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const aposMudar = () => {
    limparCachePlano(); limparCacheDemonstracoes(); limparCacheDepara(companyId);
    qc.invalidateQueries({ queryKey: ["contas-especificas", companyId] });
    qc.invalidateQueries({ queryKey: ["plano-padrao-destinos"] });
    qc.invalidateQueries({ queryKey: ["monthly-stmt"] });
    qc.invalidateQueries({ queryKey: ["ecd-depara", companyId] });
  };

  const criar = async () => {
    setBusy(true);
    try {
      const [classe, tipo] = alocacao === SEM ? ["", ""] : alocacao.split(":");
      const { data, error } = await (supabase as any).rpc("criar_conta_empresa_sintetica", {
        _company_id: companyId, _sintetica: sint, _descricao: descricao.trim(),
        _tipo_custo: tipo || null, _classe_gasto: classe || null, _dfc_codigo: dfc.trim() || null,
      });
      if (error) throw error;
      toast.success(`Conta ${data} criada.`);
      setDescricao(""); setAlocacao(SEM); setDfc("");
      aposMudar();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  };

  const excluir = async (codigo: string) => {
    if (!confirm(`Excluir a conta ${codigo}? As contas vinculadas a ela voltam para "a alocar" no de-para.`)) return;
    try {
      const { data, error } = await (supabase as any).rpc("excluir_conta_empresa", {
        _company_id: companyId, _codigo: codigo,
      });
      if (error) throw error;
      const d = Number(data?.desvinculadas ?? 0);
      toast.success(d > 0
        ? `Conta excluída. ${d} vínculo(s) zerado(s) — aloque de novo no de-para.`
        : "Conta excluída.");
      aposMudar();
    } catch (e: any) { toast.error(e.message); }
  };

  const mostraAlocacao = sintSel ? ehContaDeCustoDespesa(sintSel.classificacao + ".1") : false;

  return (
    <Card className="p-5">
      <div className="text-sm font-medium mb-1">Contas específicas de empresa</div>
      <p className="text-xs text-muted-foreground mb-3">
        Contas que existem só para uma empresa, criadas dentro de uma conta sintética do Plano Padrão.
        O código é automático: prefixo da empresa + número.
      </p>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <div className="min-w-[240px]">
          <Label className="text-xs">Empresa</Label>
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {(empresas ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs">Filtrar</Label>
          <Input className="h-9" value={filtro} onChange={(e) => setFiltro(e.target.value)}
            placeholder="Código ou nome" disabled={!companyId} />
        </div>
      </div>

      {companyId && podeEditar && (
        <div className="grid gap-2 mb-3 rounded-md border border-border p-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label className="text-xs">Conta sintética do Plano Padrão</Label>
            <div className="flex gap-2">
              <Input className="h-9 w-56" value={buscaSint} onChange={(e) => setBuscaSint(e.target.value)}
                placeholder="Buscar sintética" />
              <Select value={sint} onValueChange={(v) => {
                setSint(v);
                const s = (sinteticas ?? []).find((x) => x.codigo === v);
                setDfc(s?.dfc_codigo ?? "");
              }}>
                <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Selecione a sintética" /></SelectTrigger>
                <SelectContent className="max-h-80">
                  {sintFiltradas.map((s) => (
                    <SelectItem key={s.codigo} value={s.codigo}>
                      <span className="font-mono">{s.classificacao}</span> {s.descricao}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Código</Label>
            <Input className="h-9 font-mono" disabled value={prefixo ? `${prefixo}-automático` : "automático"} />
          </div>
          <div>
            <Label className="text-xs">Descrição</Label>
            <Input className="h-9" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">DFC (código)</Label>
            <Input className="h-9" value={dfc} onChange={(e) => setDfc(e.target.value)}
              placeholder="Herda da sintética" />
          </div>
          {mostraAlocacao && (
            <div>
              <Label className="text-xs">Custo / despesa</Label>
              <Select value={alocacao} onValueChange={setAlocacao}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM}>Herdar / automático</SelectItem>
                  {ALOCACOES_GASTO.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="md:col-span-2">
            <Button onClick={criar} disabled={busy || !sint || !descricao.trim()}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Criar conta
            </Button>
          </div>
        </div>
      )}

      {companyId && (
        isLoading ? <div className="text-sm text-muted-foreground">Carregando…</div> :
        (contas ?? []).length === 0 ? <div className="text-sm text-muted-foreground">Nenhuma conta específica.</div> :
        <div className="max-h-96 overflow-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr><th className="text-left p-2">Código</th><th className="text-left p-2">Descrição</th>
                <th className="text-left p-2">Sintética</th><th className="text-left p-2">DFC</th>
                <th className="text-left p-2">Custo/despesa</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {(contas ?? []).map((c: any) => {
                const al = ALOCACOES_GASTO.find((o) => o.value === chaveAlocacao(c.classe_gasto, c.tipo_custo));
                return (
                  <tr key={c.codigo} className="border-t border-border">
                    <td className="p-2 font-mono">{c.codigo}</td><td className="p-2">{c.descricao}</td>
                    <td className="p-2 font-mono">{c.conta_pai_classificacao ?? c.classificacao}</td>
                    <td className="p-2">{c.dfc_codigo ?? "—"}</td>
                    <td className="p-2">{al?.label ?? "—"}</td>
                    <td className="p-2 text-right">
                      {podeEditar && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Excluir conta"
                          onClick={() => excluir(c.codigo)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(contas ?? []).length === 300 && <div className="p-2 text-[11px] text-muted-foreground">Mostrando as 300 primeiras — use o filtro.</div>}
        </div>
      )}
    </Card>
  );
}
