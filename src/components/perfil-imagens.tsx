import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Image as ImageIcon, Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { capturarImagensDoSite } from "@/lib/api/perfil-ia.functions";
import {
  dataUrlParaArquivo, enviarImagemPerfil, removerImagemPerfil, urlDaImagemPerfil,
  type EscopoPerfil, type TipoImagem, LIMITES,
} from "@/lib/perfil-imagens";

export type PendentesPerfil = { logo?: File | null; foto?: File | null };

/**
 * Logo e foto do perfil, com duas vias: captura automática do site
 * (conveniência) e upload manual (garantia). Quando ainda não existe registro
 * salvo (cadastro novo), os arquivos ficam pendentes e o pai envia depois.
 */
export function PerfilImagens({
  tenantId, escopo, id, site, logoPath, fotoPath, onPathChange, onPendenteChange, mostrarLogo = true,
}: {
  tenantId: string | null | undefined;
  escopo: EscopoPerfil;
  id: string | null;
  site: string;
  logoPath: string | null;
  fotoPath: string | null;
  onPathChange: (tipo: TipoImagem, path: string | null) => void;
  onPendenteChange?: (tipo: TipoImagem, file: File | null) => void;
  mostrarLogo?: boolean;
}) {
  const [capturando, setCapturando] = useState(false);
  const [doSite, setDoSite] = useState<Record<string, boolean>>({});

  const capturar = async () => {
    if (!site.trim()) return toast.error("Informe o site antes de tentar capturar as imagens.");
    setCapturando(true);
    try {
      const r = await capturarImagensDoSite({ data: { site: site.trim() } });
      if (!r.ok) return toast.error(r.erro ?? "Não foi possível capturar as imagens.");
      let achou = 0;
      if (mostrarLogo && r.logo) {
        await aplicarArquivo("logo", dataUrlParaArquivo(r.logo.dataUrl, "logo"), true);
        achou++;
      }
      if (r.foto) {
        await aplicarArquivo("foto", dataUrlParaArquivo(r.foto.dataUrl, "foto"), true);
        achou++;
      }
      toast.success(
        achou
          ? "Imagens capturadas do site. Confira e troque se não estiverem boas."
          : "Nada utilizável foi encontrado. Envie as imagens manualmente.",
      );
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível capturar as imagens agora.");
    } finally {
      setCapturando(false);
    }
  };

  const aplicarArquivo = async (tipo: TipoImagem, file: File, veioDoSite = false) => {
    if (file.size > LIMITES[tipo]) {
      toast.error(tipo === "logo" ? "A logo deve ter no máximo 2MB." : "A foto deve ter no máximo 5MB.");
      return;
    }
    setDoSite((s) => ({ ...s, [tipo]: veioDoSite }));
    if (!id || !tenantId) {
      onPendenteChange?.(tipo, file);
      return;
    }
    const path = await enviarImagemPerfil({
      tenantId, escopo, id, tipo, file,
      anterior: tipo === "logo" ? logoPath : fotoPath,
    });
    onPathChange(tipo, path);
  };

  const limpar = async (tipo: TipoImagem) => {
    const atual = tipo === "logo" ? logoPath : fotoPath;
    onPendenteChange?.(tipo, null);
    if (atual) await removerImagemPerfil(atual);
    onPathChange(tipo, null);
    setDoSite((s) => ({ ...s, [tipo]: false }));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Imagens do perfil</Label>
        <Button type="button" size="sm" variant="outline" onClick={capturar} disabled={capturando || !site.trim()}>
          {capturando
            ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Lendo o site…</>
            : <><Sparkles className="h-3.5 w-3.5 mr-1" /> Tentar capturar do site</>}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {mostrarLogo && (
          <BlocoImagem
            titulo="Logo" ajuda="PNG, JPG, SVG ou WebP · até 2MB"
            path={logoPath} doSite={!!doSite["logo"]}
            onFile={(f) => aplicarArquivo("logo", f)} onLimpar={() => limpar("logo")}
          />
        )}
        <BlocoImagem
          titulo="Foto" ajuda="Foto de capa/representativa · até 5MB"
          path={fotoPath} doSite={!!doSite["foto"]}
          onFile={(f) => aplicarArquivo("foto", f)} onLimpar={() => limpar("foto")}
        />
      </div>
      {!id && (
        <p className="text-[11px] text-muted-foreground">
          As imagens escolhidas agora são enviadas assim que o cadastro for salvo.
        </p>
      )}
    </div>
  );
}

function BlocoImagem({
  titulo, ajuda, path, doSite, onFile, onLimpar,
}: {
  titulo: string;
  ajuda: string;
  path: string | null;
  doSite: boolean;
  onFile: (f: File) => Promise<void> | void;
  onLimpar: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const url = await urlDaImagemPerfil(path);
      if (!cancelado) setPreview(url);
    })();
    return () => { cancelado = true; };
  }, [path]);

  const escolher = async (f: File | null) => {
    if (!f) return;
    setPreview(URL.createObjectURL(f));
    setOcupado(true);
    try {
      await onFile(f);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao enviar a imagem.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="rounded-lg border p-3 space-y-2 bg-muted/20">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{titulo}</span>
        {(preview || path) && (
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground"
            onClick={() => { setPreview(null); onLimpar(); }}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="h-24 rounded-md border bg-background flex items-center justify-center overflow-hidden">
        {ocupado
          ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          : preview
            ? <img src={preview} alt={titulo} className="h-full w-full object-contain" />
            : <ImageIcon className="h-6 w-6 text-muted-foreground" />}
      </div>
      {doSite && preview && (
        <p className="text-[11px] text-primary">Capturada do site — confira se ficou boa.</p>
      )}
      <label className="cursor-pointer inline-flex">
        <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
          className="hidden" onChange={(e) => escolher(e.target.files?.[0] ?? null)} />
        <span className="inline-flex items-center gap-2 px-3 py-1.5 text-xs border rounded-md hover:bg-accent">
          <Upload className="h-3.5 w-3.5" /> {preview ? "Trocar" : "Enviar arquivo"}
        </span>
      </label>
      <p className="text-[11px] text-muted-foreground">{ajuda}</p>
    </div>
  );
}
