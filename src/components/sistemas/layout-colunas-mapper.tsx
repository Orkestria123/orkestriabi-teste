import {
  CAMPOS_LAYOUT,
  parsePosicaoColuna,
  tokenPosicao,
  type CampoLayoutId,
  type LayoutImportacao,
} from "@/lib/importacao/layout";
import { formatBytes, type GradeArquivo } from "@/lib/importacao/ler-arquivo";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const NENHUMA = "__nenhuma__";
const GRUPOS: { id: "conta" | "lancamento"; titulo: string; texto: string }[] = [
  {
    id: "conta",
    titulo: "Conta (de-para)",
    texto: "Classificação, reduzido e nome. Nível e sintéticas saem da máscara — o arquivo só traz analítica.",
  },
  {
    id: "lancamento",
    titulo: "Lançamento (diário)",
    texto: "O que entra no livro. Histórico é gravado no máximo com 400 caracteres.",
  },
];

function valorSelect(ref: string | undefined, headers: string[]): string {
  if (!ref) return NENHUMA;
  const pos = parsePosicaoColuna(ref);
  if (pos != null) return tokenPosicao(pos - 1);
  const i = headers.findIndex((h) => h === ref);
  return i >= 0 ? tokenPosicao(i) : NENHUMA;
}

function rotuloOpcao(
  i: number,
  headers: string[],
  amostra: string[],
  temCabecalho: boolean,
): string {
  const extra = (amostra[i] ?? "").trim();
  if (temCabecalho) {
    const h = (headers[i] ?? "").trim();
    if (h && extra && h !== extra) return `Coluna ${i + 1} · ${h} · ex.: ${extra}`;
    if (h) return `Coluna ${i + 1} · ${h}`;
  }
  return extra ? `Coluna ${i + 1} · ex.: ${extra}` : `Coluna ${i + 1}`;
}

function colunasDaTabela(grade: GradeArquivo, layout: LayoutImportacao): number[] {
  const mapeadas: number[] = [];
  for (const ref of Object.values(layout.colunas)) {
    const p = parsePosicaoColuna(ref);
    if (p != null && p <= grade.headers.length) mapeadas.push(p - 1);
  }
  if (mapeadas.length > 0) return [...new Set(mapeadas)].sort((a, b) => a - b);
  const teto = Math.min(grade.headers.length, 16);
  return Array.from({ length: teto }, (_, i) => i);
}

export function LayoutColunasMapper({
  grade,
  layout,
  onChange,
  disabled,
}: {
  grade: GradeArquivo;
  layout: LayoutImportacao;
  onChange: (next: LayoutImportacao) => void;
  disabled?: boolean;
}) {
  const temCabecalho = layout.tem_cabecalho && !grade.porPosicao;
  const amostra = grade.linhas[0] ?? [];
  const colsTabela = colunasDaTabela(grade, layout);
  const ignoradas = Math.max(0, grade.nColunasArquivo - colsTabela.length);

  const setCampo = (id: CampoLayoutId, header: string | undefined) => {
    const colunas = { ...layout.colunas };
    if (!header) delete colunas[id];
    else colunas[id] = header;
    onChange({ ...layout, colunas });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground rounded-md border bg-muted/30 px-3 py-2">
        {temCabecalho
          ? <>A primeira linha é nome de coluna. O layout grava a <strong>posição</strong> (Coluna 1, 2, 3…).</>
          : <>Sem cabeçalho: cada lista é a <strong>posição</strong>. O texto da primeira linha é exemplo, não o nome do campo.</>}
        {" "}Só as colunas atribuídas entram no BI — o resto do arquivo é ignorado.
      </p>

      {GRUPOS.map((g) => (
        <div key={g.id} className="space-y-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.titulo}</div>
            <p className="text-[11px] text-muted-foreground">{g.texto}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {CAMPOS_LAYOUT.filter((c) => c.grupo === g.id).map((c) => {
              const atual = valorSelect(layout.colunas[c.id], grade.headers);
              return (
                <div key={c.id}>
                  <Label className="text-xs">
                    {c.rotulo}
                    {c.obrigatorio ? " *" : ""}
                  </Label>
                  <Select
                    disabled={disabled}
                    value={atual}
                    onValueChange={(v) => setCampo(c.id, v === NENHUMA ? undefined : v)}
                  >
                    <SelectTrigger className="h-8 mt-1">
                      <SelectValue placeholder="Coluna do arquivo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NENHUMA}>— não usar —</SelectItem>
                      {grade.headers.map((_, i) => {
                        const value = tokenPosicao(i);
                        return (
                          <SelectItem key={`${i}-${value}`} value={value}>
                            {rotuloOpcao(i, grade.headers, amostra, temCabecalho)}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="overflow-x-auto border rounded-md">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50">
              {colsTabela.map((i) => {
                const h = grade.headers[i];
                return (
                  <th key={i} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                    <span>Coluna {i + 1}</span>
                    {temCabecalho && h ? (
                      <span className="block font-normal text-muted-foreground">{h}</span>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {grade.preview.map((row, i) => (
              <tr key={i} className="border-t">
                {colsTabela.map((j) => (
                  <td key={j} className="px-2 py-1 whitespace-nowrap max-w-[220px] truncate">
                    {row[j] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {formatBytes(grade.bytesArquivo)} · {grade.nColunasArquivo} colunas no arquivo
        {ignoradas > 0 ? ` · prévia só das ${colsTabela.length} mapeadas (${ignoradas} ignoradas)` : ""}
        {" · "}
        {grade.truncado
          ? `${grade.linhas.length.toLocaleString("pt-BR")} linhas na amostra`
          : `${grade.totalLinhas.toLocaleString("pt-BR")} linha(s)`}
        {temCabecalho ? " · com cabeçalho" : " · sem cabeçalho"}
      </p>
    </div>
  );
}
