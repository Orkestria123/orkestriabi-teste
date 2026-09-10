import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Globe, ClipboardPaste } from "lucide-react";
import { toast } from "sonner";
import { gerarPerfilDoSite, gerarPerfilDeTexto } from "@/lib/api/perfil-ia.functions";

/**
 * Editor do perfil gerado por IA. O botão apenas SUGERE um texto a partir
 * do conteúdo real do site OU de um texto colado pelo admin — quem revisa,
 * ajusta e salva é o admin. Falhar aqui nunca bloqueia o cadastro.
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
  const temSite = !!site.trim();
  const [aba, setAba] = useState<"site" | "texto">(temSite ? "site" : "texto");
  const [colado, setColado] = useState("");
  const [gerando, setGerando] = useState<null | "site" | "texto">(null);

  const aplicar = (r: { ok: boolean; perfil?: string; erro?: string }) => {
    if (!r.ok) {
      toast.error(r.erro ?? "Não foi possível gerar o perfil.");
      return;
    }
    onChange(r.perfil ?? "");
    toast.success("Perfil gerado. Revise e ajuste antes de salvar.");
  };

  const gerarDoSite = async () => {
    if (!site.trim()) {
      toast.error("Informe o site antes de gerar o perfil.");
      return;
    }
    setGerando("site");
    try {
      aplicar(await gerarPerfilDoSite({ data: { site: site.trim(), tipo, nome: nome ?? "" } }));
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível gerar o perfil agora.");
    } finally {
      setGerando(null);
    }
  };

  const gerarDoTexto = async () => {
    if (!colado.trim()) {
      toast.error("Cole algum texto sobre a organização antes de gerar.");
      return;
    }
    setGerando("texto");
    try {
      aplicar(await gerarPerfilDeTexto({ data: { texto: colado.trim(), tipo, nome: nome ?? "" } }));
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível gerar o perfil agora.");
    } finally {
      setGerando(null);
    }
  };

  const abaBtn = (id: "site" | "texto", icone: React.ReactNode, texto: string) => (
    <button
      type="button"
      onClick={() => setAba(id)}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
        aba === id ? "bg-primary/10 border-primary/40 text-primary font-medium" : "text-muted-foreground hover:bg-accent"
      }`}
    >
      {icone} {texto}
    </button>
  );

  return (
    <div className="space-y-3">
      <Label className="text-xs">{label}</Label>

      <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
        <div className="flex items-center gap-2">
          {abaBtn("site", <Globe className="h-3.5 w-3.5" />, "Do site")}
          {abaBtn("texto", <ClipboardPaste className="h-3.5 w-3.5" />, "De texto colado")}
          {!temSite && (
            <span className="text-[11px] text-muted-foreground">Sem site cadastrado — use o texto colado.</span>
          )}
        </div>

        {aba === "site" ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {gerando === "site"
                ? "Buscando o conteúdo do site e montando o perfil — leva alguns segundos."
                : "A IA lê o conteúdo do site informado acima e monta o perfil com o que estiver escrito lá."}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={gerarDoSite} disabled={!!gerando}>
              {gerando === "site"
                ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Lendo o site…</>
                : <><Sparkles className="h-3.5 w-3.5 mr-1" /> Gerar do site</>}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Textarea
              value={colado}
              onChange={(e) => setColado(e.target.value)}
              rows={5}
              placeholder="Cole aqui informações sobre a empresa…"
              className="text-sm bg-background"
            />
            <p className="text-xs text-muted-foreground">
              Copie a descrição do Instagram, da busca do Google, ou de qualquer fonte, e cole aqui. A IA vai organizar
              no formato do perfil.
            </p>
            <Button type="button" size="sm" variant="outline" onClick={gerarDoTexto} disabled={!!gerando}>
              {gerando === "texto"
                ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Organizando o texto…</>
                : <><Sparkles className="h-3.5 w-3.5 mr-1" /> Gerar do texto colado</>}
            </Button>
          </div>
        )}
      </div>

      <Textarea
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        placeholder="Descrição, ramo de atuação, localização, tempo de mercado, porte, produtos e serviços…"
        className="text-sm"
      />
      <p className="text-xs text-muted-foreground">
        O texto usa apenas as informações fornecidas. Revise e complemente livremente antes de salvar.
      </p>
    </div>
  );
}
