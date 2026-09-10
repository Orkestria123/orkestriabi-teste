import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, KeyRound, Loader2 } from "lucide-react";

export const Route = createFileRoute("/recuperar-senha")({
  component: RecuperarSenhaPage,
  head: () => ({
    meta: [
      { title: "Recuperar senha — Orkestria BI" },
      {
        name: "description",
        content: "Recupere o acesso à sua conta Orkestria BI com um código enviado por e-mail.",
      },
      { property: "og:title", content: "Recuperar senha — Orkestria BI" },
      {
        property: "og:description",
        content: "Recupere o acesso à sua conta Orkestria BI com um código enviado por e-mail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

type Etapa = "email" | "codigo" | "senha";

function RecuperarSenhaPage() {
  const navigate = useNavigate();
  const [etapa, setEtapa] = useState<Etapa>("email");
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [loading, setLoading] = useState(false);

  // Quem clica no link do e-mail chega aqui já com o código na URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const tokenHash = url.searchParams.get("token_hash") ?? url.searchParams.get("token");
    const tipo = url.searchParams.get("type") ?? hash.get("type");
    if (hash.get("access_token")) {
      setEtapa("senha");
      window.history.replaceState({}, "", url.pathname);
      return;
    }
    if (tokenHash && (!tipo || tipo === "recovery")) {
      setLoading(true);
      supabase.auth
        .verifyOtp({ token_hash: tokenHash, type: "recovery" })
        .then(({ error }) => {
          if (error) throw error;
          setEtapa("senha");
          window.history.replaceState({}, "", url.pathname);
        })
        .catch((e: any) => toast.error(e?.message || "Link inválido ou expirado."))
        .finally(() => setLoading(false));
    }
  }, []);

  const enviarCodigo = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/recuperar-senha`,
      });
      if (error) throw error;
      toast.success("Enviamos um e-mail de recuperação.");
      setEtapa("codigo");
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível enviar o e-mail.");
    } finally {
      setLoading(false);
    }
  };

  const conferirCodigo = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: codigo.trim(),
        type: "recovery",
      });
      if (error) throw error;
      setEtapa("senha");
    } catch (err: any) {
      toast.error(err?.message || "Código inválido ou expirado.");
    } finally {
      setLoading(false);
    }
  };

  const salvarSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    if (senha !== senha2) {
      toast.error("As senhas não conferem.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;
      toast.success("Senha alterada. Entre novamente.");
      await supabase.auth.signOut();
      navigate({ to: "/auth", replace: true });
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível alterar a senha.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <KeyRound className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-center text-2xl font-bold tracking-tight">
          {etapa === "senha" ? "Definir nova senha" : "Esqueci minha senha"}
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          {etapa === "email" && "Informe seu e-mail e enviaremos um código de recuperação."}
          {etapa === "codigo" && `Digite o código que enviamos para ${email}.`}
          {etapa === "senha" && "Escolha uma nova senha para acessar sua conta."}
        </p>

        <Card className="mt-8 p-6 shadow-sm">
          {etapa === "email" && (
            <form onSubmit={enviarCodigo} className="space-y-3">
              <div>
                <Label htmlFor="em">E-mail</Label>
                <Input
                  id="em"
                  type="email"
                  value={email}
                  onChange={(ev) => setEmail(ev.target.value)}
                  required
                  autoFocus
                  placeholder="voce@empresa.com"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar código"}
              </Button>
            </form>
          )}

          {etapa === "codigo" && (
            <form onSubmit={conferirCodigo} className="space-y-3">
              <Input
                value={codigo}
                onChange={(ev) => setCodigo(ev.target.value.replace(/\s/g, ""))}
                autoFocus
                inputMode="numeric"
                maxLength={10}
                placeholder="000000"
                className="text-center text-lg tracking-[0.4em]"
              />
              <Button type="submit" className="w-full" disabled={loading || codigo.length < 4}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar código"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={(ev) => enviarCodigo(ev as unknown as React.FormEvent)}
                disabled={loading}
              >
                Reenviar e-mail
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Se o e-mail trouxer um botão em vez do código, basta clicar nele.
              </p>
            </form>
          )}

          {etapa === "senha" && (
            <form onSubmit={salvarSenha} className="space-y-3">
              <div>
                <Label htmlFor="s1">Nova senha</Label>
                <Input
                  id="s1"
                  type="password"
                  value={senha}
                  onChange={(ev) => setSenha(ev.target.value)}
                  required
                  minLength={8}
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="s2">Repetir a nova senha</Label>
                <Input
                  id="s2"
                  type="password"
                  value={senha2}
                  onChange={(ev) => setSenha2(ev.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar nova senha"}
              </Button>
            </form>
          )}
        </Card>

        <div className="mt-4 text-center text-sm">
          <Link to="/auth" className="inline-flex items-center gap-1 text-muted-foreground hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar para o login
          </Link>
        </div>
      </div>
    </div>
  );
}
