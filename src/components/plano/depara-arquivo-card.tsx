import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lerTudo, countNaPrimeira } from "@/lib/supabase-paginado";
import { layoutDeJson, layoutPronto } from "@/lib/importacao/layout";
import { lerArquivoQualquer, valorDaLinha } from "@/lib/importacao/ler-arquivo";
import { formatBRL } from "@/lib/format";
import type { SistemaContabil } from "@/components/sistemas/sistemas-panel";

function parseValorBR(raw: string): number {
  if (!raw) return 0;
  const s = raw.trim();
  if (!s) return 0;
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", ".")) || 0;
  return Number(s) || 0;
}

export function DeParaArquivoCard({
  tenantId,
  companyId,
  sistemaId,
}: {
  tenantId: string;
  companyId: string;
  sistemaId: string | null;
}) {
  const qc = useQueryClient();
  const [escolhido, setEscolhido] = useState<string>(sistemaId ?? "");
  const [busy, setBusy] = useState(false);
  const [resumo, setResumo] = useState<{
    total: number; mapeadas: number; pendentes: number; ignoradas: number;
    amostra: { conta: string; nome: string; classificacao: string; valor: number; status: string }[];
    contas: { codigo: string; classificacao: string; descricao: string }[];
  } | null>(null);

  const { data: sistemas } = useQuery({
    queryKey: ["sistemas-contabeis", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sistemas_contabeis")
        .select("id, tenant_id, nome, layout, updated_at")
        .eq("tenant_id", tenantId)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as SistemaContabil[];
    },
  });

  const { data: feitos } = useQuery({
    queryKey: ["depara-feitos-status", companyId],
    queryFn: async () => {
      return lerTudo<{ conta_codigo: string; ignorada: boolean }>(
        (de, ate) => supabase
          .from("depara_contas")
          .select("conta_codigo, ignorada", countNaPrimeira(de))
          .eq("company_id", companyId)
          .order("conta_codigo")
          .range(de, ate),
        "depara-feitos-status",
      );
    },
  });

  const mapaFeitos = useMemo(() => {
    const m = new Map<string, "ok" | "ignorar">();
    for (const r of feitos ?? []) {
      m.set(r.conta_codigo, r.ignorada ? "ignorar" : "ok");
    }
    return m;
  }, [feitos]);

  const sistema = (sistemas ?? []).find((s) => s.id === escolhido);
  const layoutAtual = sistema ? layoutDeJson(sistema.layout) : null;
  const contaIgualClassificacao = !!layoutAtual?.colunas.conta
    && layoutAtual.colunas.conta === layoutAtual.colunas.classificacao;

  const vincularSistema = async (id: string) => {
    setEscolhido(id);
    const { error } = await supabase.from("companies").update({ sistema_id: id || null } as any).eq("id", companyId);
    if (error) toast.error(error.message);
    else {
      qc.invalidateQueries({ queryKey: ["company", companyId] });
      toast.success("Sistema gravado nesta empresa.");
    }
  };

  const onFile = async (file: File) => {
    if (!sistema) {
      toast.error("Escolha o sistema primeiro — o layout de colunas é dele.");
      return;
    }
    const layout = layoutDeJson(sistema.layout);
    const faltam = layoutPronto(layout);
    if (faltam.length) {
      toast.error("Este sistema ainda não tem layout gravado. Abra Sistemas e atribua as colunas.");
      return;
    }
    setBusy(true);
    setResumo(null);
    try {
      const grade = await lerArquivoQualquer(file, {
        temCabecalho: layout.tem_cabecalho,
        linhaCabecalho: layout.linha_cabecalho,
      });
      const porConta = new Map<string, { conta: string; nome: string; classificacao: string; valor: number }>();
      for (const row of grade.linhas) {
        const conta = valorDaLinha(grade.headers, row, layout.colunas.conta);
        if (!conta) continue;
        const prev = porConta.get(conta);
        const valor = parseValorBR(valorDaLinha(grade.headers, row, layout.colunas.valor));
        porConta.set(conta, {
          conta,
          nome: valorDaLinha(grade.headers, row, layout.colunas.descricao) || prev?.nome || "",
          classificacao: valorDaLinha(grade.headers, row, layout.colunas.classificacao) || prev?.classificacao || "",
          valor: (prev?.valor ?? 0) + valor,
        });
      }
      let mapeadas = 0, ignoradas = 0, pendentes = 0;
      const amostra: { conta: string; nome: string; classificacao: string; valor: number; status: string }[] = [];
      for (const c of porConta.values()) {
        const st = mapaFeitos.get(c.conta);
        const status = st === "ok" ? "no de-para" : st === "ignorar" ? "ignorada" : "pendente";
        if (st === "ok") mapeadas++;
        else if (st === "ignorar") ignoradas++;
        else pendentes++;
        if (amostra.length < 12 && status === "pendente") {
          amostra.push({ ...c, status });
        }
      }
      setResumo({
        total: porConta.size, mapeadas, pendentes, ignoradas, amostra,
        contas: [...porConta.values()].map((c) => ({
          codigo: c.conta,
          classificacao: c.classificacao,
          descricao: c.nome,
        })),
      });
      toast.success(
        `${porConta.size.toLocaleString("pt-BR")} conta(s) no arquivo · ${pendentes} ainda sem de-para.`,
      );
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const colocarNaFila = async () => {
    if (!resumo?.contas.length) return;
    setBusy(true);
    try {
      const LOTE = 400;
      let gravadas = 0;
      for (let i = 0; i < resumo.contas.length; i += LOTE) {
        const fatia = resumo.contas.slice(i, i + LOTE);
        const { data, error } = await (supabase as any).rpc("depara_carregar_origem", {
          _company_id: companyId,
          _contas: fatia,
        });
        if (error) throw error;
        gravadas += Number(data?.gravadas ?? 0);
      }
      if (gravadas === 0) {
        toast.error("Nenhuma conta entrou na origem. Confira o layout (coluna de conta) e tente de novo.");
        return;
      }
      toast.success(`${gravadas} conta(s) na origem desta empresa. A fila abaixo usa classificação e nome para o lote.`);
      qc.invalidateQueries({ queryKey: ["depara-pendencias", companyId] });
      qc.invalidateQueries({ queryKey: ["depara-feitos", companyId] });
      qc.invalidateQueries({ queryKey: ["depara-feitos-status", companyId] });
    } catch (e: any) {
      const msg = String(e.message ?? e);
      toast.error(
        /depara_carregar_origem|schema cache|does not exist/i.test(msg)
          ? "A função de carregar origem ainda não está no banco. Aplique a migration do de-para de outro sistema."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 mb-4">
      <div className="text-sm font-medium">Arquivo do outro sistema</div>
      <p className="text-xs text-muted-foreground mt-0.5 mb-3">
        Confere as contas do ERP contra o de-para já gravado e, se faltar classificação no diário,
        coloca a origem na fila para o lote (Grupo / Subgrupo) funcionar.
      </p>
      <div className="grid md:grid-cols-2 gap-3 items-end">
        <div>
          <Label className="text-xs">Sistema</Label>
          {(sistemas?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground mt-1">
              Nenhum sistema cadastrado.{" "}
              <Link to="/admin/sistemas" className="underline">Criar e gravar o layout</Link>.
            </p>
          ) : (
            <Select value={escolhido || undefined} onValueChange={vincularSistema}>
              <SelectTrigger className="h-8 mt-1">
                <SelectValue placeholder="Qual ERP gerou o arquivo?" />
              </SelectTrigger>
              <SelectContent>
                {(sistemas ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div>
          <Label className="text-xs">Arquivo (CSV ou Excel)</Label>
          <Input className="mt-1" type="file" accept=".csv,.txt,.xlsx,.xls"
            disabled={busy || !sistema}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }} />
        </div>
      </div>
      {busy && <Loader2 className="h-4 w-4 animate-spin mt-3 text-muted-foreground" />}
      {resumo && (
        <div className="mt-3 text-sm space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{resumo.total} contas no arquivo</Badge>
            <Badge variant="outline" className="text-emerald-700">{resumo.mapeadas} no de-para</Badge>
            <Badge variant="outline" className="text-amber-700">{resumo.pendentes} pendentes</Badge>
            {resumo.ignoradas > 0 && (
              <Badge variant="outline">{resumo.ignoradas} ignoradas</Badge>
            )}
          </div>
          {resumo.amostra.length > 0 && (
            <table className="w-full text-xs">
              <tbody>
                {resumo.amostra.map((a) => (
                  <tr key={a.conta} className="border-t">
                    <td className="py-1 pr-2 font-mono">{a.conta}</td>
                    <td className="py-1 pr-2">{a.nome}</td>
                    <td className="py-1 text-right tabular-nums">{a.valor ? formatBRL(a.valor) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {resumo.contas.length > 0 && (
            <Button size="sm" className="h-8" disabled={busy} onClick={colocarNaFila}>
              Carregar {resumo.total} conta(s) na origem desta empresa
            </Button>
          )}
          <p className="text-[11px] text-muted-foreground">
            A fila abaixo usa movimento no BI. Carregar a origem grava código, nome e classificação
            desta empresa — sem isso o agrupamento por máscara não tem galho para juntar.
          </p>
        </div>
      )}
      {contaIgualClassificacao && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-2">
          Neste layout a classificação e o reduzido são a mesma coluna.
          Se o arquivo do ERP tiver as duas, o lote por subgrupo junta menos contas do que deveria.
          Ajuste em Sistemas se o export trouxer classificação à parte.
        </p>
      )}
      {sistema && (
        <Button asChild size="sm" variant="ghost" className="mt-2 h-7 text-xs px-0">
          <Link to="/admin/sistemas">Ajustar layout de {sistema.nome}</Link>
        </Button>
      )}
    </Card>
  );
}
