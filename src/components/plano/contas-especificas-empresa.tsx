// Contas específicas de uma empresa, penduradas numa conta do Plano Padrão.
// O código leva o prefixo da empresa (ex.: MAC-C05567) para nunca colidir
// com os códigos reduzidos do Plano Padrão.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { limparCachePlano } from "@/lib/diario/build-statements";
import { limparCacheDemonstracoes } from "@/lib/cache-demonstracoes";

export function ContasEspecificasEmpresa({ tenantId, podeEditar }: { tenantId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [filtro, setFiltro] = useState("");
  const [pai, setPai] = useState("");
  const [codigo, setCodigo] = useState("");
  const [descricao, setDescricao] = useState("");
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

  const { data: contas, isLoading } = useQuery({
    queryKey: ["contas-especificas", companyId, filtro],
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from("plano_contas")
        .select("codigo, descricao, classificacao, tipo")
        .eq("tenant_id", tenantId).eq("company_id", companyId)
        .order("codigo").limit(300);
      if (filtro.trim()) q = q.or(`codigo.ilike.%${filtro.trim()}%,descricao.ilike.%${filtro.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const criar = async () => {
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("criar_conta_empresa", {
        _company_id: companyId, _conta_padrao: pai.trim(),
        _codigo_origem: codigo.trim(), _descricao: descricao.trim(),
      });
      if (error) throw error;
      toast.success(`Conta ${data} criada.`);
      setCodigo(""); setDescricao("");
      limparCachePlano(); limparCacheDemonstracoes();
      qc.invalidateQueries({ queryKey: ["contas-especificas", companyId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  };

  return (
    <Card className="p-5">
      <div className="text-sm font-medium mb-1">Contas específicas de empresa</div>
      <p className="text-xs text-muted-foreground mb-3">
        Contas que existem só para uma empresa (ex.: clientes e fornecedores vindos da ECD),
        alocadas em uma conta do Plano Padrão. O código recebe o prefixo da empresa.
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
        <div className="flex flex-wrap items-end gap-2 mb-3 rounded-md border border-border p-3">
          <div className="w-48">
            <Label className="text-xs">Conta do Plano Padrão (código ou classificação)</Label>
            <Input className="h-9" value={pai} onChange={(e) => setPai(e.target.value)} placeholder="1.01.02.01.01.01" />
          </div>
          <div className="w-32">
            <Label className="text-xs">Código</Label>
            <Input className="h-9" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="05567" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs">Descrição</Label>
            <Input className="h-9" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <Button onClick={criar} disabled={busy || !pai || !codigo || !descricao}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Criar conta
          </Button>
        </div>
      )}

      {companyId && (
        isLoading ? <div className="text-sm text-muted-foreground">Carregando…</div> :
        (contas ?? []).length === 0 ? <div className="text-sm text-muted-foreground">Nenhuma conta específica.</div> :
        <div className="max-h-96 overflow-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr><th className="text-left p-2">Código</th><th className="text-left p-2">Descrição</th>
                <th className="text-left p-2">Alocada em</th><th className="text-left p-2">Tipo</th></tr>
            </thead>
            <tbody>
              {(contas ?? []).map((c) => (
                <tr key={c.codigo} className="border-t border-border">
                  <td className="p-2 font-mono">{c.codigo}</td><td className="p-2">{c.descricao}</td>
                  <td className="p-2 font-mono">{c.classificacao}</td><td className="p-2">{c.tipo}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(contas ?? []).length === 300 && <div className="p-2 text-[11px] text-muted-foreground">Mostrando as 300 primeiras — use o filtro.</div>}
        </div>
      )}
    </Card>
  );
}
