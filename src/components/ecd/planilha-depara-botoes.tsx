// Os dois botões da planilha do de-para da ECD.
//
// A importação NÃO grava direto. Ela mostra primeiro o que vai acontecer
// — quantos vínculos novos, alterados, removidos e quantas linhas têm
// problema — porque uma planilha vinda do Excel é editada à mão e o erro
// mais comum (código de destino digitado errado) só se vê comparando com
// o plano. Gravar calado transformaria isso num número errado semanas
// depois.
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Download, Upload, Loader2, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import {
  carregarDadosPlanilha,
  gerarPlanilhaDepara,
  lerPlanilhaDepara,
  validarImportacao,
  gravarImportacao,
  type DadosPlanilhaDepara,
  type PreviaImportacao,
} from "@/lib/ecd/planilha-depara";

export function PlanilhaDeparaBotoes({
  importacaoId,
  companyId,
  nomeEmpresa,
  disabled,
  onDone,
}: {
  importacaoId: string;
  companyId: string;
  nomeEmpresa?: string | null;
  disabled?: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<"exportar" | "ler" | "gravar" | null>(null);
  const [previa, setPrevia] = useState<{ aba: string; previa: PreviaImportacao } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const exportar = async () => {
    setBusy("exportar");
    try {
      const dados = await carregarDadosPlanilha(importacaoId, companyId);
      if (dados.linhas.length === 0) {
        toast.warning("Este ECD não tem contas para exportar.", { duration: 8000 });
        return;
      }
      const hoje = new Date().toISOString().slice(0, 10);
      const slug = (nomeEmpresa ?? "empresa").toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
      gerarPlanilhaDepara(dados, `depara-ecd-${slug}-${hoje}`);
      const analiticas = dados.linhas.filter((l) => !l.sintetica);
      const pendentes = analiticas.filter((l) => !l.destino && !l.ignorada);
      toast.success(
        `${analiticas.length.toLocaleString("pt-BR")} conta(s) na planilha — ` +
        (pendentes.length === 0
          ? "todas com destino."
          : `${pendentes.length.toLocaleString("pt-BR")} ainda sem destino.`) +
        ` A segunda aba traz o plano de destino (${dados.plano.length.toLocaleString("pt-BR")} contas, sem clientes/fornecedores).`,
        { duration: 10000 },
      );
    } catch (e: any) { toast.error(e.message, { duration: 12000 }); }
    finally { setBusy(null); }
  };

  const ler = async (arquivo: File) => {
    setBusy("ler");
    try {
      const [leitura, dados] = await Promise.all([
        lerPlanilhaDepara(arquivo),
        carregarDadosPlanilha(importacaoId, companyId),
      ]);
      for (const a of leitura.avisos.slice(0, 3)) toast.warning(a, { duration: 10000 });
      const p = validarImportacao(leitura.linhas, dados);
      const mudancas = p.criados.length + p.atualizados.length + p.removidos.length;
      if (mudancas === 0 && p.erros.length === 0) {
        toast.success(`Aba "${leitura.aba}": a planilha já é o que está no sistema — nada a alterar.`,
          { duration: 8000 });
        return;
      }
      setPrevia({ aba: leitura.aba, previa: p });
    } catch (e: any) { toast.error(e.message, { duration: 12000 }); }
    finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const gravar = async () => {
    if (!previa) return;
    setBusy("gravar");
    try {
      const r = await gravarImportacao(companyId, previa.previa);
      toast.success(
        `${r.gravadas} vínculo(s) gravado(s)` +
        (r.limpas > 0 ? ` e ${r.limpas} removido(s) — essas contas voltaram para pendentes.` : "."),
        { duration: 10000 },
      );
      setPrevia(null);
      onDone();
    } catch (e: any) { toast.error(e.message, { duration: 12000 }); }
    finally { setBusy(null); }
  };

  const p = previa?.previa;

  return (
    <>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={exportar}
          title="Baixa o de-para completo em Excel: aba 1 com as contas do ECD e o destino, aba 2 com o plano de destino">
          {busy === "exportar" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                               : <Download className="h-4 w-4 mr-2" />}
          Baixar planilha do de-para
        </Button>
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); }} />
        <Button size="sm" variant="outline" disabled={busy !== null || !!disabled}
          onClick={() => inputRef.current?.click()}
          title="Lê a primeira aba da planilha preenchida e mostra o que vai mudar antes de gravar">
          {busy === "ler" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          : <Upload className="h-4 w-4 mr-2" />}
          Importar planilha do de-para
        </Button>
      </div>

      {p && (
        <Card className="p-3 text-xs space-y-2 border-primary/40">
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium text-sm">
              Aba "{previa!.aba}": confira antes de gravar
            </div>
            <Button size="icon" variant="ghost" className="h-6 w-6"
              onClick={() => setPrevia(null)} disabled={busy !== null}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span>{p.criados.length} vínculo(s) novo(s)</span>
            <span>{p.atualizados.length} alterado(s)</span>
            <span>{p.removidos.length} removido(s)</span>
            <span>{p.inalterados} sem mudança</span>
          </div>
          {p.erros.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 space-y-1">
              <div className="flex items-center gap-1.5 text-amber-600 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                {p.erros.length} linha(s) com problema — não serão gravadas
              </div>
              {p.erros.slice(0, 8).map((e) => (
                <div key={`${e.linha}-${e.codigo}`} className="text-muted-foreground">
                  linha {e.linha} · {e.codigo}: {e.erro}
                </div>
              ))}
              {p.erros.length > 8 && (
                <div className="text-muted-foreground">…e mais {p.erros.length - 8}.</div>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={gravar}
              disabled={busy !== null ||
                (p.criados.length + p.atualizados.length + p.removidos.length) === 0}>
              {busy === "gravar" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Gravar {p.criados.length + p.atualizados.length + p.removidos.length} alteração(ões)
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPrevia(null)} disabled={busy !== null}>
              Cancelar
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
