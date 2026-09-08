import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { mfaStatus, mfaEnviarCodigo, mfaVerificarCodigo } from "@/lib/api/mfa.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";

/**
 * Segunda etapa de login: código enviado por SMS (Twilio Verify).
 * Exigido a cada sessão para todo usuário com telefone cadastrado.
 */
export function MfaGate({ children }: { children: ReactNode }) {
  const { loading, userId } = useAuth();
  const [checando, setChecando] = useState(true);
  const [precisa, setPrecisa] = useState(false);
  const [telefone, setTelefone] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    let vivo = true;
    if (loading) return;
    if (!userId) {
      setPrecisa(false);
      setChecando(false);
      return;
    }
    setChecando(true);
    mfaStatus()
      .then((s) => {
        if (!vivo) return;
        setPrecisa(s.requerido && !s.verificado);
        setTelefone(s.telefone);
      })
      .catch(() => {
        if (vivo) setPrecisa(false);
      })
      .finally(() => {
        if (vivo) setChecando(false);
      });
    return () => {
      vivo = false;
    };
  }, [loading, userId]);

  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await mfaEnviarCodigo();
      setTelefone(r.telefone);
      setEnviado(true);
      toast.success("Código enviado por SMS.");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao enviar o código.");
    } finally {
      setEnviando(false);
    }
  };

  const verificar = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerificando(true);
    try {
      await mfaVerificarCodigo({ data: { codigo } });
      setPrecisa(false);
      toast.success("Verificação concluída.");
    } catch (err: any) {
      toast.error(err?.message || "Código inválido.");
    } finally {
      setVerificando(false);
    }
  };

  const sair = async () => {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  };

  if (loading || checando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!precisa) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm p-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheck className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-center text-xl font-bold tracking-tight">Verificação em duas etapas</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          {enviado
            ? `Digite o código enviado para ${telefone ?? "seu celular"}.`
            : `Vamos enviar um código por SMS para ${telefone ?? "seu celular"}.`}
        </p>

        {!enviado ? (
          <Button className="mt-6 w-full" onClick={enviar} disabled={enviando}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar código"}
          </Button>
        ) : (
          <form onSubmit={verificar} className="mt-6 space-y-3">
            <Input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              autoFocus
              maxLength={8}
              placeholder="000000"
              className="text-center text-lg tracking-[0.4em]"
            />
            <Button type="submit" className="w-full" disabled={verificando || codigo.length < 4}>
              {verificando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar"}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={enviar} disabled={enviando}>
              Reenviar código
            </Button>
          </form>
        )}

        <Button type="button" variant="ghost" className="mt-2 w-full text-muted-foreground" onClick={sair}>
          Sair
        </Button>
      </Card>
    </div>
  );
}
