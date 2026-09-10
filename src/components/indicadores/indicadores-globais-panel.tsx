// As DEFINIÇÕES de indicador do escritório.
//
// Antes cada empresa tinha a sua cópia de cada indicador: 17 indicadores
// em 3 empresas eram 51 linhas. Mudar a fórmula da Margem Líquida
// significava mudar em 3 lugares, e o dia em que uma ficasse para trás
// ninguém descobriria — as três continuariam calculando alguma coisa.
//
// A fórmula sempre foi global por construção (os termos apontam para
// CLASSIFICAÇÕES do plano padrão, não para códigos da empresa). O que
// varia entre clientes não é a fórmula: é se aquele indicador interessa
// àquele cliente — e isso agora é a ALOCAÇÃO, feita dentro da empresa.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2, Plus, Pencil, Trash2, Globe, AlertTriangle, Layers, Eye,
} from "lucide-react";
import { toast } from "sonner";
import { IndicadorEditorDialog } from "./indicador-editor-dialog";
import { DreLinhasConfigCard } from "./dre-linhas-config";
import { DashboardConfigPanel } from "@/components/dashboard/dashboard-config-panel";
import type { ContaPlanoItem } from "./conta-picker";
import { lerTudo } from "@/lib/supabase-paginado";
import { formulaParaTexto } from "@/lib/indicadores/engine";
import { labelLinha } from "@/lib/indicadores/linhas";
import { tituloConta } from "@/lib/format";
import { limparCacheFormulasEbit } from "@/lib/indicadores/ebit-fonte";

const MODO_LABEL: Record<string, string> = {
  numero: "nº", reais: "R$", percentual: "%", ah_percent: "AH%", ah_valor: "AH$",
};

interface Props { 
  tenantId: string;
  onEditGlobal?: (ind: any) => void;
}

interface LocalInd {
  id: string; nome: string; categoria: string; descricao: string | null;
  modo_analise: string; formula: any; faixas: any; visibilidade: string;
  is_padrao: boolean; company_id: string; ordem: number | null;
}

interface Global {
  id: string; nome: string; categoria: string; descricao: string | null;
  modo_analise: string; formula: any; faixas: any; visibilidade: string;
  is_padrao: boolean; ordem: number | null;
}

