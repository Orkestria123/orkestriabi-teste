import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { interpretarGradeComMascara } from "@/lib/importacao/atribuir-colunas";
import { camposDiarioFaltando, type LayoutImportacao } from "@/lib/importacao/layout";
import type { GradeArquivo } from "@/lib/importacao/ler-arquivo";
import { rotuloMascara, type MascaraConfig } from "@/lib/mascara/interpretar";

export function LayoutPreviaMascara({
  grade,
  layout,
  mascara,
}: {
  grade: GradeArquivo;
  layout: LayoutImportacao;
  mascara: MascaraConfig;
}) {
  const previa = useMemo(
    () => interpretarGradeComMascara(grade, layout, mascara),
    [grade, layout, mascara],
  );
  const diarioFalta = camposDiarioFaltando(layout);

  if (!layout.colunas.classificacao) {
    return (
      <p className="text-xs text-muted-foreground rounded-md border px-3 py-2">
        Atribua a coluna de <strong>classificação</strong> para o BI ler a máscara
        ({rotuloMascara(mascara)}) e inferir as sintéticas do lote.
      </p>
    );
  }

  const amostra = previa.analiticas.slice(0, 6);
  const pais = previa.sinteticasInferidas.slice(0, 8);
  const temHistorico = !!layout.colunas.historico;

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 px-3 py-2">
      <div className="text-xs">
        <div className="font-medium">Leitura pela máscara — só analíticas</div>
        <p className="text-muted-foreground mt-0.5">
          {rotuloMascara(mascara)}. Cada linha do arquivo é analítica; as sintéticas
          são os prefixos, usados no de-para em lote.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-[10px]">
          {previa.analiticas.length.toLocaleString("pt-BR")} analítica(s) na amostra
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {previa.sinteticasInferidas.length.toLocaleString("pt-BR")} sintética(s) inferida(s)
        </Badge>
        {temHistorico && (
          <Badge variant="outline" className="text-[10px]">histórico mapeado</Badge>
        )}
      </div>
      {diarioFalta.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Para o livro diário ainda faltam: {diarioFalta.join(", ")}.
        </p>
      )}
      {previa.avisos.map((a) => (
        <p key={a} className="text-[11px] text-muted-foreground">{a}</p>
      ))}
      {amostra.length > 0 && (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left py-1 font-medium">Conta</th>
              <th className="text-left py-1 font-medium">Classificação</th>
              <th className="text-left py-1 font-medium">Nível</th>
              {temHistorico && <th className="text-left py-1 font-medium">Histórico</th>}
            </tr>
          </thead>
          <tbody>
            {amostra.map((l) => (
              <tr key={l.conta} className="border-t">
                <td className="py-1 pr-2 font-mono">{l.conta}</td>
                <td className="py-1 pr-2 font-mono">{l.classificacao}</td>
                <td className="py-1">{l.rotuloNivel}</td>
                {temHistorico && (
                  <td className="py-1 max-w-[240px] truncate text-muted-foreground">{l.historico || "—"}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pais.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Ex. sintéticas para lote:{" "}
          {pais.map((p) => `${p.classificacao} (${p.rotuloNivel}, ${p.filhos} contas)`).join(" · ")}
          {previa.sinteticasInferidas.length > pais.length ? "…" : ""}
        </p>
      )}
    </div>
  );
}
