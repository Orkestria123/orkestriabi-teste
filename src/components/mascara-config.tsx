import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save, Trash2 } from "lucide-react";
import {
  MASCARA_DEFAULT,
  interpretarClassificacao,
  invalidarCacheMascara,
  type GrupoContabil,
  type MascaraConfig,
  type NivelMascara,
} from "@/lib/mascara/interpretar";

const GRUPOS: GrupoContabil[] = [
  "ativo",
  "passivo",
  "pl",
  "despesa",
  "receita",
  "resultado",
];

interface Props {
  tenantId: string;
  companyId?: string | null;
  /** "tenant" = config do escritório; "empresa" = sobrescreve para uma empresa */
  escopo: "tenant" | "empresa";
}

export function MascaraConfigPanel({ tenantId, companyId, escopo }: Props) {
  const [cfg, setCfg] = useState<MascaraConfig>(MASCARA_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exemplo, setExemplo] = useState("1.01.02.001");
  const [amostras, setAmostras] = useState<string[]>([]);

  const targetCompanyId = escopo === "empresa" ? (companyId ?? null) : null;

  useEffect(() => {
    (async () => {
      setLoading(true);
      const q = supabase
        .from("mascara_classificacao" as any)
        .select("separador, niveis, grupos, larguras")
        .eq("tenant_id", tenantId);
      const { data } = targetCompanyId
        ? await q.eq("company_id", targetCompanyId).maybeSingle()
        : await q.is("company_id", null).maybeSingle();
      if (data) {
        setCfg({
          separador: (data as any).separador,
          niveis: (data as any).niveis,
          grupos: (data as any).grupos,
          larguras: (data as any).larguras ?? undefined,
        });
      } else {
        setCfg(MASCARA_DEFAULT);
      }

      // Carrega amostras reais do plano de contas importado
      const planoQ = supabase
        .from("plano_contas")
        .select("classificacao")
        .eq("tenant_id", tenantId)
        .not("classificacao", "is", null)
        .limit(20);
      const planoRes = targetCompanyId
        ? await planoQ.eq("company_id", targetCompanyId)
        : await planoQ.is("company_id", null);
      const classifs = (planoRes.data ?? [])
        .map((r: any) => r.classificacao as string)
        .filter(Boolean);
      setAmostras(classifs);
      if (classifs.length > 0) setExemplo(classifs[0]);

      setLoading(false);
    })();
  }, [tenantId, targetCompanyId]);

  async function salvar() {
    setSaving(true);
    const { error } = await supabase
      .from("mascara_classificacao" as any)
      .upsert(
        {
          tenant_id: tenantId,
          company_id: targetCompanyId,
          separador: cfg.separador,
          niveis: cfg.niveis,
          grupos: cfg.grupos,
          larguras: cfg.larguras ?? null,
        } as any,
        { onConflict: "tenant_id,company_id" },
      );
    setSaving(false);
    if (error) {
      toast.error(`Falha ao salvar: ${error.message}`);
      return;
    }
    invalidarCacheMascara();
    toast.success("Máscara salva");
  }


  async function restaurar() {
    if (!confirm("Restaurar máscara padrão?")) return;
    if (targetCompanyId) {
      await supabase
        .from("mascara_classificacao" as any)
        .delete()
        .eq("tenant_id", tenantId)
        .eq("company_id", targetCompanyId);
    } else {
      await supabase
        .from("mascara_classificacao" as any)
        .delete()
        .eq("tenant_id", tenantId)
        .is("company_id", null);
    }
    setCfg(MASCARA_DEFAULT);
    invalidarCacheMascara();
    toast.success("Máscara restaurada para o padrão");
  }

  if (loading) return <div className="text-sm text-muted-foreground">Carregando…</div>;

  const preview = interpretarClassificacao(exemplo, cfg);

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <div>
          <h3 className="font-medium text-sm mb-1">Máscara de Classificação</h3>
          <p className="text-xs text-muted-foreground">
            Define como o código de classificação contábil é separado em níveis
            (Grupo, Subgrupo, etc.) e qual dígito identifica cada grupo
            patrimonial. Aplica-se a {escopo === "tenant" ? "todo o escritório" : "esta empresa"}.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Separador</Label>
            <Input
              value={cfg.separador}
              maxLength={3}
              placeholder='ex.: "."  (vazio = largura fixa)'
              onChange={(e) => setCfg((c) => ({ ...c, separador: e.target.value }))}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Deixe em branco para máscara de largura fixa (sem separador, ex.: <code>10101</code>).
            </p>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Exemplo para preview</Label>
            <div className="flex gap-2">
              <Input value={exemplo} onChange={(e) => setExemplo(e.target.value)} />
              {amostras.length > 0 && (
                <select
                  className="flex h-9 rounded-md border bg-background px-2 text-xs"
                  value=""
                  onChange={(e) => e.target.value && setExemplo(e.target.value)}
                >
                  <option value="">amostras do seu plano…</option>
                  {amostras.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}
            </div>
            {amostras.length === 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Importe o plano de contas para ver classificações reais aqui.
              </p>
            )}
          </div>
        </div>

        {!cfg.separador && (
          <div>
            <Label className="text-xs mb-1 block">Larguras dos níveis (caracteres)</Label>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {(cfg.larguras ?? [1, 2, 2, 3, 3]).map((w, i) => (
                <Input
                  key={i}
                  type="number"
                  min={1}
                  value={w}
                  onChange={(e) => {
                    const novas = [...(cfg.larguras ?? [1, 2, 2, 3, 3])];
                    novas[i] = Math.max(1, parseInt(e.target.value || "1", 10));
                    setCfg({ ...cfg, larguras: novas });
                  }}
                />
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Cada número define quantos caracteres ocupa o respectivo nível. Soma deve casar com o comprimento total da classificação.
            </p>
          </div>
        )}


        <div>
          <Label className="text-xs mb-1 block">Nomes dos níveis</Label>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {cfg.niveis.map((n, i) => (
              <Input
                key={i}
                value={n.nome}
                onChange={(e) => {
                  const niveis = [...cfg.niveis];
                  niveis[i] = { ...niveis[i], nome: e.target.value };
                  setCfg({ ...cfg, niveis });
                }}
              />
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs mb-1 block">
            Mapeamento de grupos (1º dígito → grupo patrimonial)
          </Label>
          <div className="space-y-2">
            {Object.entries(cfg.grupos).map(([digito, grupo]) => (
              <div key={digito} className="flex gap-2 items-center">
                <Input
                  className="w-20"
                  value={digito}
                  onChange={(e) => {
                    const novo = e.target.value;
                    const grupos = { ...cfg.grupos };
                    delete grupos[digito];
                    grupos[novo] = grupo;
                    setCfg({ ...cfg, grupos });
                  }}
                />
                <select
                  className="flex h-9 rounded-md border bg-background px-2 text-sm"
                  value={grupo}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      grupos: { ...cfg.grupos, [digito]: e.target.value as GrupoContabil },
                    })
                  }
                >
                  {GRUPOS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const grupos = { ...cfg.grupos };
                    delete grupos[digito];
                    setCfg({ ...cfg, grupos });
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCfg({ ...cfg, grupos: { ...cfg.grupos, "0": "desconhecido" } })}
            >
              + adicionar dígito
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={salvar} disabled={saving} size="sm">
            <Save className="h-3 w-3 mr-1" />
            {saving ? "Salvando…" : "Salvar máscara"}
          </Button>
          <Button onClick={restaurar} variant="outline" size="sm">
            Restaurar padrão
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <h4 className="font-medium text-sm mb-2">Preview</h4>
        <div className="text-xs grid grid-cols-2 gap-2">
          <div>
            <span className="text-muted-foreground">Classificação:</span>{" "}
            <code>{preview.classificacao}</code>
          </div>
          <div>
            <span className="text-muted-foreground">Grupo:</span>{" "}
            <strong>{preview.grupo}</strong>
          </div>
          <div>
            <span className="text-muted-foreground">Nível:</span> {preview.nivel}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-5 gap-2 text-xs">
          {preview.rotulos.map((r, i) => (
            <div key={i} className="rounded border p-2">
              <div className="text-[10px] uppercase text-muted-foreground">{r.nome}</div>
              <div className="font-mono">{r.valor}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
