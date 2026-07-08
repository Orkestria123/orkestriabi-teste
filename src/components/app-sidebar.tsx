import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Building2,
  Upload,
  Users,
  Settings,
  BarChart3,
  Receipt,
  Wallet,
  PieChart,
  TrendingUp,
  LineChart,
  FileSpreadsheet,
  LogOut,
  Briefcase,
  Target,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; icon: any };

const ORK_NAV: NavItem[] = [
  { to: "/orkestria-admin", label: "Visão geral", icon: LayoutDashboard },
  { to: "/orkestria-admin/tenants", label: "Tenants", icon: Briefcase },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/comparativo", label: "Comparativo", icon: BarChart3 },
  { to: "/admin/empresas", label: "Empresas", icon: Building2 },
  { to: "/admin/upload", label: "Upload SPED", icon: Upload },
  { to: "/admin/usuarios", label: "Usuários", icon: Users },
];

const CLIENT_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/dashboard/dre", label: "DRE", icon: Receipt },
  { to: "/dashboard/balanco", label: "Balanço", icon: BarChart3 },
  { to: "/dashboard/fluxo-de-caixa", label: "Fluxo de Caixa", icon: Wallet },
  { to: "/dashboard/dlpa", label: "DLPA", icon: TrendingUp },
  { to: "/dashboard/dva", label: "DVA", icon: PieChart },
  { to: "/dashboard/indicadores", label: "Indicadores", icon: LineChart },
  { to: "/dashboard/fornecedores", label: "Fornecedores", icon: Users },
  { to: "/dashboard/notas-fiscais", label: "Notas Fiscais", icon: FileSpreadsheet },
  { to: "/dashboard/analise", label: "Análise", icon: FileSpreadsheet },
  { to: "/dashboard/orcamento", label: "Orçamento", icon: Target },
];

export function AppSidebar({ variant }: { variant: "orkestria" | "admin" | "client" }) {
  const { profile, tenant, signOut } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const items =
    variant === "orkestria" ? ORK_NAV : variant === "admin" ? ADMIN_NAV : CLIENT_NAV;

  const brandName =
    variant === "orkestria" ? "Orkestria" : tenant?.name ?? "Orkestria BI";

  const accent =
    variant === "client" && tenant?.primary_color ? tenant.primary_color : undefined;

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="h-16 flex items-center gap-2 px-5 border-b border-sidebar-border">
        {variant === "client" && tenant?.logo_url ? (
          <img src={tenant.logo_url} alt={brandName} className="h-8 w-auto max-w-[120px] object-contain" />
        ) : (
          <div
            className="h-8 w-8 rounded-md flex items-center justify-center text-white font-bold"
            style={{
              background:
                accent ?? "linear-gradient(135deg, oklch(0.54 0.20 277), oklch(0.62 0.20 320))",
            }}
          >
            {brandName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="leading-tight">
          <div className="text-sm font-semibold text-sidebar-foreground">{brandName}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {variant === "orkestria" ? "Plataforma" : variant === "admin" ? "Escritório" : "BI"}
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-0.5">
        {items.map((item) => {
          const isActive =
            item.to === pathname ||
            (item.to !== "/" && pathname.startsWith(item.to + "/")) ||
            (item.to === "/dashboard" && pathname === "/dashboard") ||
            (item.to === "/admin" && pathname === "/admin") ||
            (item.to === "/orkestria-admin" && pathname === "/orkestria-admin");
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3 space-y-2">
        {variant === "admin" && (
          <Link
            to="/admin"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:bg-sidebar-accent/60"
          >
            <Settings className="h-3.5 w-3.5" /> Configurações
          </Link>
        )}
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-sidebar-accent/40">
          <div className="h-7 w-7 rounded-full bg-primary/15 text-primary text-xs font-semibold flex items-center justify-center">
            {profile?.full_name?.slice(0, 1).toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 leading-tight overflow-hidden">
            <div className="text-xs font-medium truncate">{profile?.full_name ?? "Usuário"}</div>
            <div className="text-[10px] text-muted-foreground truncate">{profile?.email}</div>
          </div>
          <button
            onClick={() => signOut()}
            className="text-muted-foreground hover:text-foreground"
            title="Sair"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
