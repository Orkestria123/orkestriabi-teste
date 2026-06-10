import { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AppSidebar } from "@/components/app-sidebar";
import { Loader2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

interface Props {
  children: ReactNode;
  variant: "orkestria" | "admin" | "client";
  title?: string;
  actions?: ReactNode;
  unstyled?: boolean;
}

export function PortalShell({ children, variant, title, actions, unstyled }: Props) {
  const { loading, userId, role } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!userId) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    const allowed =
      (variant === "orkestria" && role === "orkestria_admin") ||
      (variant === "admin" && (role === "tenant_admin" || role === "orkestria_admin")) ||
      (variant === "client" && role != null);
    if (!allowed) {
      navigate({ to: "/", replace: true });
    }
  }, [loading, userId, role, variant, navigate]);

  if (loading || !userId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar variant={variant} />
      <main className="flex-1 flex flex-col min-w-0">
        {title && (
          <header className="h-16 border-b bg-card/50 backdrop-blur flex items-center justify-between px-6">
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            <div className="flex items-center gap-2">{actions}</div>
          </header>
        )}
        <div className={unstyled ? "flex-1" : "flex-1 p-6"}>{children}</div>
      </main>
    </div>
  );
}
