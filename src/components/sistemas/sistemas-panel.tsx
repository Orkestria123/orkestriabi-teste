import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Save, Trash2, Info } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  CAMPOS_LAYOUT, LAYOUT_VAZIO, layoutDeJson, layoutPronto, sugerirColunas,
  indiceDaColuna, parsePosicaoColuna, refsParaPosicao, rotuloRefColuna, tokenPosicao,
  camposDiarioFaltando,
  type LayoutImportacao,
} from "@/lib/importacao/layout";
import { sugerirColunasPorConteudo } from "@/lib/importacao/atribuir-colunas";
import { formatBytes, lerArquivoQualquer, type GradeArquivo } from "@/lib/importacao/ler-arquivo";
import { getMascaraConfig, MASCARA_DEFAULT, rotuloMascara } from "@/lib/mascara/interpretar";
import { LayoutColunasMapper } from "./layout-colunas-mapper";
import { LayoutPreviaMascara } from "./layout-previa-mascara";
import { Switch } from "@/components/ui/switch";

export interface SistemaContabil {
  id: string;
  tenant_id: string;
  nome: string;
  layout: unknown;
  updated_at: string;
}

export function SistemasPanel({
  tenantId,
  podeEditar,
}: {
  tenantId: string;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const [nomeNovo, setNomeNovo] = useState("");
  const [atual, setAtual] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutImportacao>(LAYOUT_VAZIO);
  const [grade, setGrade] = useState<GradeArquivo | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);

  const { data: mascara = MASCARA_DEFAULT } = useQuery({
    queryKey: ["mascara-classificacao", tenantId],
    queryFn: () => getMascaraConfig({ tenantId }),
  });

  const { data: sistemas, isLoading } = useQuery({
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

  const selecionar = (s: SistemaContabil) => {
    setAtual(s.id);
    setLayout(layoutDeJson(s.layout));
    setGrade(null);
    setArquivo(null);
  };

  const criar = async () => {
    const nome = nomeNovo.trim();
    if (!nome) return;
    setSalvando(true);
    try {
      const { data, error } = await (supabase as any)
        .from("sistemas_contabeis")
        .insert({ tenant_id: tenantId, nome, layout: LAYOUT_VAZIO })
        .select("id, tenant_id, nome, layout, updated_at")
        .single();
      if (error) throw error;
      toast.success(`Sistema "${nome}" criado. Agora carregue um arquivo e atribua as colunas.`);
      setNomeNovo("");
      qc.invalidateQueries({ queryKey: ["sistemas-contabeis", tenantId] });
      selecionar(data as SistemaContabil);
    } catch (e: any) { toast.error(e.message); }
    finally { setSalvando(false); }
  };

  const apagar = async (s: SistemaContabil) => {
    if (!confirm(`Apagar o sistema "${s.nome}"? Empresas que o usavam ficam sem sistema (o de-para delas permanece).`)) return;
    const { error } = await (supabase as any).from("sistemas_contabeis").delete().eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    if (atual === s.id) {
      setAtual(null);
      setGrade(null);
      setArquivo(null);
      setLayout(LAYOUT_VAZIO);
    }
    toast.success("Sistema apagado.");
    qc.invalidateQueries({ queryKey: ["sistemas-contabeis", tenantId] });
  };

  const onFile = async (file: File, forcarCabecalho?: boolean) => {
    try {
      const temCabecalho = forcarCabecalho ?? layout.tem_cabecalho;
      const g = await lerArquivoQualquer(file, {
        temCabecalho,
        linhaCabecalho: layout.linha_cabecalho,
        maxLinhas: 80,
      });
      setArquivo(file);
      setGrade(g);
      setLayout((prev) => {
        const colunas: LayoutImportacao["colunas"] = {};
        for (const c of CAMPOS_LAYOUT) {
          const ref = prev.colunas[c.id];
          if (!ref) continue;
          const pos = parsePosicaoColuna(ref);
          if (pos != null && pos <= g.headers.length) {
            colunas[c.id] = tokenPosicao(pos - 1);
            continue;
          }
          const iNome = indiceDaColuna(g.headers, ref);
          if (iNome >= 0) {
            colunas[c.id] = tokenPosicao(iNome);
            continue;
          }
          const iAntigo = grade ? indiceDaColuna(grade.headers, ref) : -1;
          if (iAntigo >= 0 && iAntigo < g.headers.length) {
            colunas[c.id] = tokenPosicao(iAntigo);
          }
        }
        if (Object.keys(colunas).length === 0) {
          if (g.porPosicao || !temCabecalho) {
            Object.assign(colunas, sugerirColunasPorConteudo(g.linhas, mascara));
          } else {
            Object.assign(colunas, refsParaPosicao(sugerirColunas(g.headers), g.headers));
          }
        }
        return {
          ...prev,
          tem_cabecalho: temCabecalho,
          linha_cabecalho: temCabecalho ? Math.max(1, prev.linha_cabecalho || 1) : 0,
          colunas: refsParaPosicao(colunas, g.headers),
        };
      });
    } catch (e: any) { toast.error(e.message); }
  };

  const gravarLayout = async () => {
    if (!atual) return;
    const aGravar: LayoutImportacao = grade
      ? { ...layout, colunas: refsParaPosicao(layout.colunas, grade.headers) }
      : layout;
    const faltam = layoutPronto(aGravar);
    if (faltam.length) {
      toast.error(`Faltam colunas obrigatórias: ${faltam.join(", ")}.`);
      return;
    }
    setSalvando(true);
    try {
      const { error } = await (supabase as any)
        .from("sistemas_contabeis")
        .update({ layout: aGravar, updated_at: new Date().toISOString() })
        .eq("id", atual);
      if (error) throw error;
      setLayout(aGravar);
      toast.success("Layout gravado neste sistema. O de-para de cada empresa usa este mapa para ler o arquivo.");
      qc.invalidateQueries({ queryKey: ["sistemas-contabeis", tenantId] });
    } catch (e: any) { toast.error(e.message); }
    finally { setSalvando(false); }
  };

  const selecionado = (sistemas ?? []).find((s) => s.id === atual);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 border-blue-500/30 bg-blue-500/5">
        <div className="flex gap-2 text-sm">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <strong>Layout por sistema, de-para por empresa.</strong>{" "}
            Ensine o BI quais colunas do ERP guardar (conta, classificação, data, débito, crédito, histórico).
            O resto do arquivo não entra. O vínculo conta origem → Plano Padrão continua em{" "}
            <Link to="/admin/empresas" className="underline">Empresas → Dados → De-Para</Link>.
          </div>
        </div>
      </Card>

      <div className="grid md:grid-cols-[260px_1fr] gap-4">
        <Card className="p-3 space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Sistemas ({sistemas?.length ?? 0})
          </div>
          {(sistemas ?? []).map((s) => {
            const l = layoutDeJson(s.layout);
            const n = Object.keys(l.colunas).length;
            return (
              <div key={s.id} className={`flex items-center gap-1 rounded-md px-1 ${atual === s.id ? "bg-muted" : ""}`}>
                <button
                  type="button"
                  className="flex-1 text-left text-sm py-1.5 px-1 truncate"
                  onClick={() => selecionar(s)}
                >
                  {s.nome}
                  <span className="block text-[11px] text-muted-foreground">
                    {n === 0 ? "sem layout" : `${n} coluna(s)`}
                  </span>
                </button>
                {podeEditar && (
                  <Button size="icon" variant="ghost" className="h-7 w-7"
                    onClick={() => apagar(s)} title="Apagar">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
          {podeEditar && (
            <div className="pt-2 space-y-1.5 border-t">
              <Input className="h-8 text-sm" placeholder="Nome do sistema"
                value={nomeNovo} onChange={(e) => setNomeNovo(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") criar(); }} />
              <Button size="sm" className="w-full h-8" disabled={salvando || !nomeNovo.trim()}
                onClick={criar}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Criar
              </Button>
            </div>
          )}
        </Card>

        <Card className="p-4">
          {!selecionado ? (
            <p className="text-sm text-muted-foreground">
              Crie um sistema à esquerda e carregue qualquer CSV ou XLSX para atribuir as colunas.
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="font-medium">{selecionado.nome}</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Colunas canônicas: {CAMPOS_LAYOUT.map((c) => c.rotulo).join("; ")}.
                </p>
              </div>
              <div>
                <Label className="text-xs">Arquivo de exemplo (CSV ou Excel)</Label>
                <Input className="mt-1" type="file" accept=".csv,.txt,.xlsx,.xls"
                  disabled={!podeEditar}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                  }} />
                <div className="flex items-center gap-2 mt-2">
                  <Switch
                    checked={layout.tem_cabecalho}
                    disabled={!podeEditar}
                    onCheckedChange={(v) => {
                      if (arquivo) onFile(arquivo, v);
                      else {
                        setLayout((prev) => ({
                          ...prev,
                          tem_cabecalho: v,
                          linha_cabecalho: v ? Math.max(1, prev.linha_cabecalho || 1) : 0,
                        }));
                      }
                    }}
                  />
                  <Label className="text-xs font-normal">
                    A primeira linha é cabeçalho (nomes de coluna)
                  </Label>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Só as 80 primeiras linhas entram nesta tela ({grade ? formatBytes(grade.bytesArquivo) : "arquivo grande"}).
                  Colunas não atribuídas nunca são gravadas. Máscara: {rotuloMascara(mascara)}.
                </p>
              </div>
              {grade && (
                <>
                  <LayoutColunasMapper
                    grade={grade}
                    layout={layout}
                    onChange={setLayout}
                    disabled={!podeEditar}
                  />
                  <LayoutPreviaMascara grade={grade} layout={layout} mascara={mascara} />
                </>
              )}
              {!grade && Object.keys(layout.colunas).length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Layout já gravado. Carregue um arquivo para conferir ou alterar.
                  <div className="mt-2 flex flex-wrap gap-1">
                    {CAMPOS_LAYOUT.map((c) => layout.colunas[c.id] && (
                      <Badge key={c.id} variant="outline" className="text-[10px]">
                        {c.rotulo}: {rotuloRefColuna(layout.colunas[c.id]!)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {podeEditar && (
                <div className="space-y-1">
                  {camposDiarioFaltando(layout).length > 0 && Object.keys(layout.colunas).length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Layout de conta ok. Para o diário, atribua também: {camposDiarioFaltando(layout).join(", ")}.
                    </p>
                  )}
                  <Button onClick={gravarLayout} disabled={salvando || (!grade && Object.keys(layout.colunas).length === 0)}>
                    {salvando ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                    Gravar layout neste sistema
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
