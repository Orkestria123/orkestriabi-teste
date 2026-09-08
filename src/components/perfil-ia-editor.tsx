import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { gerarPerfilDoSite } from "@/lib/api/perfil-ia.functions";

/**
 * Editor do perfil gerado por IA. O botão apenas SUGERE um texto a partir
 * do conteúdo real do site — quem revisa, ajusta e salva é o admin.
 * Falhar aqui nunca bloqueia o cadastro: o campo continua editável.
 */
export function PerfilIaEditor({
  site, valor, onChange, tipo, nome, label = "Perfil",
}: {
  site: string;
  valor: string;
  onChange: (v: string) => void;
  tipo: "empresa" | "escritorio";
  nome?: string;
  label?: string;
}) {
  const [gerando, setGerando] = useState(false);

  const gerar = async () => {
    if (!site.trim()) {
      toast.error("Informe o site antes de gerar o perfil.");
      return;
    }
    setGerando(true);
    try {
      const r = await gerarPerfilDoSite({ data: { site: site.trim(), tipo, nome: nome ?? "" } });
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      onChange(r.perfil);
      toast.success("Perfil gerado. Revise e ajuste antes de salvar.");
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível gerar o perfil agora.");
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <Button type="button" size="sm" variant="outline" onClick={gerar} disabled={gerando}>
          {gerando
            ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Lendo o site…</>
            : <><Sparkles className="h-3.5 w-3.5 mr-1" /> {valor.trim() ? "Gerar novamente" : "Gerar perfil com IA"}</>}
        </Button>
      </div>
      <Textarea
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        placeholder="Descrição, ramo de atuação, localização, tempo de mercado, porte, produtos e serviços…"
        className="text-sm"
      />
      <p className="text-xs text-muted-foreground">
        {gerando
          ? "Buscando o conteúdo do site e montando o perfil — leva alguns segundos."
          : "O texto usa apenas o que consta no site. Revise e complemente livremente antes de salvar."}
      </p>
    </div>
  );
}
