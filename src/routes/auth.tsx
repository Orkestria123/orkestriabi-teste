import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { ArrowRight, Loader2, BarChart3 } from "lucide-react";
import { claimOrkestriaAdmin } from "@/lib/api/orkestria.functions";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { userId, loading: authLoading, refresh } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && userId) navigate({ to: "/", replace: true });
  }, [userId, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Conta criada!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Bem-vindo!");
      }
      navigate({ to: "/", replace: true });
    } catch (e: any) {
      toast.error(e.message || "Erro ao autenticar");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      if (result.redirected) return;
      navigate({ to: "/", replace: true });
    } catch (e: any) {
      toast.error(e.message || "Erro Google");
      setLoading(false);
    }
  };

  const handleClaimAdmin = async () => {
    try {
      await claimOrkestriaAdmin();
      await refresh();
      toast.success("Você agora é Orkestria Super Admin");
      navigate({ to: "/orkestria-admin", replace: true });
    } catch (e: any) {
      toast.error(e.message || "Falha");
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Hero side */}
      <div className="hidden lg:flex flex-1 relative items-center p-12 text-white overflow-hidden"
        style={{ background: "linear-gradient(135deg, oklch(0.45 0.22 280), oklch(0.55 0.20 320))" }}>
        <div className="absolute inset-0 opacity-30" style={{
          backgroundImage: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.15) 0px, transparent 50%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.1) 0px, transparent 50%)"
        }} />
        <div className="relative max-w-md">
          <div className="flex items-center gap-2 mb-12">
            <div className="h-10 w-10 rounded-lg bg-white/15 backdrop-blur flex items-center justify-center">
              <BarChart3 className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold">Orkestria BI</span>
          </div>
          <h1 className="text-5xl font-bold leading-[1.05] tracking-tight">
            BI contábil que fala<br />a língua do cliente.
          </h1>
          <p className="mt-6 text-white/80 text-lg leading-relaxed">
            Importe o SPED Contábil e entregue dashboards interativos de DRE,
            Balanço e indicadores em minutos.
          </p>
          <ul className="mt-10 space-y-3 text-sm text-white/90">
            <li className="flex items-center gap-3">
              <div className="h-1.5 w-1.5 rounded-full bg-white" />
              Multi-tenant para escritórios contábeis
            </li>
            <li className="flex items-center gap-3">
              <div className="h-1.5 w-1.5 rounded-full bg-white" />
              Análise vertical e horizontal automáticas
            </li>
            <li className="flex items-center gap-3">
              <div className="h-1.5 w-1.5 rounded-full bg-white" />
              Branding personalizado por escritório
            </li>
          </ul>
        </div>
      </div>

      {/* Form side */}
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center text-white"
              style={{ background: "linear-gradient(135deg, oklch(0.45 0.22 280), oklch(0.55 0.20 320))" }}>
              <BarChart3 className="h-5 w-5" />
            </div>
            <span className="font-bold text-lg">Orkestria BI</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">
            {mode === "signin" ? "Bem-vindo de volta" : "Criar sua conta"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Acesse seu painel e organize seus dados."
              : "Comece a usar o Orkestria BI gratuitamente."}
          </p>

          <Card className="mt-8 p-6 shadow-sm">
            <Button type="button" variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09a6.6 6.6 0 0 1 0-4.19V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
              </svg>
              Continuar com Google
            </Button>
            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">ou com e-mail</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              {mode === "signup" && (
                <div>
                  <Label htmlFor="fn">Nome completo</Label>
                  <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
              )}
              <div>
                <Label htmlFor="em">E-mail</Label>
                <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="voce@empresa.com" />
              </div>
              <div>
                <Label htmlFor="pw">Senha</Label>
                <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <>
                    {mode === "signin" ? "Entrar" : "Criar conta"}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          </Card>

          <div className="mt-4 text-center text-sm text-muted-foreground">
            {mode === "signin" ? (
              <>
                Novo no Orkestria?{" "}
                <button onClick={() => setMode("signup")} className="text-primary font-medium hover:underline">
                  Criar conta
                </button>
              </>
            ) : (
              <>
                Já tem conta?{" "}
                <button onClick={() => setMode("signin")} className="text-primary font-medium hover:underline">
                  Entrar
                </button>
              </>
            )}
          </div>
          {userId && (
            <div className="mt-6 text-center">
              <button onClick={handleClaimAdmin} className="text-xs text-muted-foreground hover:text-primary underline">
                Tornar-me Orkestria Super Admin (primeiro usuário)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
