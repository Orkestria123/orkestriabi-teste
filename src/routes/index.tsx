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
  component: Index,
});

function Index() {
  const { loading, userId, role, refresh } = useAuth();
  const navigate = useNavigate();
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!userId) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    if (role === "orkestria_admin") navigate({ to: "/orkestria-admin", replace: true });
    else if (role === "tenant_admin") navigate({ to: "/admin", replace: true });
    else if (role === "client") navigate({ to: "/dashboard", replace: true });
    // if userId && !role, stay here and show claim/no-access UI
  }, [loading, userId, role, navigate]);

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
