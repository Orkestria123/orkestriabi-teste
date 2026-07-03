// Dialog para criar/editar um indicador da empresa.
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FormulaBuilder } from "./formula-builder";
import type { ContaPlanoItem } from "./conta-picker";
import {
  validarExpressao,
  type IndicadorEmpresa,
  type ModoAnalise,
  type Token,
} from "@/lib/indicadores/engine";

const CATEGORIAS = ["Liquidez", "Rentabilidade", "Endividamento", "Atividade", "Personalizado"];

const MODOS: { value: ModoAnalise; label: string; hint: string }[] = [
  { value: "numero", label: "nº — Número puro", hint: "Índice / razão (ex.: 1,50)" },
  { value: "reais", label: "R$ — Valor em reais", hint: "Formatado como moeda" },
  { value: "percentual", label: "% — Percentual (× 100)", hint: "Multiplica a fórmula por 100" },
  { value: "ah_percent", label: "AH% — Variação % entre períodos", hint: "(último − primeiro) / |primeiro| × 100" },
  { value: "ah_valor", label: "AH$ — Variação absoluta entre períodos", hint: "último − primeiro" },
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  companyId: string;
  plano: ContaPlanoItem[];
  indicador?: IndicadorEmpresa | null;
  onSaved: () => void;
}

export function IndicadorEditorDialog({
  open, onOpenChange, tenantId, companyId, plano, indicador, onSaved,
}: Props) {
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("Personalizado");
  const [descricao, setDescricao] = useState("");
  const [modo, setModo] = useState<ModoAnalise>("numero");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [faixaOtimo, setFaixaOtimo] = useState("");
  const [faixaBom, setFaixaBom] = useState("");
  const [faixaAtencao, setFaixaAtencao] = useState("");
  const [direcao, setDirecao] = useState<"maior_melhor" | "menor_melhor">("maior_melhor");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (indicador) {
      setNome(indicador.nome);
      setCategoria(indicador.categoria || "Personalizado");
      setDescricao(indicador.descricao ?? "");
      setModo(indicador.modo_analise);
      setTokens(indicador.formula?.expressao ?? []);
      setFaixaOtimo(indicador.faixas?.otimo != null ? String(indicador.faixas.otimo) : "");
      setFaixaBom(indicador.faixas?.bom != null ? String(indicador.faixas.bom) : "");
      setFaixaAtencao(indicador.faixas?.atencao != null ? String(indicador.faixas.atencao) : "");
      setDirecao(indicador.faixas?.direcao ?? "maior_melhor");
    } else {
      setNome(""); setCategoria("Personalizado"); setDescricao("");
      setModo("numero"); setTokens([]);
      setFaixaOtimo(""); setFaixaBom(""); setFaixaAtencao("");
      setDirecao("maior_melhor");
    }
  }, [open, indicador]);

  const salvar = async () => {
    if (!nome.trim()) { toast.error("Informe o nome do indicador."); return; }
    const erros = validarExpressao(tokens);
    if (erros.length > 0) { toast.error(erros[0]); return; }

    setSaving(true);
    try {
      const parseNum = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
      const faixas = (faixaOtimo || faixaBom || faixaAtencao)
        ? {
            otimo: parseNum(faixaOtimo),
            bom: parseNum(faixaBom),
            atencao: parseNum(faixaAtencao),
            direcao,
          }
        : null;
      const payload = {
        tenant_id: tenantId,
        company_id: companyId,
        nome: nome.trim(),
        categoria,
        descricao: descricao.trim() || null,
        modo_analise: modo,
        formula: { expressao: tokens },
        faixas,
        revisar_contas: false,
      };
      if (indicador?.id) {
        const { error } = await supabase
          .from("indicadores_empresa" as any)
          .update(payload)
          .eq("id", indicador.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("indicadores_empresa" as any)
          .insert({ ...payload, is_padrao: false });
        if (error) throw error;
      }
      toast.success("Indicador salvo");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{indicador ? "Editar Indicador" : "Criar Indicador"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Margem Operacional" />
          </div>
          <div>
            <Label className="text-xs">Categoria</Label>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div>
          <Label className="text-xs">Descrição (opcional)</Label>
          <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} placeholder="Explicação em linguagem simples" />
        </div>

        <div>
          <Label className="text-xs mb-1 block">Fórmula</Label>
          <FormulaBuilder plano={plano} tokens={tokens} onChange={setTokens} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Modo de análise</Label>
            <select
              value={modo}
              onChange={(e) => setModo(e.target.value as ModoAnalise)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {MODOS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">
              {MODOS.find((m) => m.value === modo)?.hint}
            </p>
          </div>
          <div>
            <Label className="text-xs">Direção da faixa</Label>
            <select
              value={direcao}
              onChange={(e) => setDirecao(e.target.value as any)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="maior_melhor">Maior é melhor</option>
              <option value="menor_melhor">Menor é melhor</option>
            </select>
          </div>
        </div>

        <div>
          <Label className="text-xs mb-1 block">
            Faixas (opcional) — limites de classificação {direcao === "maior_melhor" ? "(≥)" : "(≤)"}
          </Label>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-[10px] text-emerald-600">Ótimo</Label>
              <Input value={faixaOtimo} onChange={(e) => setFaixaOtimo(e.target.value)} placeholder="ex.: 1.5" />
            </div>
            <div>
              <Label className="text-[10px] text-blue-600">Bom</Label>
              <Input value={faixaBom} onChange={(e) => setFaixaBom(e.target.value)} placeholder="ex.: 1.0" />
            </div>
            <div>
              <Label className="text-[10px] text-amber-600">Atenção</Label>
              <Input value={faixaAtencao} onChange={(e) => setFaixaAtencao(e.target.value)} placeholder="ex.: 0.7" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
