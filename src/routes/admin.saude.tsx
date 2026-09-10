// Ocupação de espaço e tempo das consultas pesadas — só leitura.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PortalShell } from "@/components/portal-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, HardDrive, Timer, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatBytes } from "@/lib/importacao/ler-arquivo";

export const Route = createFileRoute("/admin/saude")({ component: Page });

interface TabelaStat {
  tabela: string;
  bytes: number;
  linhas_estimadas: number;
  seq_scan: number;
  idx_scan: number;
}

interface EmpresaStat {
  id: string;
  nome: string;
  lancamentos: number;
}

interface SaudeOcupacao {
  gerado_em: string;
  tabelas: TabelaStat[];
  tenant: {
    lancamentos: number;
    historico_linhas: number;
    historico_bytes_est: number;
    plano_contas: number;
    depara: number;
    saldos_mensais: number;
    ecd_lancamentos: number;
  };
  empresas: EmpresaStat[];
}

function rotuloTabela(t: string): string {
  const m: Record<string, string> = {
    lancamentos_diario: "Lançamentos (diário)",
    plano_contas: "Plano de contas",
    saldos_mensais: "Saldos mensais",
    saldos_abertura: "Saldos de abertura",
    depara_contas: "De-para",
    diario_uploads: "Uploads de diário",
    ecd_lancamento: "Lançamentos ECD",
    ecd_conta: "Contas ECD",
    ecd_saldo: "Saldos ECD",
    chart_of_accounts: "Plano (SPED legado)",
    account_balances: "Saldos (SPED legado)",
  };
  return m[t] ?? t;
}

async function medirMs(fn: () => Promise<unknown>): Promise<{ ms: number; ok: boolean; detalhe: string }> {
  const t0 = performance.now();
  try {
    await fn();
    return { ms: Math.round(performance.now() - t0), ok: true, detalhe: "ok" };
  } catch (e: any) {
    return { ms: Math.round(performance.now() - t0), ok: false, detalhe: String(e?.message ?? e) };
  }
}

