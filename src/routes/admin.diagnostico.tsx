// Diagnóstico que roda DENTRO do app, com a sessão já autenticada.
//
// Existe porque os dois defeitos abertos (indicador divergindo do Balanço,
// DFC não exportando) não se reproduzem no meu banco: o código do front
// aí está idêntico ao meu, arquivo por arquivo. A diferença só pode estar
// no BANCO — e esta tela mostra qual é, sem terminal e sem SQL Editor.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PortalShell } from "@/components/portal-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { buildStatementFromDiario } from "@/lib/diario/build-statements";
import { getModoGlobal } from "@/lib/plano/escopo";
import { getEstruturaPadrao } from "@/lib/plano/estrutura";
import { resolverLinha } from "@/lib/indicadores/linhas";
import { buildContext } from "@/lib/indicadores/engine";
import { MASCARA_DEFAULT } from "@/lib/mascara/interpretar";

export const Route = createFileRoute("/admin/diagnostico")({ component: Page });

interface Linha {
  rotulo: string;
  estado: "ok" | "erro" | "aviso";
  detalhe: string;
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function rodar(tenantId: string): Promise<{ linhas: Linha[]; texto: string }> {
  const linhas: Linha[] = [];
  const add = (rotulo: string, estado: Linha["estado"], detalhe: string) =>
    linhas.push({ rotulo, estado, detalhe });

  // ---------- 1) as funções da DFC existem? ----------
  try {
    const { data, error } = await (supabase as any).rpc("dfc_exportar", {
      _tenant_id: tenantId, _company_id: null, _somente_balanco: true,
    });
    if (error) throw new Error(error.message);
    add("RPC dfc_exportar", "ok", `respondeu com ${(data ?? []).length} classificação(ões)`);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    add("RPC dfc_exportar", "erro",
      msg.includes("schema cache") || msg.includes("does not exist")
        ? "NÃO EXISTE no banco — a migration 20260826/20260827 não foi aplicada. " +
          "Rode `npx supabase migration up` na pasta do projeto."
        : msg);
  }

  try {
    const { data, error } = await (supabase as any).rpc("dfc_exportar_contas", {
      _tenant_id: tenantId, _company_id: null,
    });
    if (error) throw new Error(error.message);
    add("RPC dfc_exportar_contas", "ok", `${(data ?? []).length} exceção(ões) por conta`);
  } catch (e: any) {
    add("RPC dfc_exportar_contas", "erro", String(e?.message ?? e));
  }

  // ---------- 2) o cadastro de empresa tem as colunas novas? ----------
  try {
    const { error } = await supabase.from("companies").select("id, cep, telefone").limit(1);
    if (error) throw new Error(error.message);
    add("Colunas de endereço/contato", "ok", "presentes");
  } catch (e: any) {
    add("Colunas de endereço/contato", "aviso",
      "ausentes — migration 20260828 não aplicada (não afeta indicador nem DFC)");
  }

  // ---------- 3) indicador × Balanço, empresa por empresa ----------
  const { data: empresas } = await supabase
    .from("companies").select("id, name").eq("tenant_id", tenantId).order("name");

  const est = await getEstruturaPadrao();
  add("Estrutura padrão", est.length > 0 ? "ok" : "erro",
    `${est.length} papéis carregados`);

  for (const emp of (empresas ?? []) as any[]) {
    let snap: any;
    try {
      const { data, error } = await (supabase as any).rpc("indicador_snapshot", {
        _company_id: emp.id,
      });
      if (error) throw new Error(error.message);
      snap = data ?? {};
    } catch (e: any) {
      add(`${emp.name} — indicador_snapshot`, "erro", String(e?.message ?? e));
      continue;
    }

    const plano = snap.plano ?? [];
    const saldos = snap.saldos ?? [];
    const aberturas = snap.aberturas ?? [];
    if (plano.length === 0 && saldos.length === 0) {
      add(`${emp.name}`, "aviso", "sem plano e sem movimento — nada a conferir");
      continue;
    }

    // Órfãos: movimento/abertura cujo conta_codigo não existe no plano
    // devolvido. O motor do indicador descarta isso em SILÊNCIO — é a
    // causa mais provável de o Ativo não bater.
    const codigos = new Set(plano.map((p: any) => p.codigo));
    const movOrfao = saldos.filter((s: any) => !codigos.has(s.conta_codigo));
    const abOrfa = aberturas.filter((a: any) => !codigos.has(a.conta_codigo));
    const perdido =
      movOrfao.reduce((t: number, s: any) =>
        t + (Number(s.total_debitos) || 0) - (Number(s.total_creditos) || 0), 0) +
      abOrfa.reduce((t: number, a: any) => t + (Number(a.saldo) || 0), 0);

    if (movOrfao.length || abOrfa.length) {
      const exemplos = [...abOrfa, ...movOrfao].slice(0, 5)
        .map((x: any) => x.conta_codigo).join(", ");
      add(`${emp.name} — contas órfãs`, "erro",
        `${abOrfa.length} abertura(s) e ${movOrfao.length} movimento(s) com conta_codigo ` +
        `fora do plano. Valor descartado: ${brl(perdido)}. Ex.: ${exemplos}`);
    } else {
      add(`${emp.name} — contas órfãs`, "ok", "nenhuma");
    }

    // Ativo pelos dois caminhos
    try {
      const periodos = Array.from(
        new Set(saldos.map((s: any) => String(s.competencia))),
      ).sort() as string[];
      if (periodos.length === 0) {
        add(`${emp.name} — Ativo`, "aviso", "sem competências com movimento");
        continue;
      }
      const p = periodos[periodos.length - 1];

      const { modoGlobal } = await getModoGlobal(emp.id);
      const rows = await buildStatementFromDiario(
        emp.id, tenantId, modoGlobal, "BP_ATIVO", [p], "contabil");
      const ativoBP =
        rows.find((r: any) => r.descricao === "Total do Ativo" && r.periodo === p)?.valor ?? 0;

      // Mesma montagem do hook (agregando por classificação).
      const codToClass = new Map<string, string>();
      const planoEng = plano.map((x: any) => {
        codToClass.set(x.codigo, x.classificacao);
        return {
          classificacao: x.classificacao, descricao: x.descricao, natureza: x.natureza,
          is_sintetica: x.is_sintetica, is_participante: x.is_participante,
        };
      });
      const agg = new Map<string, any>();
      for (const s of saldos) {
        const cls = codToClass.get(s.conta_codigo);
        if (!cls) continue;
        const k = `${cls}|${s.competencia}`;
        const cur = agg.get(k);
        if (cur) {
          cur.total_debitos += Number(s.total_debitos) || 0;
          cur.total_creditos += Number(s.total_creditos) || 0;
        } else {
          agg.set(k, {
            conta_codigo: cls, competencia: s.competencia,
            total_debitos: Number(s.total_debitos) || 0,
            total_creditos: Number(s.total_creditos) || 0,
          });
        }
      }
      const porContaData = new Map<string, number>();
      for (const a of aberturas) {
        const k = `${a.conta_codigo}|${String(a.data_referencia ?? "")}`;
        porContaData.set(k, (porContaData.get(k) ?? 0) + (Number(a.saldo) || 0));
      }
      const ultima = new Map<string, { data: string; saldo: number }>();
      for (const [k, saldo] of porContaData) {
        const i = k.lastIndexOf("|");
        const cod = k.slice(0, i), data = k.slice(i + 1);
        const at = ultima.get(cod);
        if (!at || data > at.data) ultima.set(cod, { data, saldo });
      }
      const abert = new Map<string, number>();
      for (const [cod, { saldo }] of ultima) {
        const cls = codToClass.get(cod);
        if (!cls) continue;
        abert.set(cls, (abert.get(cls) ?? 0) + saldo);
      }
      const ctx = buildContext({
        plano: planoEng, saldos: [...agg.values()], aberturas: abert, mascara: MASCARA_DEFAULT,
      });
      const ativoInd = resolverLinha("ATIVO_TOTAL", p, ctx, undefined, est);
      const dif = (ativoInd ?? 0) - ativoBP;

      add(`${emp.name} — Ativo em ${p.slice(0, 7)}`,
        Math.abs(dif) < 0.01 ? "ok" : "erro",
        `indicador ${brl(ativoInd ?? 0)} × balanço ${brl(ativoBP)}` +
        (Math.abs(dif) < 0.01 ? "" : `  →  DIFERENÇA ${brl(dif)}`));
    } catch (e: any) {
      add(`${emp.name} — Ativo`, "erro", String(e?.message ?? e));
    }
  }

  const texto = linhas
    .map((l) => `[${l.estado.toUpperCase()}] ${l.rotulo}: ${l.detalhe}`)
    .join("\n");
  return { linhas, texto };
}


/**
 * Extrai um retrato PEQUENO e ANÔNIMO do banco, para o caso poder ser
 * reproduzido fora daqui.
 *
 * Não vai descrição de conta, nem nome de cliente, nem CNPJ — só
 * classificação, tipo e números agregados. O plano de 135.000 contas
 * vira umas poucas centenas de linhas: uma por classificação.
 */
async function extrairDados(tenantId: string) {
  const pacote: any = { gerado_em: new Date().toISOString(), tenant: "(omitido)", empresas: [] };

  // estrutura padrão (classificação -> papel), que é o que o indicador usa
  try {
    const est = await getEstruturaPadrao();
    pacote.estrutura_padrao = est;
  } catch (e: any) { pacote.estrutura_padrao_erro = String(e?.message ?? e); }

  // catálogo e vínculos da DFC
  try {
    const { data } = await supabase.from("dfc_catalogo" as any).select("codigo, bloco, ordem");
    pacote.dfc_catalogo = data ?? [];
  } catch { /* opcional */ }
  try {
    const { data } = await supabase.from("dfc_vinculo" as any)
      .select("classificacao, codigo_dfc, origem, company_id");
    pacote.dfc_vinculo = data ?? [];
  } catch { /* opcional */ }
  try {
    const { error } = await (supabase as any).rpc("dfc_exportar", {
      _tenant_id: tenantId, _company_id: null, _somente_balanco: true,
    });
    pacote.dfc_exportar = error ? { erro: error.message } : { ok: true };
  } catch (e: any) { pacote.dfc_exportar = { erro: String(e?.message ?? e) }; }

  const { data: empresas } = await supabase
    .from("companies").select("id, name, plano_tipo, fonte_dados").eq("tenant_id", tenantId);

  for (const emp of (empresas ?? []) as any[]) {
    const item: any = { nome: emp.name, plano_tipo: emp.plano_tipo, fonte: emp.fonte_dados };
    try {
      const { data: snap, error } = await (supabase as any)
        .rpc("indicador_snapshot", { _company_id: emp.id });
      if (error) throw new Error(error.message);

      const plano = snap?.plano ?? [];
      const saldos = snap?.saldos ?? [];
      const aberturas = snap?.aberturas ?? [];
      item.snapshot = {
        contas: plano.length, saldos: saldos.length, aberturas: aberturas.length,
      };

      // plano agregado por classificação — sem descrição
      const porCls = new Map<string, any>();
      const codToCls = new Map<string, string>();
      for (const c of plano) {
        codToCls.set(c.codigo, c.classificacao);
        const cur = porCls.get(c.classificacao) ?? {
          classificacao: c.classificacao, tipo: c.tipo ?? null, natureza: c.natureza ?? null,
          sintetica: !!c.is_sintetica, participante: !!c.is_participante, contas: 0,
        };
        cur.contas++;
        porCls.set(c.classificacao, cur);
      }

      // abertura e movimento agregados por classificação
      for (const a of aberturas) {
        const cls = codToCls.get(a.conta_codigo);
        const alvo = cls ? porCls.get(cls) : null;
        if (!alvo) { item.abertura_orfa = (item.abertura_orfa ?? 0) + (Number(a.saldo) || 0); continue; }
        alvo.abertura = (alvo.abertura ?? 0) + (Number(a.saldo) || 0);
      }
      for (const sm of saldos) {
        const cls = codToCls.get(sm.conta_codigo);
        const mov = (Number(sm.total_debitos) || 0) - (Number(sm.total_creditos) || 0);
        const alvo = cls ? porCls.get(cls) : null;
        if (!alvo) { item.movimento_orfao = (item.movimento_orfao ?? 0) + mov; continue; }
        alvo.movimento = (alvo.movimento ?? 0) + mov;
      }
      item.plano = [...porCls.values()].filter(
        (x) => x.abertura || x.movimento || !x.participante);

      // o que o Balanço mostra, para comparar
      const periodos = Array.from(new Set(saldos.map((x: any) => String(x.competencia)))).sort() as string[];
      item.periodos = periodos;
      if (periodos.length > 0) {
        const p = periodos[periodos.length - 1];
        const { modoGlobal } = await getModoGlobal(emp.id);
        item.modo_global = modoGlobal;
        const rows = await buildStatementFromDiario(
          emp.id, tenantId, modoGlobal, "BP_ATIVO", [p], "contabil");
        item.balanco_ativo = rows
          .filter((r: any) => r.periodo === p)
          .map((r: any) => ({ d: r.descricao, v: r.valor, n: r.nivel, s: r.is_subtotal }));
      }
    } catch (e: any) {
      item.erro = String(e?.message ?? e);
    }
    pacote.empresas.push(item);
  }
  return pacote;
}

function Page() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const [rodando, setRodando] = useState(false);

