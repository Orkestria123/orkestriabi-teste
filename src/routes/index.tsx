import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { loading, userId, role } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (!userId) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    if (role === "orkestria_admin") navigate({ to: "/orkestria-admin", replace: true });
    else if (role === "tenant_admin") navigate({ to: "/admin", replace: true });
    else if (role === "client") navigate({ to: "/dashboard", replace: true });
    else navigate({ to: "/auth", replace: true });
  }, [loading, userId, role, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}