function Page() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const [rpcMs, setRpcMs] = useState<number | null>(null);
  const [medidas, setMedidas] = useState<{ nome: string; ms: number; ok: boolean; detalhe: string }[] | null>(null);
  const [medindo, setMedindo] = useState(false);

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["saude-ocupacao", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const t0 = performance.now();
      const { data, error } = await (supabase as any).rpc("saude_ocupacao", { _tenant_id: tenantId });
      setRpcMs(Math.round(performance.now() - t0));
      if (error) throw error;
      return data as SaudeOcupacao;
    },
  });

  const medir = async () => {
    if (!tenantId || !data) return;
    setMedindo(true);
    const out: { nome: string; ms: number; ok: boolean; detalhe: string }[] = [];
    out.push({
      nome: "saude_ocupacao (esta tela)",
      ...(await medirMs(async () => {
        const { error } = await (supabase as any).rpc("saude_ocupacao", { _tenant_id: tenantId });
        if (error) throw error;
      })),
    });
    const top = (data.empresas ?? []).filter((e) => e.lancamentos > 0).slice(0, 3);
    for (const emp of top) {
      out.push({
        nome: `indicador_snapshot · ${emp.nome}`,
        ...(await medirMs(async () => {
          const { error } = await (supabase as any).rpc("indicador_snapshot", { _company_id: emp.id });
          if (error) throw error;
        })),
      });
    }
    setMedidas(out);
    setMedindo(false);
  };

  const rpcAusente = /schema cache|does not exist/i.test(String((error as any)?.message ?? ""));
  const tenant = data?.tenant;
  const tabelas = data?.tabelas ?? [];
  const totalBytes = tabelas.reduce((s, t) => s + (Number(t.bytes) || 0), 0);

  return (
    <PortalShell variant="admin" title="Ocupação e desempenho">
      <Card className="p-4 mb-4 text-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex gap-2">
            <HardDrive className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">O que o escritório ocupa no banco</div>
              <p className="text-muted-foreground text-xs mt-0.5">
                Contagens deste tenant. O tamanho em disco das tabelas é do banco inteiro
                (todos os escritórios), útil para ver o que mais cresce.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Atualizar
          </Button>
        </div>
      </Card>

      {rpcAusente && (
        <Card className="p-4 mb-4 border-amber-500/40 bg-amber-500/5 text-sm">
          <div className="flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              A função <code className="text-xs">saude_ocupacao</code> ainda não existe neste banco.
              Aplique a migration <code className="text-xs">20260925000001_saude_ocupacao.sql</code>.
            </div>
          </div>
        </Card>
      )}

      {error && !rpcAusente && (
        <p className="text-sm text-destructive mb-4">{(error as Error).message}</p>
      )}

      {isFetching && !data && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Medindo…
        </div>
      )}

      {tenant && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {[
            { k: "Lançamentos", v: tenant.lancamentos },
            { k: "Com histórico", v: tenant.historico_linhas },
            { k: "Plano de contas", v: tenant.plano_contas },
            { k: "Saldos mensais", v: tenant.saldos_mensais },
          ].map((x) => (
            <Card key={x.k} className="p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{x.k}</div>
              <div className="text-xl font-semibold tabular-nums mt-0.5">
                {x.v.toLocaleString("pt-BR")}
              </div>
            </Card>
          ))}
        </div>
      )}

      {tenant && (
        <Card className="p-4 mb-4 text-sm">
          <div className="font-medium">Histórico gravado</div>
          <p className="text-muted-foreground text-xs mt-0.5">
            Estimativa a partir de uma amostra de 500 linhas. O import corta o texto em 400 caracteres.
          </p>
          <div className="mt-2 text-sm">
            {formatBytes(Number(tenant.historico_bytes_est) || 0)} em histórico neste escritório
            {rpcMs != null && (
              <span className="text-muted-foreground"> · consulta em {rpcMs} ms</span>
            )}
          </div>
        </Card>
      )}

      {tabelas.length > 0 && (
        <Card className="overflow-hidden mb-4">
          <div className="px-4 py-2.5 text-sm font-medium border-b">
            Tabelas no disco ({formatBytes(totalBytes)} no total destas relações)
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Tabela</th>
                <th className="text-right px-4 py-2">Disco</th>
                <th className="text-right px-4 py-2">Linhas (est.)</th>
                <th className="text-right px-4 py-2">Varreduras</th>
                <th className="text-right px-4 py-2">Índice</th>
              </tr>
            </thead>
            <tbody>
              {tabelas.map((t) => (
                <tr key={t.tabela} className="border-t">
                  <td className="px-4 py-1.5">{rotuloTabela(t.tabela)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{formatBytes(Number(t.bytes) || 0)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{Number(t.linhas_estimadas).toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{Number(t.seq_scan).toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{Number(t.idx_scan).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground px-4 py-2">
            Varredura alta e índice baixo nesta tabela costuma significar consulta sem usar índice.
          </p>
        </Card>
      )}

      {(data?.empresas?.length ?? 0) > 0 && (
        <Card className="overflow-hidden mb-4">
          <div className="px-4 py-2.5 text-sm font-medium border-b">Lançamentos por empresa</div>
          <table className="w-full text-sm">
            <tbody>
              {data!.empresas.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="px-4 py-1.5">{e.nome}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">
                    {e.lancamentos.toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex gap-2">
            <Timer className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <div className="font-medium text-sm">Medir consultas</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Cronometra no navegador a ocupação e o snapshot das 3 empresas com mais lançamentos.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={medir} disabled={!data || medindo}>
            {medindo && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Medir agora
          </Button>
        </div>
        {medidas && (
          <ul className="mt-3 space-y-1.5 text-sm">
            {medidas.map((m) => (
              <li key={m.nome} className="flex items-center justify-between gap-2">
                <span className="truncate">{m.nome}</span>
                <span className="shrink-0 flex items-center gap-2">
                  <Badge variant={m.ok ? "outline" : "destructive"} className="tabular-nums">
                    {m.ms} ms
                  </Badge>
                  {!m.ok && <span className="text-xs text-destructive max-w-[220px] truncate">{m.detalhe}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PortalShell>
  );
}