  const { data, refetch, isFetching } = useQuery({
    queryKey: ["diagnostico", tenantId],
    enabled: !!tenantId,
    retry: false,
    queryFn: () => rodar(tenantId!),
  });

  const [baixando, setBaixando] = useState(false);
  const baixar = async () => {
    if (!tenantId) return;
    setBaixando(true);
    try {
      const pacote = await extrairDados(tenantId);
      const blob = new Blob([JSON.stringify(pacote, null, 1)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "diagnostico-orkestria.json";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Arquivo baixado — anexe na conversa");
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setBaixando(false);
    }
  };

  const copiar = async () => {
    if (!data?.texto) return;
    await navigator.clipboard.writeText(data.texto);
    toast.success("Resultado copiado — cole na conversa");
  };

  const icone = (e: Linha["estado"]) =>
    e === "ok" ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
    : e === "aviso" ? <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
    : <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />;

  const erros = (data?.linhas ?? []).filter((l) => l.estado === "erro").length;

  return (
    <PortalShell variant="admin" title="Diagnóstico">
      <Card className="p-4 mb-4 text-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-medium">Estado do banco desta instalação</div>
            <p className="text-muted-foreground text-xs mt-0.5">
              Confere as funções da DFC e compara o Ativo do indicador com o do Balanço,
              empresa por empresa. Só leitura — não altera nada.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <Badge variant="outline" className={erros > 0
                ? "text-destructive border-destructive/40"
                : "text-emerald-600 border-emerald-600/40"}>
                {erros > 0 ? `${erros} problema(s)` : "tudo certo"}
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={copiar} disabled={!data}>
              <Copy className="h-4 w-4 mr-1.5" /> Copiar resultado
            </Button>
            <Button size="sm" variant="outline" onClick={baixar} disabled={baixando}>
              {baixando ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        : <Download className="h-4 w-4 mr-1.5" />}
              Baixar dados para análise
            </Button>
            <Button size="sm" onClick={() => { setRodando(true); refetch().finally(() => setRodando(false)); }}
              disabled={isFetching || rodando}>
              {(isFetching || rodando) && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Rodar de novo
            </Button>
          </div>
        </div>
      </Card>

      {isFetching && !data && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Conferindo…
        </div>
      )}

      <Card className="divide-y">
        {(data?.linhas ?? []).map((l, i) => (
          <div key={i} className="flex items-start gap-2.5 px-4 py-2.5 text-sm">
            {icone(l.estado)}
            <div className="min-w-0">
              <div className="font-medium">{l.rotulo}</div>
              <div className="text-muted-foreground text-xs break-words">{l.detalhe}</div>
            </div>
          </div>
        ))}
      </Card>
    </PortalShell>
  );
}
