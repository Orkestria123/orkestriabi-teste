import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { claimOrkestriaAdmin } from "@/lib/api/orkestria.functions";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Acesso ao Orkestria BI" },
    { name: "description", content: "Acesse as demonstrações contábeis e os relatórios mensais das suas empresas no Orkestria BI." },
    { property: "og:title", content: "Acesso ao Orkestria BI" },
    { property: "og:description", content: "Demonstrações contábeis, indicadores e relatórios executivos em um ambiente seguro." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: Index,
});

function Index() {
  const { loading, userId, role, refresh, tenant, tenantsDisponiveis, trocarTenant } = useAuth();
  const navigate = useNavigate();
  const [claiming, setClaiming] = useState(false);
  const [escolhendo, setEscolhendo] = useState<boolean | null>(null);
  const [trocando, setTrocando] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!userId) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    // Acesso a mais de um escritório: pergunta qual abrir (uma vez por sessão).
    const precisaEscolher =
      role !== "orkestria_admin" &&
      tenantsDisponiveis.length > 1 &&
      sessionStorage.getItem("orkestria:tenant-escolhido") !== "1";
    setEscolhendo(precisaEscolher);
    if (precisaEscolher) return;
    if (role === "orkestria_admin") navigate({ to: "/orkestria-admin", replace: true });
    else if (role === "tenant_admin") navigate({ to: "/admin", replace: true });
    else if (role === "client")
      navigate({ to: "/dashboard", search: { company: undefined }, replace: true });
    // if userId && !role, stay here and show claim/no-access UI
  }, [loading, userId, role, navigate, tenantsDisponiveis]);

  const escolher = async (id: string) => {
    setTrocando(id);
    try {
      if (id === tenant?.id) {
        sessionStorage.setItem("orkestria:tenant-escolhido", "1");
        setEscolhendo(false);
        if (role === "tenant_admin") navigate({ to: "/admin", replace: true });
        else navigate({ to: "/dashboard", search: { company: undefined }, replace: true });
      } else {
        await trocarTenant(id);
      }
    } catch (e: any) {
      toast.error(e.message || "Não foi possível abrir o escritório");
      setTrocando(null);
    }
  };

  if (escolhendo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md p-8">
          <h1 className="text-xl font-bold tracking-tight">Escolha o escritório</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Você tem acesso a mais de um escritório. Depois é possível trocar pelo topo da tela.
          </p>
          <div className="mt-6 space-y-2">
            {tenantsDisponiveis.map((t) => (
              <Button
                key={t.id}
                variant={t.id === tenant?.id ? "default" : "outline"}
                className="w-full justify-between"
                disabled={trocando != null}
                onClick={() => escolher(t.id)}
              >
                <span className="truncate">{t.name}</span>
                {trocando === t.id && <Loader2 className="h-4 w-4 animate-spin" />}
              </Button>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const handleClaim = async () => {
    setClaiming(true);
    try {
      await claimOrkestriaAdmin();
      await refresh();
      toast.success("Você agora é Orkestria Super Admin");
      navigate({ to: "/orkestria-admin", replace: true });
    } catch (e: any) {
      toast.error(e.message || "Falha ao reivindicar admin");
      setClaiming(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  if (loading || !userId || role) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // Signed in but no role yet
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md p-8 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <ShieldCheck className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-xl font-bold tracking-tight">Conta sem acesso atribuído</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sua conta foi criada mas ainda não está vinculada a um escritório ou empresa.
          Se você é o primeiro usuário da plataforma, reivindique o acesso de Super Admin.
        </p>
        <Button className="mt-6 w-full" onClick={handleClaim} disabled={claiming}>
          {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tornar-me Orkestria Super Admin"}
        </Button>
        <Button variant="ghost" className="mt-2 w-full" onClick={handleSignOut}>
          Sair
        </Button>
      </Card>
    </div>
  );
}