export function IndicadoresGlobaisPanel({ tenantId, onEditGlobal }: Props) {
  const qc = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editando, setEditando] = useState<any>(null);
  const [somenteLeitura, setSomenteLeitura] = useState(false);
  const [busca, setBusca] = useState("");
  const [simulacao, setSimulacao] = useState<any>(null);
  const [ocupado, setOcupado] = useState(false);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["indicadores-globais", tenantId] });
    qc.invalidateQueries({ queryKey: ["indicadores-locais", tenantId] });
    qc.invalidateQueries({ queryKey: ["indicadores-da-empresa"] });
    qc.invalidateQueries({ queryKey: ["monthly-stmt"] });
    qc.invalidateQueries({ queryKey: ["indic-demo-dre"] });
    qc.invalidateQueries({ queryKey: ["indic-engine-data"] });
    qc.invalidateQueries({ queryKey: ["formulas-ebit-ebitda", tenantId] });
    limparCacheFormulasEbit(tenantId);
  };

  const { data: globais, isLoading } = useQuery({
    queryKey: ["indicadores-globais", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("indicadores_empresa" as any)
        .select("id, nome, categoria, descricao, modo_analise, formula, faixas, visibilidade, is_padrao, ordem")
        .eq("tenant_id", tenantId)
        .is("company_id", null)
        .order("categoria").order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as Global[];
    },
  });

  const { data: locais } = useQuery({
    queryKey: ["indicadores-locais", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("indicadores_empresa" as any)
        .select("id, nome, categoria, descricao, modo_analise, formula, faixas, visibilidade, is_padrao, company_id, ordem")
        .eq("tenant_id", tenantId)
        .not("company_id", "is", null)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as LocalInd[];
    },
  });

  const { data: empresas } = useQuery({
    queryKey: ["empresas-nomes-indic", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const { data: plano } = useQuery({
    queryKey: ["indic-plano-padrao", tenantId],
    queryFn: async () => {
      return await lerTudo<ContaPlanoItem>(
        (de, ate) => supabase
          .from("plano_contas")
          .select("codigo, classificacao, descricao, is_sintetica, is_participante, nivel")
          .eq("tenant_id", tenantId)
          .is("company_id", null)
          .eq("is_participante", false)
          .like("classificacao", "3%")
          .order("classificacao")
          .range(de, ate),
        "plano_contas (indicadores)",
      );
    },
  });

  const labelDaConta = useMemo(() => {
    const porCod = new Map<string, ContaPlanoItem>();
    for (const p of plano ?? []) {
      if (p.codigo) porCod.set(p.codigo, p);
    }
    return (ref: string) => {
      const p = porCod.get(ref) ?? (plano ?? []).find((x) => x.classificacao === ref);
      if (!p) return ref;
      const nome = tituloConta(p.descricao);
      return `${p.classificacao} ${nome}`;
    };
  }, [plano]);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const base = globais ?? [];
    if (!t) return base;
    return base.filter((g) =>
      [g.nome, g.categoria, g.descricao].some((v) => (v ?? "").toLowerCase().includes(t)));
  }, [globais, busca]);

  const simular = async () => {
    setOcupado(true);
    try {
      const { data, error } = await (supabase as any)
        .rpc("indicador_consolidar", { _simular: true });
      if (error) throw new Error(error.message);
      setSimulacao(data);
    } catch (e: any) { toast.error(e.message); }
    finally { setOcupado(false); }
  };

  const consolidar = async () => {
    if (!confirm(
      `Consolidar ${simulacao?.consolidaveis} indicador(es)?\n\n` +
      "As cópias por empresa viram UMA definição do escritório. Cada empresa " +
      "continua vendo os mesmos indicadores, com a mesma visibilidade — isso " +
      "vira alocação.\n\nSó grupos idênticos são consolidados.")) return;
    setOcupado(true);
    try {
      const { data, error } = await (supabase as any)
        .rpc("indicador_consolidar", { _simular: false });
      if (error) throw new Error(error.message);
      toast.success(
        `${data.globais_criados} definição(ões) global(is) criada(s). ` +
        "Cada empresa manteve o que via.", { duration: 10000 });
      setSimulacao(null);
      invalidar();
    } catch (e: any) { toast.error(e.message, { duration: 12000 }); }
    finally { setOcupado(false); }
  };

  const excluir = async (g: { id: string; nome: string }) => {
    if (!confirm(
      `Excluir "${g.nome}"?\n\n` +
      "Se for definição do escritório, deixa de existir para TODAS as empresas.")) return;
    const { error } = await supabase
      .from("indicadores_empresa" as any).delete().eq("id", g.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Excluído");
    invalidar();
  };

  const nomeEmpresa = (id: string) =>
    (empresas ?? []).find((e) => e.id === id)?.name ?? "Empresa";

  const promoverUm = async (loc: LocalInd, silent = false) => {
    const { error } = await supabase
      .from("indicadores_empresa" as any)
      .update({ company_id: null })
      .eq("id", loc.id);
    if (!error) {
      if (!silent) toast.success(`"${loc.nome}" agora é indicador global`);
      return "ok" as const;
    }
    const unique = error.code === "23505" || /uq_indicador_global_nome|duplicate/i.test(error.message);
    if (!unique) {
      if (!silent) toast.error(error.message);
      return "erro" as const;
    }
    const global = (globais ?? []).find(
      (g) => g.nome.trim().toLowerCase() === loc.nome.trim().toLowerCase(),
    );
    if (!global) {
      if (!silent) toast.error(error.message);
      return "erro" as const;
    }
    const { error: alocErr } = await (supabase as any).from("indicador_alocacao").upsert({
      tenant_id: tenantId,
      company_id: loc.company_id,
      indicador_id: global.id,
      visibilidade: loc.visibilidade,
      ordem: loc.ordem,
    });
    if (alocErr) {
      if (!silent) toast.error(alocErr.message);
      return "erro" as const;
    }
    const { error: delErr } = await supabase
      .from("indicadores_empresa" as any).delete().eq("id", loc.id);
    if (delErr) {
      if (!silent) toast.error(delErr.message);
      return "erro" as const;
    }
    if (!silent) toast.success(`"${loc.nome}" unido à definição global já existente`);
    return "ok" as const;
  };

  const promoverTodos = async () => {
    const lista = locais ?? [];
    if (lista.length === 0) return;
    if (!confirm(
      `Promover ${lista.length} indicador(es) local(is) a definições do escritório?\n\n` +
      "A fórmula passa a valer para todas as empresas. A visibilidade de cada cliente vira alocação.")) return;
    setOcupado(true);
    try {
      let ok = 0;
      for (const loc of lista) {
        const r = await promoverUm(loc, true);
        if (r === "ok") ok++;
      }
      toast.success(`${ok} indicador(es) promovido(s) a globais.`);
      invalidar();
    } finally { setOcupado(false); }
  };

  const nLocais = (locais ?? []).length;
  const locaisFiltrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const base = locais ?? [];
    if (!t) return base;
    return base.filter((g) =>
      [g.nome, g.categoria, g.descricao, nomeEmpresa(g.company_id)].some((v) =>
        (v ?? "").toLowerCase().includes(t)));
  }, [locais, busca, empresas]);

  return (
    <div className="space-y-4">
      <Card className="p-4 border-primary/20 bg-primary/5 text-sm">
        <div className="flex items-start gap-3">
          <Globe className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Definições do escritório</div>
            <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">
              A fórmula vale para <strong>todas as empresas</strong> — ela aponta para
              classificações do plano padrão, não para códigos de uma empresa. O que muda
              de cliente para cliente é <strong>quais indicadores ficam visíveis</strong>
              (dashboard, aba, ou ambos), e isso se escolhe na empresa, em
              {" "}<strong>Dados → Indicadores</strong>.
            </p>
          </div>
        </div>
      </Card>

      {nLocais > 0 && (
        <Card className="p-4 border-amber-500/40 bg-amber-500/5 text-sm">
          <div className="flex items-start gap-3">
            <Layers className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">
                {nLocais} cópia(s) por empresa ainda não consolidada(s)
              </div>
              <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">
                Indicadores criados só na empresa (ex.: Casa do Vidro) não apareciam
                nesta lista. Abaixo você pode ver, editar, excluir ou promovê-los
                a definição do escritório.
              </p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Button size="sm" disabled={ocupado} onClick={promoverTodos}>
                  {ocupado && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  Promover todas a globais
                </Button>
                <Button size="sm" variant="outline" disabled={ocupado} onClick={simular}>
                  Simular consolidação
                </Button>
                {simulacao && (
                  <>
                    <span className="text-xs">
                      <strong>{simulacao.consolidaveis}</strong> consolidável(is)
                      {Number(simulacao.copias_afetadas) > 0 &&
                        ` · ${simulacao.copias_afetadas} cópia(s) viram alocação`}
                    </span>
                    {Number(simulacao.consolidaveis) > 0 && (
                      <Button size="sm" disabled={ocupado} onClick={consolidar}>
                        Consolidar agora
                      </Button>
                    )}
                  </>
                )}
              </div>
              {simulacao && (simulacao.divergentes ?? []).length > 0 && (
                <div className="mt-2 text-xs text-amber-700 flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    Divergentes (ficam como estão):{" "}
                    <strong>{(simulacao.divergentes ?? []).join(", ")}</strong>. As empresas
                    têm fórmulas ou faixas diferentes com o mesmo nome — abra cada uma e
                    decida qual vale antes de consolidar.
                  </span>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      <DreLinhasConfigCard tenantId={tenantId} plano={plano ?? []} />

      <DashboardConfigPanel tenantId={tenantId} />

      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={() => { setEditando(null); setSomenteLeitura(false); setEditorOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Criar indicador global
        </Button>
        <Input
          className="h-8 text-xs max-w-xs"
          placeholder="Filtrar…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <span className="ml-auto text-xs text-muted-foreground">
          {lista.length} de {(globais ?? []).length} definição(ões)
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : lista.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground text-center">
          {nLocais > 0
            ? "Nenhuma definição global ainda — comece pela consolidação acima."
            : "Nenhum indicador global. Crie o primeiro."}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {lista.map((g) => (
                <tr key={g.id} className="border-t first:border-t-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{g.nome}</div>
                    <div className="text-[11px] text-muted-foreground">{g.categoria}</div>
                    <div className="text-[11px] text-muted-foreground/90 font-mono truncate max-w-[520px]"
                         title={formulaParaTexto(g.formula, labelDaConta, labelLinha) || ""}>
                      {formulaParaTexto(g.formula, labelDaConta, labelLinha) || "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 w-[80px]">
                    <Badge variant="outline" className="text-[10px]">
                      {MODO_LABEL[g.modo_analise] ?? g.modo_analise}
                    </Badge>
                  </td>
                  <td className="px-2 py-2 w-[220px] text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() => { setEditando(g); setSomenteLeitura(true); setEditorOpen(true); }}>
                      <Eye className="h-3.5 w-3.5 mr-1" /> Ver
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() => { setEditando(g); setSomenteLeitura(false); setEditorOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive"
                      onClick={() => excluir(g)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {nLocais > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Cópias por empresa ({locaisFiltrados.length})
          </h3>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {locaisFiltrados.map((g) => (
                  <tr key={g.id} className="border-t first:border-t-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{g.nome}</div>
                      <div className="text-xs text-muted-foreground">
                        {g.categoria}
                        <Badge variant="outline" className="ml-1.5 text-[9px]">
                          {nomeEmpresa(g.company_id)}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground/90 font-mono truncate max-w-[520px]"
                           title={formulaParaTexto(g.formula, labelDaConta, labelLinha) || ""}>
                        {formulaParaTexto(g.formula, labelDaConta, labelLinha) || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 w-[120px]">
                      <Badge variant="outline" className="text-[10px]">
                        {MODO_LABEL[g.modo_analise] ?? g.modo_analise}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 w-[320px] text-right whitespace-nowrap">
                      <Button size="sm" variant="outline" className="h-7 text-xs mr-1"
                        onClick={() => { setEditando(g); setSomenteLeitura(true); setEditorOpen(true); }}>
                        <Eye className="h-3.5 w-3.5 mr-1" /> Ver
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs mr-1"
                        onClick={() => { setEditando(g); setSomenteLeitura(false); setEditorOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs mr-1"
                        disabled={ocupado}
                        onClick={async () => {
                          setOcupado(true);
                          try {
                            await promoverUm(g);
                            invalidar();
                          } finally { setOcupado(false); }
                        }}>
                        <Globe className="h-3.5 w-3.5 mr-1" /> Tornar global
                      </Button>
                      <Button size="sm" variant="ghost"
                        className="h-7 text-xs text-destructive"
                        onClick={() => excluir(g)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      <IndicadorEditorDialog
        open={editorOpen}
        onOpenChange={(v) => {
          setEditorOpen(v);
          if (!v) { setEditando(null); setSomenteLeitura(false); }
        }}
        tenantId={tenantId}
        companyId={null}
        plano={plano ?? []}
        indicador={editando}
        somenteLeitura={somenteLeitura}
        onSaved={invalidar}
      />
    </div>
  );
}