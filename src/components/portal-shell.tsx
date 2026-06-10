import { ReactNode, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AppTopNav } from "@/components/app-topnav";
import { Loader2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

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
    <div className="flex min-h-screen w-full flex-col bg-background">
      <AppTopNav variant={variant} title={title} actions={actions} />
      <main className={unstyled ? "flex-1" : "flex-1 p-4"}>{children}</main>
    </div>
  );
}
