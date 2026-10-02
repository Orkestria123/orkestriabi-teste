import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { registrarAcesso } from "@/lib/api/auditoria.functions";
import { useAuth } from "@/hooks/use-auth";
import { ArrowRight, Loader2 } from "lucide-react";
import { claimOrkestriaAdmin } from "@/lib/api/orkestria.functions";
import logoAsset from "@/assets/orkestria-logo.png.asset.json";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { userId, loading: authLoading, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && userId) navigate({ to: "/", replace: true });
  }, [userId, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      void registrarAcesso({ data: { acao: "login" } }).catch(() => {});
      toast.success("Bem-vindo!");
      navigate({ to: "/", replace: true });
    } catch (e: any) {
      toast.error(e.message || "Erro ao autenticar");
    } finally {
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
          <div className="flex items-center gap-3 mb-12">
            <div className="bg-white rounded-xl px-4 py-2">
              <img src={logoAsset.url} alt="Orkestria" className="h-8" />
            </div>
            <span className="text-2xl font-bold leading-none">BI</span>
          </div>
          <h1 className="text-5xl font-bold leading-[1.05] tracking-tight">
            BI contábil que fala<br />a língua do cliente.
          </h1>
          <p className="mt-6 text-white/80 text-lg leading-relaxed">
            Acompanhe os resultados e a saúde financeira do seu negócio em uma
            linguagem simples.
          </p>
          <ul className="mt-10 space-y-3 text-sm text-white/90">
            <li className="flex items-start gap-3">
              <div className="h-1.5 w-1.5 rounded-full bg-white shrink-0 mt-1.5" />
              Veja seu resultado mês a mês, sem planilhas e com poucos cliques.
            </li>
            <li className="flex items-start gap-3">
              <div className="h-1.5 w-1.5 rounded-full bg-white shrink-0 mt-1.5" />
              KPIs, gráficos e insights por IA para entender seu negócio a qualquer momento.
            </li>
            <li className="flex items-start gap-3">
              <div className="h-1.5 w-1.5 rounded-full bg-white shrink-0 mt-1.5" />
              Acompanhe de onde estiver, pelo celular ou computador, com segurança.
            </li>
          </ul>
        </div>
      </div>

      {/* Form side */}
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <img src={logoAsset.url} alt="Orkestria" className="h-8" />
            <span className="font-bold text-lg leading-none">BI</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Bem-vindo de volta</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Acesse seu painel e organize seus dados.
          </p>

          <Card className="mt-8 p-6 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <Label htmlFor="em">E-mail</Label>
                <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="voce@empresa.com" />
              </div>
              <div>
                <Label htmlFor="pw">Senha</Label>
                <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              </div>
              <div className="text-right">
                <Link to="/recuperar-senha" className="text-xs text-muted-foreground hover:underline">
                  Esqueci minha senha
                </Link>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <>
                    Entrar
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
