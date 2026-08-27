// Exportar e importar a alocação da DFC em planilha.
//
// Vivia dentro de `admin.plano-padrao.tsx`, e por isso só existia para o
// plano do ESCRITÓRIO. Uma empresa não tinha por onde exportar a própria
// alocação — e quando a exportação era chamada com o id da empresa, ela
// voltava VAZIA, porque `dfc_efetivo` procurava contas com o company_id
// da empresa e uma empresa que usa o Plano Padrão não tem nenhuma. Os
// dois lados foram corrigidos: a consulta (ajuste 34) e este componente,
// que agora atende as duas telas.
//
// Uma assimetria de propósito: EXPORTAR vale sempre — é conferência, não
// muda nada. IMPORTAR só aparece onde a alocação é realmente daquele
// escopo. Numa empresa que usa o Plano Padrão, importar criaria vínculos
// próprios que passariam por cima do escritório em silêncio, e a
// divergência só apareceria semanas depois num número que não bate.
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  carregarAlocacoes,
  carregarExcecoes,
  carregarCatalogoDfc,
  gerarPlanilhaDfc,
  lerPlanilhaDfc,
  importarAlocacoes,
} from "@/lib/dfc/planilha";

export function PlanilhaDfcBotoes({
  tenantId, companyId = null, onDone, disabled, permitirImportar = true, nomeArquivo = "alocacoes-dfc",
}: {
  tenantId: string;
  /** null = plano do escritório; um id = a alocação daquela empresa. */
  companyId?: string | null;
  onDone: () => void;
  disabled: boolean;
  /** Esconde o "Importar" onde a alocação não pertence a este escopo. */
  permitirImportar?: boolean;
  nomeArquivo?: string;
}) {
  const [busy, setBusy] = useState<"exportar" | "importar" | null>(null);
  const [substituir, setSubstituir] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const exportar = async () => {
    setBusy("exportar");
    try {
      const [linhas, excecoes, catalogo] = await Promise.all([
        carregarAlocacoes(tenantId, companyId, true),
        carregarExcecoes(tenantId, companyId),
        carregarCatalogoDfc(),
      ]);
      const hoje = new Date().toISOString().slice(0, 10);
      if (linhas.length === 0) {
        // Antes isto baixava uma planilha com cabeçalho e mais nada, e
        // parecia defeito da tela. Dizer o motivo é melhor do que
        // entregar um arquivo vazio.
        toast.warning(
          "Não há alocação de DFC neste escopo para exportar — o plano deste escopo está vazio.",
          { duration: 10000 });
        return;
      }
      gerarPlanilhaDfc(linhas, excecoes, catalogo, `${nomeArquivo}-${hoje}`);
      // O que interessa saber ao baixar não é quantas linhas saíram, e sim
      // quanto do que TEM MOVIMENTO ficou sem destino na DFC.
      const pendentes = linhas.filter((l) => !l.codigo_dfc && l.analiticas > 0);
      const contasPendentes = pendentes.reduce((s, l) => s + l.analiticas, 0);
      const comMovimento = pendentes.reduce((s, l) => s + l.com_movimento, 0);
      toast.success(
        `${linhas.length.toLocaleString("pt-BR")} classificação(ões) na planilha, ` +
        `cobrindo ${linhas.reduce((s, l) => s + l.contas, 0).toLocaleString("pt-BR")} conta(s).` +
        (contasPendentes > 0
          ? ` ${contasPendentes.toLocaleString("pt-BR")} analítica(s) sem alocação` +
            (comMovimento > 0 ? ` — ${comMovimento.toLocaleString("pt-BR")} com movimento.` : ".")
          : " Nenhuma analítica sem alocação."),
        { duration: 10000 },
      );
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const importar = async (arquivo: File) => {
    setBusy("importar");
    try {
      const leitura = await lerPlanilhaDfc(arquivo);
      for (const a of leitura.avisos.slice(0, 3)) toast.warning(a);
      const r = await importarAlocacoes(tenantId, leitura.linhas, companyId, substituir);
      if (!r.ok) {
        const primeiros = (r.erros ?? []).slice(0, 3)
          .map((e) => `linha ${e.linha}: ${e.erro}${e.classificacao ? ` (${e.classificacao})` : ""}`)
          .join(" · ");
        toast.error(
          `Nada foi gravado — ${(r.erros ?? []).length} problema(s). ${primeiros}`,
          { duration: 12000 },
        );
        return;
      }
      for (const a of (r.avisos ?? []).slice(0, 3)) toast.warning(a, { duration: 12000 });
      const nada =
        !r.vinculos_criados && !r.vinculos_atualizados &&
        !r.vinculos_removidos && !r.excecoes_removidas;
      toast.success(
        nada
          ? `Aba "${leitura.aba}": a planilha já é o que está no sistema — nada a alterar.`
          : `Aba "${leitura.aba}": ${r.vinculos_criados} vínculo(s) criado(s), ` +
            `${r.vinculos_atualizados} atualizado(s)` +
            (r.vinculos_removidos ? `, ${r.vinculos_removidos} removido(s)` : "") +
            `. ${r.cobertura?.sem_codigo === 0
              ? "Nenhuma analítica de balanço sem alocação."
              : `${r.cobertura?.sem_codigo?.toLocaleString("pt-BR")} analítica(s) ainda sem alocação.`}`,
        { duration: 10000 },
      );
      onDone();
    } catch (e: any) { toast.error(e.message, { duration: 10000 }); }
    finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={busy !== null} onClick={exportar}>
        {busy === "exportar"
          ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          : <Download className="h-4 w-4 mr-2" />}
        Exportar alocações
      </Button>
      {permitirImportar && (
      <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); }}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={busy !== null || disabled}
        title={substituir
          ? "As classificações que não estiverem na planilha perdem a alocação"
          : "A planilha atualiza o que traz; o resto fica como está"}
        onClick={() => inputRef.current?.click()}
      >
        {busy === "importar"
          ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          : <Upload className="h-4 w-4 mr-2" />}
        Importar alocações
      </Button>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
        <input type="checkbox" checked={substituir} disabled={disabled}
          onChange={(e) => setSubstituir(e.target.checked)} />
        substituir tudo
      </label>
      </>
      )}
    </div>
  );
}

